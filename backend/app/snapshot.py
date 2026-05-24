"""URL → (screenshot + element catalog) via nodriver + stealth."""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from nodriver import cdp

from app.actions import run_actions, BrowserAction
from app.browser import pool, with_transient_retry
from app.extract_js import COLLECT_ELEMENTS_JS, COLLECT_STRUCTURED_JS
from app.safety import SafetyCheck


log = logging.getLogger(__name__)


# ── SSRF guard ────────────────────────────────────────────────────────────
# Untrusted URLs flow into `take_snapshot` from /snapshot, /extract, and the
# anonymous /public/snapshot-and-suggest endpoint. Without an allowlist a
# visitor could ask us to fetch `http://169.254.169.254/latest/meta-data/`
# (AWS IMDS) or `http://10.0.0.0/8` services on the host network, leaking
# cloud credentials or pivoting onto an internal LAN. We resolve EVERY
# A/AAAA record (defeats DNS rebinding at lookup time) and reject if any
# resolves to a non-public address.

def _is_safe_url(url: str) -> tuple[bool, str]:
    """Returns (ok, reason). Blocks SSRF to private/loopback/link-local.

    Resolves DNS at check time. There's a TOCTOU window between this
    resolve and the actual fetch by Chrome — full bulletproofing would
    require pinning the address into Chrome's resolver. For our threat
    model (random landing-page visitors, not nation-state attackers
    paying for ms-precision DNS rebinding), this is good enough.
    """
    try:
        p = urlparse(url)
    except Exception:
        return False, "unparseable URL"
    if p.scheme not in ("http", "https"):
        return False, f"scheme {p.scheme!r} not allowed"
    host = p.hostname
    if not host:
        return False, "missing host"
    # Reject literal addresses too — e.g. `http://0/` resolves to 0.0.0.0
    # on Linux which then maps to localhost.
    try:
        addrs = socket.getaddrinfo(host, None)
    except Exception as e:
        return False, f"DNS resolution failed: {e}"
    for fam, _, _, _, sockaddr in addrs:
        ip = sockaddr[0]
        try:
            ip_obj = ipaddress.ip_address(ip.split("%")[0])  # strip IPv6 zone id
        except ValueError:
            continue
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_reserved
            or ip_obj.is_multicast
            or ip_obj.is_unspecified
        ):
            return False, f"target resolves to non-public address {ip}"
    return True, "ok"


@dataclass
class SnapshotResult:
    url: str
    title: str
    screenshot_base64: str
    viewport: dict[str, int]
    page: dict[str, int]
    elements: list[dict[str, Any]]
    # First 8KB of `document.documentElement.outerHTML` — captured for
    # block-detection so signatures that live in <script> tags / CSS /
    # meta refresh (Cloudflare's `__cf_chl_`, DataDome's `_ddo`,
    # PerimeterX's `pxhd`) can actually reach detect_block. Before this
    # field existed, main.py was joining 40 truncated element-text
    # strings as a haystack and the bot-wall markers never appeared in
    # it — sites that DID get blocked silently returned challenge-JS
    # content as if it were the target page. See detect.py:69.
    # `html_excerpt` is the first 8KB of outerHTML — enough for every
    # known anti-bot signature, cheap to ship in the response.
    html_excerpt: str = ""
    # `html` is the FULL outerHTML (capped at 2MB to avoid memory blow on
    # mega-pages). Used by `/assist/schema` to run extraction against the
    # SAME DOM that produced the schema — eliminates the snapshot-A vs
    # snapshot-B drift that caused "every selector returns null" on
    # Amazon-class sites. Empty when not requested.
    html: str = ""
    # Cookies present at end-of-snapshot — vendors leave persistent
    # fingerprint cookies (`__cf_bm`, `datadome`, `_px3`) that survive
    # even when the rendered HTML is obfuscated. Best signal for
    # "the bot wall ran and tagged us".
    cookies: dict[str, str] = field(default_factory=dict)
    # Page-level structured data harvested in-page via CDP eval —
    # JSON-LD scripts, Open Graph meta, Twitter card meta, microdata
    # itemprops. The deterministic-first pipeline (assist.py) uses
    # these BEFORE asking the LLM, because they give confidence 1.0
    # field values with no hallucination risk.
    structured_data: dict[str, Any] = field(default_factory=dict)


async def take_snapshot(
    url: str,
    *,
    viewport_width: int = 1440,
    viewport_height: int = 900,
    actions: list[BrowserAction] | None = None,
    warmup: bool = False,
    expand_truncated: bool = True,
) -> SnapshotResult:
    """One-shot snapshot with a restart+retry on transient nodriver flakes.

    Optional actions run after navigation but before element collection —
    used to dismiss cookie banners, log in, scroll-trigger lazy content.

    Safety gate: every snapshot passes through `SafetyCheck`, which is
    now a pure per-host rate-limit wrapper (the robots.txt block was
    removed — see safety.py docstring for why).

    warmup=False (DEFAULT, after iter 6 bench): the cookie-warmup approach
    was tested and caused MORE problems than it solved on the antibot
    bench — visiting site root first then immediately scraping a deep URL
    looked MORE suspicious to Akamai (macys.com regressed from PASS to
    45s timeout) and the warmup-tab cleanup is racy on nodriver 0.45+
    causing "No target with given id found" errors on the follow-up
    scrape (broke 2captcha demo). Disabled by default; opt-in via warmup=
    True when you've validated it helps a specific site. Future improvement:
    extract cf_clearance cookie post-warmup and replay via curl-impersonate
    instead of re-using the same browser session."""

    async def _once() -> SnapshotResult:
        # SafetyCheck rate-limits per host BEFORE we burn a browser tab.
        async with SafetyCheck(url):
            if warmup:
                await _warmup_session(url)
            return await _snapshot_inner(url, viewport_width, viewport_height, actions, expand_truncated)

    result = await with_transient_retry(_once, label="snapshot")

    # Thin-result auto-retry. If the page came back with essentially
    # nothing, our adaptive wait probably bailed before the site
    # finished hydrating — typical on heavy SPAs whose initial render
    # is a skeleton with no interactive elements yet. ONE retry on a
    # fresh tab with the same code path; if the page is legitimately
    # near-empty (some blog posts) we just accept what we get.
    #
    # Threshold: 5. Real-world pages we sampled bottom out at ~30
    # elements. Below 5 is "the wait fired prematurely" or "the page
    # is a true edge case" — retrying is cheap (~3-8s) and only
    # happens on pages where we'd otherwise return junk.
    THIN_ELEMENTS_THRESHOLD = 5
    elements_count = len(result.elements or [])
    if elements_count < THIN_ELEMENTS_THRESHOLD:
        log.info(
            "snapshot.thin_retry",
            extra={"url": url, "first_elements": elements_count},
        )
        # Brief pause before re-navigating — lets server-side rate
        # limits cool off and gives any pending CDN cache populates a
        # head start.
        await asyncio.sleep(2.0)
        try:
            retry = await with_transient_retry(_once, label="snapshot_retry")
            if len(retry.elements or []) > elements_count:
                return retry
        except Exception as e:
            # Retry crashed for some reason — log and return the
            # original thin result rather than failing the whole call.
            log.warning(
                "snapshot.thin_retry_failed",
                extra={"url": url, "error": repr(e)},
            )

    return result


# Per-process cache of (hostname → already-warmed) so a 100-URL crawl
# doesn't warm the same domain 100 times. Cleared on browser restart
# because the cookies are gone too.
_warmed_hosts: set[str] = set()


async def _warmup_session(target_url: str) -> None:
    """Visit the site root first to collect anti-bot session cookies.

    No-op if we've already warmed this host on the current browser
    instance. Best-effort: a failure to warm doesn't block the real
    snapshot — that already has its own retry."""
    from urllib.parse import urlparse
    try:
        u = urlparse(target_url)
    except Exception:
        return
    host = (u.hostname or "").lower()
    if not host or host in _warmed_hosts:
        return

    root = f"{u.scheme}://{u.hostname}/"
    if target_url.rstrip("/") == root.rstrip("/"):
        # Target IS the root — no separate warmup needed; the main scrape
        # will collect cookies naturally.
        _warmed_hosts.add(host)
        return

    try:
        async with pool.tab(root) as warmup_tab:
            # Brief pause for any CF/DataDome challenge JS to execute and set
            # the clearance cookie. 2.5s is the sweet spot per testing —
            # under 2s misses some challenges, over 3s adds noticeable latency.
            await asyncio.sleep(2.5)
            _warmed_hosts.add(host)
            log.info("warmup.complete", extra={"host": host})
    except Exception as e:
        # Don't poison the cache on error — let the next attempt retry.
        log.warning("warmup.failed", extra={"host": host, "error": repr(e)})


def reset_warmup_cache() -> None:
    """Clear the warmed-hosts cache. Call after pool.restart() or when
    cookies are believed stale."""
    _warmed_hosts.clear()


async def _snapshot_inner(
    url: str,
    viewport_width: int,
    viewport_height: int,
    actions: list[BrowserAction] | None,
    expand_truncated: bool = True,
) -> SnapshotResult:
    """Order matters more than anything in this function.

    SSRF: we re-check URL safety inside the retry loop so that even if a
    transient retry sees a DNS change between attempts (rebinding), each
    attempt still validates before opening the tab.

    The hard lesson: any viewport resize after navigation fires a window
    `resize` event, which triggers re-layouts + lazy mount of things
    like Amazon's filter sidebar. That means bboxes and the screenshot
    end up in different layout states.

    The stable ordering that actually works:
      1. Set viewport ONCE before navigation.
      2. Navigate, wait for ready state.
      3. Force-eager all lazy images (rewrite loading=lazy → eager,
         hydrate data-src shims).
      4. Scroll through to trigger intersection-observer based loads.
      5. Scroll back to (0, 0) and wait for images + layout settle.
      6. COLLECT ELEMENTS FIRST — freezes the truth-of-DOM at scroll=0.
      7. THEN screenshot with capture_beyond_viewport=True. Even if
         this causes a brief layout shift during the capture, the
         bboxes are already frozen and the pixel-to-bbox mapping stays
         correct.
    """
    # SSRF gate — first thing before we open a tab. Raises ValueError
    # that the routes translate into HTTP 422 with a {kind, message}
    # detail body.
    ok, reason = _is_safe_url(url)
    if not ok:
        raise ValueError(f"unsafe URL: {reason}")

    async with pool.tab("about:blank") as tab:
        # Set the viewport ONCE, before we navigate. We never touch it
        # again in this function — that's the whole point.
        try:
            await tab.send(cdp.emulation.set_device_metrics_override(
                width=viewport_width,
                height=viewport_height,
                device_scale_factor=1,
                mobile=False,
            ))
        except Exception:
            pass

        await tab.get(url)
        await _wait_ready(tab, timeout=8.0)

        # Install the MutationObserver-based stability detector ONCE,
        # right after the page is parseable. Survives until the tab
        # closes. Without this, `_wait_until_page_stable` has no
        # mutation timestamp to read and falls back to its hard cap on
        # every poll.
        await _install_stability_shim(tab)

        # Install a MutationObserver that auto-eagers any <img> the page
        # adds AFTER this point (React mounts, infinite scroll, etc).
        # This is the fix for the "image rendered partially" bug — the
        # one-shot force-eager pass below only catches images that
        # exist NOW, but real e-commerce SPAs add product cards
        # continuously during scroll. The observer runs forever inside
        # the page until the tab closes; no perf concern since it's
        # cheap (attribute-only edits).
        await _install_lazy_image_killer(tab)

        # Adaptive wait for the initial render to settle. REPLACES the
        # old fixed `asyncio.sleep(0.5)` — bails in ~quiet_window on
        # static pages (HN, blogs, docs) and waits up to max_wait on
        # SPAs (Amazon, Target, LinkedIn) that fetch data after the
        # initial HTML.
        await _wait_until_page_stable(tab, min_wait=0.2, max_wait=8.0, quiet_window=0.4)

        # Truncation override + expand-button click. Together these reveal
        # the "Continue Reading" / "Show more" / "...show more" content
        # that's universally hidden on content sites (Quora, Reddit,
        # LinkedIn, Medium, news comment threads). CSS override is free
        # (no click risk). Expand-button click has a strict safelist —
        # text must MATCH `continue reading | show more | see more | ...`
        # AND NOT MATCH `subscribe | sign up | sign in | premium`, AND
        # NOT be inside a <form>. Opt out per request via
        # `expand_truncated=False` if the site behaves badly.
        if expand_truncated:
            try:
                await _inject_truncation_override(tab)
                clicks = await _click_expand_buttons(tab)
                log.info("snapshot.expand_clicks", extra={"url": url, "clicks": clicks})
                if clicks > 0:
                    # Page just grew — give it time to render the
                    # newly-revealed content. Modern SPAs (Quora, LinkedIn)
                    # batch their re-render across many clicks, so we
                    # need a longer max_wait than the initial settle.
                    await _wait_until_page_stable(tab, min_wait=0.5, max_wait=6.0, quiet_window=0.6)
            except Exception as e:
                log.warning("snapshot.expand_failed", extra={"url": url, "error": repr(e)})

        # Run pre-snapshot actions (dismiss cookie banners, log in, etc).
        # Failures are logged but don't abort — best-effort.
        if actions:
            try:
                await run_actions(tab, actions)
                # Adaptive settle after actions instead of fixed sleep —
                # cookie-banner dismiss might trigger an immediate XHR
                # that we need to wait for, or might do nothing.
                await _wait_until_page_stable(tab, min_wait=0.1, max_wait=4.0, quiet_window=0.3)
            except Exception as e:
                log.warning("snapshot.actions_failed", extra={"url": url, "error": repr(e)})

        # 3. Force-eager all currently-known lazy images. Belt and
        # suspenders alongside the observer in case the observer
        # registered after some images already mounted.
        await _force_eager_all_images(tab)

        # 4. Scroll through the full page to hit any observer-based
        # loaders that skip force-eager. Bounded — no infinite scroll.
        await _scroll_full_height(tab)

        # 5. Scroll back to origin. The adaptive wait below subsumes
        # what used to be: _wait_for_images + _wait_for_stable_height +
        # sleep(0.3). All three were variants of "is the page quiet?"
        # — now a single unified check. Image-decode is covered by the
        # `pending_images` signal inside `_wait_until_page_stable`;
        # layout-height stability is covered by the mutation timestamp
        # (height changes cause DOM mutations).
        await tab.evaluate("window.scrollTo(0, 0)")
        await _force_eager_all_images(tab)              # catch React-mounted images
        await _wait_until_page_stable(tab, min_wait=0.2, max_wait=8.0, quiet_window=0.4)

        # 6. KEEP THE ORIGINAL VIEWPORT. Do NOT expand to page height.
        #
        # Earlier versions of this code expanded the viewport to the
        # full document height (clamped at 24000px) so the screenshot
        # could capture everything in one pass. That broke modern
        # e-commerce (Target, Walmart, Best Buy) because:
        #   - `100vh` / `100dvh` sticky elements suddenly become 24000px
        #   - IntersectionObservers fire for every below-fold element
        #     simultaneously, triggering a layout-reflow storm
        #   - CSS Grid / Flex containers with `min-height: 100vh` tear
        #     apart (image children float free of their text children
        #     in the same card)
        # The Target Lego search result was a textbook example: cards
        # split visually into "title+price up top" and "image floating
        # below" because the grid container reflowed mid-screenshot.
        #
        # Fix: leave the viewport alone. The bbox walk uses
        # getBoundingClientRect() which returns *page-relative*
        # coordinates (rect.left + scrollX, rect.top + scrollY — see
        # extract_js.py:167–168), so below-the-fold elements are still
        # captured with correct positions. For the screenshot we pass
        # capture_beyond_viewport=True; CDP handles full-page capture
        # internally by scrolling and stitching the renderer's tiles,
        # which preserves the original `100vh` semantics.
        await _force_eager_all_images(tab)
        await _wait_for_images(tab, timeout=6.0)
        await _wait_until_page_stable(tab, min_wait=0.2, max_wait=6.0, quiet_window=0.6)
        # capture_beyond_viewport=True always — let Chromium's native
        # full-page capture do the scroll-and-stitch without us pre-
        # resizing the viewport.
        needs_beyond_viewport = True

        # ── STRUCTURAL FIX: bbox + screenshot coherence ─────────────────
        # The bbox table (from COLLECT_ELEMENTS_JS) and the screenshot
        # pixels (from Page.captureScreenshot) MUST come from the same
        # DOM/layout state. Otherwise hover overlays drift off the
        # elements they describe — the recurring "mismatch" bug class.
        # Every prior fix tightened a wait but never closed the gap.
        #
        # We tried setScriptExecutionDisabled(true) here — it caused
        # COLLECT_ELEMENTS_JS to return 0 elements because the frozen
        # frame returns zero-width rects from getBoundingClientRect.
        # So we use a softer-but-effective combination:
        #
        #   1. rAF flush — land all pending requestAnimationFrame work
        #      into the final layout (any in-flight visual update).
        #   2. Pause the lazy-image-killer observer so it cannot mutate
        #      img.src/srcset between collect and screenshot.
        #   3. Back-to-back collect + screenshot (no awaits between
        #      them other than the unavoidable CDP round-trip).
        #   4. Verify coherence: re-read the bbox of N sample elements
        #      after the screenshot. If ANY moved by >2px, the page
        #      mutated in the gap — retry the collect+screenshot pair
        #      once. Bounded — at most 2 retries before accepting.
        #
        # The verify-and-retry step is what closes the bug class: even
        # if a mutation lands between collect and shot, we catch it and
        # redo on a now-quieter state. Two consecutive coherent reads
        # mean the bboxes definitely describe what the screenshot shows.
        try:
            await tab.evaluate(
                "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
                await_promise=True,
            )
        except Exception:
            pass

        await tab.evaluate("window.__stealthLazyKillerPaused = true")

        data: dict = {"elements": [], "viewport": {}, "page": {}}
        screenshot_b64: str = ""
        try:
            for coherence_attempt in range(3):
                # Sample bboxes for a few elements BEFORE the collect/shot
                # pair. We'll re-read these AFTER and compare. We sample
                # by querying the DOM for a small fixed set — body, head,
                # plus the first 10 elements that match common content
                # selectors. Generic, no site-specific knowledge.
                pre_check = await tab.evaluate(r"""
                    (() => {
                        const out = [];
                        const els = Array.from(document.querySelectorAll(
                            "h1, h2, h3, a, button, img, [role='button']"
                        )).slice(0, 12);
                        for (const el of els) {
                            const r = el.getBoundingClientRect();
                            out.push(Math.round(r.left) + ',' + Math.round(r.top));
                        }
                        return out.join('|');
                    })()
                """)
                if isinstance(pre_check, tuple):
                    pre_check = pre_check[0]
                pre_str = str(pre_check or "")

                # Collect elements
                data = await _evaluate_json(tab, COLLECT_ELEMENTS_JS)
                # Screenshot immediately after
                shot = await tab.send(cdp.page.capture_screenshot(
                    format_="png",
                    capture_beyond_viewport=needs_beyond_viewport,
                ))
                screenshot_b64 = shot if isinstance(shot, str) else str(shot)

                # Re-sample bboxes — same selector set, same order.
                post_check = await tab.evaluate(r"""
                    (() => {
                        const out = [];
                        const els = Array.from(document.querySelectorAll(
                            "h1, h2, h3, a, button, img, [role='button']"
                        )).slice(0, 12);
                        for (const el of els) {
                            const r = el.getBoundingClientRect();
                            out.push(Math.round(r.left) + ',' + Math.round(r.top));
                        }
                        return out.join('|');
                    })()
                """)
                if isinstance(post_check, tuple):
                    post_check = post_check[0]
                post_str = str(post_check or "")

                # If the sample positions are identical, the page did NOT
                # mutate between collect and shot — the artifacts are
                # coherent. Done.
                if pre_str == post_str:
                    if coherence_attempt > 0:
                        log.info(
                            "snapshot.coherence_retry_succeeded",
                            extra={"url": url, "attempts": coherence_attempt + 1},
                        )
                    break
                # Otherwise: page mutated. Log and retry. A short await
                # gives the page another chance to settle before we
                # re-collect.
                log.info(
                    "snapshot.coherence_drift_detected",
                    extra={
                        "url": url,
                        "attempt": coherence_attempt + 1,
                        "pre": pre_str[:200],
                        "post": post_str[:200],
                    },
                )
                await asyncio.sleep(0.3)
            else:
                # All 3 attempts saw drift. Log it; ship the last result.
                # The page is genuinely unstable — better to ship a slightly
                # mismatched snapshot than to fail the request entirely.
                log.warning(
                    "snapshot.coherence_exhausted",
                    extra={"url": url, "attempts": 3},
                )
        finally:
            try:
                await tab.evaluate("window.__stealthLazyKillerPaused = false")
            except Exception:
                pass

        # 9. Capture page HTML + cookies for block-detection downstream.
        # First 8KB of outerHTML is enough for every known anti-bot
        # signature (Cloudflare's __cf_chl_, DataDome's _ddo,
        # PerimeterX's pxhd, Akamai's _abck) which appear in the page
        # head or first inline <script>. Bigger HTML doesn't pay off.
        # Cookies are tiny + the most reliable bot-wall fingerprint.
        html_excerpt = ""
        full_html = ""
        # Use nodriver's canonical `tab.get_content()` (CDP DOM.getOuterHTML)
        # NOT `tab.evaluate("document.documentElement.outerHTML")`. The
        # evaluate path returns over CDP Runtime.evaluate which serializes
        # the return value through the websocket protocol — large strings
        # (>~1MB) come back truncated or stringified-to-undefined on real
        # e-commerce pages. Symptom: the in-page element catalog included
        # `#productTitle` but `snap.html` did not, and every selector at
        # extract-time returned "selector matched zero nodes" — exactly
        # the bug a user hit on `/ai-extract` against Amazon (May 22).
        # `DOM.getOuterHTML` returns the full document over a dedicated
        # CDP call without that limitation.
        try:
            raw_html = await tab.get_content()
            if isinstance(raw_html, str):
                html_excerpt = raw_html[:8192]
                # 5MB cap. Earlier 2MB cap was clipping Amazon product
                # pages (a single Invicta PDP runs ~2MB; with the
                # `Customers also bought` carousel + reviews it's
                # >2.5MB). Truncation past 2MB lost important elements
                # in the user-reported `/ai-extract` failure. 5MB gives
                # headroom for Amazon / Walmart / Best Buy class pages
                # without runaway memory under concurrency: 5MB × 4
                # workers = 20MB peak, acceptable.
                full_html = raw_html[: 5 * 1024 * 1024]
        except Exception:
            pass
        cookies_dict: dict[str, str] = {}
        try:
            cookie_jar = await tab.send(cdp.network.get_cookies())
            if isinstance(cookie_jar, list):
                for c in cookie_jar:
                    # CDP cookies come as dict-likes with .name / .value
                    if hasattr(c, "name") and hasattr(c, "value"):
                        cookies_dict[c.name] = c.value
                    elif isinstance(c, dict):
                        n, v = c.get("name"), c.get("value")
                        if isinstance(n, str) and isinstance(v, str):
                            cookies_dict[n] = v
        except Exception:
            pass

        # 10. Harvest page structured data (JSON-LD / OG / Twitter /
        # microdata) — drives the deterministic-first pipeline. Cheap
        # (~50ms eval) and high-leverage: the top 100 e-commerce / news
        # sites all ship one of these, giving us confidence-1.0 field
        # values with no LLM call and no selector-hallucination risk.
        structured: dict[str, Any] = {}
        try:
            raw_struct = await _evaluate_json(tab, COLLECT_STRUCTURED_JS)
            if isinstance(raw_struct, dict):
                structured = raw_struct
        except Exception:
            pass

        log.info(
            "snapshot.complete",
            extra={
                "url": url,
                "elements": len(data.get("elements", [])),
                "page_width": data.get("page", {}).get("width"),
                "page_height": data.get("page", {}).get("height"),
                "html_excerpt_chars": len(html_excerpt),
                "cookie_count": len(cookies_dict),
            },
        )

        return SnapshotResult(
            url=data.get("url", url),
            title=data.get("title", ""),
            screenshot_base64=screenshot_b64,
            viewport=data.get("viewport", {"width": viewport_width, "height": viewport_height}),
            page=data.get("page", {"width": viewport_width, "height": viewport_height}),
            elements=data.get("elements", []),
            html_excerpt=html_excerpt,
            html=full_html,
            cookies=cookies_dict,
            structured_data=structured,
        )
    # `pool.tab()` context manager closes the tab and returns the
    # worker to the queue automatically — no explicit close needed.


async def _wait_for_images(tab, timeout: float) -> None:
    """Wait until every image on the page has actually decoded.

    The naive `img.complete` check that this used to use is WRONG for
    several common cases — and the consequence is the "screenshot
    captured while images were still rendering" bug that's plagued us
    on Amazon and other heavy e-commerce grids:

      - `img.complete` is `true` for images with NO src at all (yet to
        be assigned by React) — so we'd return early while half the
        product images haven't even started loading.
      - `img.complete` is `true` for FAILED images (404, CORS error) —
        fine, those won't render anyway.
      - `img.complete` flips true the moment bytes arrive, BEFORE the
        browser has decoded the image. The screenshot can fire during
        decode, capturing a partially-rendered tile.
      - `img.complete` doesn't cover `<source srcset>` inside
        `<picture>` (modern responsive images) or CSS `background-image`.

    The robust check: `naturalWidth > 0` proves the image decoded to
    the point where the browser knows its dimensions — i.e. it can be
    painted. Plus we require a streak of 2 consecutive all-loaded
    readings, because React mid-mount can add a new <img> between our
    polls and we'd otherwise return when the FIRST poll happened to
    catch a quiet moment.

    Bounded — a broken CDN shouldn't hang our snapshot forever.
    """
    deadline = asyncio.get_event_loop().time() + timeout
    streak = 0
    while asyncio.get_event_loop().time() < deadline:
        try:
            pending = await tab.evaluate(r"""
                (() => {
                    const imgs = Array.from(document.images);
                    let pending = 0;
                    for (const img of imgs) {
                        // No src yet → either React hasn't mounted it
                        // or it's a placeholder. Either way: not done.
                        if (!img.currentSrc && !img.src) { pending++; continue; }
                        // data: URLs are inlined, always "loaded".
                        if (img.src.startsWith('data:')) continue;
                        // naturalWidth=0 means the image hasn't decoded
                        // enough to know its own dimensions. It will
                        // render as a transparent gap in the screenshot.
                        if (img.naturalWidth === 0) { pending++; continue; }
                        // Belt-and-suspenders: `complete` should be true
                        // by the time naturalWidth > 0, but check
                        // anyway in case the browser is mid-load on a
                        // srcset variant swap.
                        if (!img.complete) { pending++; continue; }
                    }
                    return pending;
                })()
            """)
            if isinstance(pending, tuple):
                pending = pending[0]
            pending = int(pending or 0)
            if pending == 0:
                streak += 1
                if streak >= 2:    # two consecutive clean reads
                    return
            else:
                streak = 0
        except Exception:
            streak = 0
        await asyncio.sleep(0.2)


async def _force_eager_all_images(tab) -> None:
    """One-shot pass that converts every known lazy-image pattern to
    eager-load. Idempotent — safe to call repeatedly. Covers:

      - `<img loading="lazy">` → `loading="eager"`
      - `data-src` / `data-srcset` / `data-lazy-src` (legacy shims)
      - `<picture><source srcset="...">` (re-touched to force re-eval)

    This is the COMPLEMENT to `_install_lazy_image_killer` (which
    catches images mounted AFTER snapshot start). This catches images
    that existed at snapshot start. Calling both is the belt-and-
    suspenders solution to React-driven product grids."""
    await tab.evaluate(r"""
        (() => {
            for (const img of document.querySelectorAll('img[loading="lazy"]')) {
                img.loading = 'eager';
            }
            for (const img of document.querySelectorAll('img[data-src]')) {
                if (!img.src || img.src.startsWith('data:')) img.src = img.dataset.src;
            }
            for (const img of document.querySelectorAll('img[data-srcset]')) {
                if (!img.srcset) img.srcset = img.dataset.srcset;
            }
            for (const img of document.querySelectorAll('img[data-lazy-src]')) {
                if (!img.src) img.src = img.dataset.lazySrc;
            }
            // <picture><source> — re-assign srcset to nudge the browser
            // to pick a variant if the original was set lazily.
            for (const src of document.querySelectorAll('picture source[srcset]')) {
                // self-assign is a no-op but flushes the responsive picker
                src.srcset = src.srcset;
            }
        })()
    """)


async def _install_lazy_image_killer(tab) -> None:
    """Install a MutationObserver in the page that auto-eagers any
    `<img>` added to the DOM after we attach. Lives until the tab
    closes; covers the gap where React mounts product cards during our
    scroll pass — those new images would otherwise keep their
    `loading="lazy"` and never decode in time for our screenshot.

    Cheap: only fires on `childList` mutations + attribute-only edits
    (no layout cost). No-op if the page somehow has no `MutationObserver`
    (every browser since 2014 supports it)."""
    await tab.evaluate(r"""
        (() => {
            if (window.__stealthLazyKillerInstalled) return;
            window.__stealthLazyKillerInstalled = true;

            const eagerOne = (img) => {
                if (img.tagName !== 'IMG') return;
                if (img.loading === 'lazy') img.loading = 'eager';
                if (img.dataset.src && (!img.src || img.src.startsWith('data:'))) {
                    img.src = img.dataset.src;
                }
                if (img.dataset.srcset && !img.srcset) {
                    img.srcset = img.dataset.srcset;
                }
                if (img.dataset.lazySrc && !img.src) {
                    img.src = img.dataset.lazySrc;
                }
            };

            const obs = new MutationObserver((muts) => {
                // Belt-and-suspenders with setScriptExecutionDisabled —
                // during bbox+screenshot capture we set this flag so the
                // observer is a no-op even if its callback queue drains
                // mid-lock on some Chromium builds. Restored before the
                // unlock in snapshot._snapshot_inner's finally block.
                if (window.__stealthLazyKillerPaused) return;
                for (const m of muts) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        if (node.tagName === 'IMG') eagerOne(node);
                        // Newly-mounted subtree (React render) — sweep
                        // every <img> inside it.
                        if (node.querySelectorAll) {
                            for (const img of node.querySelectorAll('img')) {
                                eagerOne(img);
                            }
                        }
                    }
                    if (m.type === 'attributes' && m.target.tagName === 'IMG') {
                        eagerOne(m.target);
                    }
                }
            });
            obs.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['loading', 'data-src', 'data-srcset'],
            });
        })()
    """)


async def _inject_truncation_override(tab) -> None:
    """Inject a stylesheet that disables common CSS-based text truncation.

    Sites use these patterns to visually hide long-form text behind a
    "Show more" / "Continue Reading" button:
      - `display: -webkit-box; -webkit-line-clamp: N; overflow: hidden`
      - `max-height: <px>; overflow: hidden` on prose containers
      - Class names containing `truncate`, `line-clamp`, `clamp`, `ellipsis`
    These are visual-only — the FULL TEXT is already in the DOM, just
    visually clipped. Overriding the CSS reveals it to the snapshot's
    text extraction.

    Pure CSS injection, no DOM mutation, no event dispatch — zero risk
    of triggering paywalls, login walls, or analytics tracking. Universal
    across sites (Quora, Reddit, LinkedIn, Medium, Twitter previews).
    """
    await tab.evaluate("""
        (() => {
            // One-time inject — idempotent via id check.
            if (document.getElementById('__ss_truncation_override__')) return;
            const css = `
                /* Universal line-clamp kill */
                *, *::before, *::after {
                    -webkit-line-clamp: unset !important;
                    line-clamp: unset !important;
                }
                /* Class-based truncation patterns — common across the web.
                   We override max-height + overflow but only on elements
                   that clearly opt-in to truncation via class name, so we
                   don't break legitimate fixed-height containers. */
                [class*="truncate" i],
                [class*="line-clamp" i],
                [class*="lineClamp" i],
                [class*="clamp-" i],
                [class*="-clamp" i],
                [class*="ellipsis" i],
                [class*="-fold" i],
                [class*="readmore" i],
                [class*="read-more" i] {
                    max-height: none !important;
                    overflow: visible !important;
                    -webkit-line-clamp: unset !important;
                    text-overflow: clip !important;
                }
                /* Some sites use a wrapper `<div>` with inline style.
                   Inline `display: -webkit-box` is the classic truncation
                   recipe. We kill ONLY the truncation properties — we
                   intentionally LEAVE `display` alone. Earlier versions
                   overrode display:block which collapsed sibling-card
                   structure on Quora/Reddit (multiple answer cards
                   flowed into one text blob, confusing per-row
                   extraction). The line-clamp removal alone is enough
                   to reveal the hidden text. */
                [style*="line-clamp"],
                [style*="-webkit-box"] {
                    -webkit-line-clamp: unset !important;
                    max-height: none !important;
                    overflow: visible !important;
                }
            `;
            const style = document.createElement('style');
            style.id = '__ss_truncation_override__';
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        })()
    """)


async def _click_expand_buttons(tab) -> int:
    """Click visible "Continue Reading" / "Show more" buttons that reveal
    in-page content. Returns the number of buttons clicked.

    Strict safelist — only click elements whose text MATCHES the
    expansion regex AND does NOT match the auth/subscribe blacklist
    AND is not inside a <form> (to avoid signup gates disguised as
    expand buttons).

    Cap: 30 clicks per page — enough for a Quora thread with 20 answers
    each truncated, well below the threshold where we'd trigger
    expensive page reflows.

    Returns the click count so the caller can decide whether to wait
    for additional stability (no clicks → no need to wait).
    """
    return await tab.evaluate("""
        (() => {
            const EXPAND_RE = /^\\s*(continue reading|read more|see more|show more|view more|view full|expand text|expand answer|…\\s*more|show full|read full)\\s*$/i;
            const BLOCK_RE = /(subscribe|sign\\s*up|sign\\s*in|log\\s*in|paywall|premium|membership|join\\s*now|get\\s*started|free\\s*trial)/i;
            // Selector pool. Quora's "Continue Reading" is a styled <div>
            // with a React onClick handler — NO `onclick` attribute, NO
            // role="button". We have to look at class-name patterns
            // (`*click*`, `*clickable*`, `*readmore*`) which most modern
            // SPAs use for their interactive wrapper convention.
            const SELECTORS = [
                'button', 'a', '[role="button"]',
                'span[onclick]', 'div[onclick]',
                '[class*="click" i]', '[class*="clickable" i]',
                '[class*="readmore" i]', '[class*="read-more" i]',
                '[class*="show-more" i]', '[class*="continue" i]',
                '[aria-label*="continue reading" i]',
                '[aria-label*="show more" i]',
                '[aria-label*="read more" i]',
            ];
            const candidates = new Set();
            for (const sel of SELECTORS) {
                try {
                    for (const el of document.querySelectorAll(sel)) {
                        candidates.add(el);
                    }
                } catch (e) {}
            }
            let clicked = 0;
            for (const el of candidates) {
                if (clicked >= 30) break;
                // Visible & in-DOM?
                if (!el.isConnected) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width < 1 || rect.height < 1) continue;
                // Text match (also check aria-label as a fallback)
                const text = (el.innerText || el.textContent || '').trim();
                const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
                const probe = text || aria;
                if (!probe || probe.length > 50) continue;
                if (!EXPAND_RE.test(probe)) continue;
                if (BLOCK_RE.test(probe)) continue;
                // Skip elements inside forms (login/subscribe gates)
                if (el.closest('form')) continue;
                // Skip if already expanded (some buttons toggle)
                if (el.getAttribute('aria-expanded') === 'true') continue;
                // Skip if href looks like external nav (full URL, not '#')
                if (el.tagName === 'A') {
                    const href = el.getAttribute('href') || '';
                    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                        // External link masquerading as 'read more' — skip
                        if (/^https?:\\/\\//.test(href) || href.startsWith('/')) continue;
                    }
                }
                try {
                    el.click();
                    clicked++;
                } catch (e) {}
            }
            return clicked;
        })()
    """)


async def _install_stability_shim(tab) -> None:
    """Install a MutationObserver that timestamps the last DOM change.

    Combined with `document.readyState` and an in-viewport image-decode
    check, this gives `_wait_until_page_stable` a three-signal "page is
    quiet" detector that bails early on fast pages and waits patiently
    on slow ones.

    Lives until the tab closes (which is the end of the snapshot — pool
    closes the tab via context manager). Idempotent — safe to call
    multiple times per page lifetime.

    Why MutationObserver rather than wrapping fetch/XHR: any meaningful
    network response from a real-world page eventually causes a DOM
    write (data renders into a card, a skeleton flips to content, an
    image src is set). Network requests that DON'T touch the DOM —
    analytics beacons, fire-and-forget telemetry — also don't matter
    for snapshot quality. So tracking DOM activity gives us the right
    signal with far less surface area than monkey-patching fetch + XHR
    + sendBeacon + WebSocket + EventSource."""
    await tab.evaluate(r"""
        (() => {
            if (window.__stealthStabilityInstalled) return;
            window.__stealthStabilityInstalled = true;
            window.__stealthLastMutation = performance.now();
            const mo = new MutationObserver(() => {
                window.__stealthLastMutation = performance.now();
            });
            mo.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true,
            });
        })()
    """)


async def _wait_until_page_stable(
    tab,
    *,
    min_wait: float = 0.15,
    max_wait: float = 10.0,
    quiet_window: float = 0.4,
) -> float:
    """Adaptive 'page is quiet' wait — REPLACES fixed asyncio.sleep() calls.

    Bails as soon as ALL of these are true:
      - document.readyState === 'complete'
      - No DOM mutations in the last `quiet_window` seconds
        (covers XHR/fetch responses that render, image src writes,
         React hydration, infinite-scroll inserts — anything that
         actually changes what gets snapshotted)
      - All in-viewport images have decoded (naturalWidth > 0)
      - At least `min_wait` seconds have elapsed since we started
        (floor: don't bail on a still-rendering empty page that
         happens to look quiet for 100ms)

    Hard-capped at `max_wait`. Polls every 100ms — cheap.

    Returns elapsed seconds (for observability). The whole point of
    this function: a fast static page returns in ~quiet_window seconds
    (~400ms). A slow SPA waits up to max_wait. Same code path, no
    branching on site type, no fixed sleeps to tune per site."""
    loop = asyncio.get_event_loop()
    start = loop.time()
    deadline = start + max_wait
    floor_at = start + min_wait

    while True:
        now = loop.time()
        if now >= deadline:
            return now - start
        try:
            # Return a delimited string rather than an array — nodriver's
            # `tab.evaluate()` wraps each array element as a CDP
            # RemoteObject dict, which would force a per-element
            # round-trip to unwrap. A single string is one round-trip
            # and parses cleanly.
            raw = await tab.evaluate(r"""
                (() => {
                    const last = window.__stealthLastMutation || 0;
                    const ago = (performance.now() - last) / 1000;
                    let pending = 0;
                    for (const img of document.images) {
                        const r = img.getBoundingClientRect();
                        // Only worry about images at/near the viewport.
                        // Off-screen images may legitimately not have
                        // loaded yet and shouldn't gate the snapshot.
                        if (r.bottom < -200 || r.top > window.innerHeight + 500) continue;
                        if (!img.currentSrc && !img.src) { pending++; continue; }
                        if (img.src && img.src.startsWith('data:')) continue;
                        if (img.naturalWidth === 0) pending++;
                    }
                    const ready = document.readyState === 'complete' ? 1 : 0;
                    return ready + '|' + ago.toFixed(3) + '|' + pending;
                })()
            """)
            if isinstance(raw, tuple):
                raw = raw[0]
        except Exception:
            await asyncio.sleep(0.1)
            continue

        try:
            parts = str(raw).split("|")
            ready = int(parts[0]) == 1
            mutation_ago = float(parts[1])
            pending_images = int(parts[2])
        except (ValueError, IndexError):
            await asyncio.sleep(0.1)
            continue

        all_quiet = (
            ready
            and mutation_ago >= quiet_window
            and pending_images == 0
            and now >= floor_at
        )
        if all_quiet:
            return now - start

        await asyncio.sleep(0.1)


async def _wait_for_stable_height(tab, timeout: float, samples: int = 3) -> None:
    """Poll document.body.scrollHeight until it stops changing. Returns
    as soon as `samples` consecutive polls agree. Bounded."""
    deadline = asyncio.get_event_loop().time() + timeout
    last: int | None = None
    streak = 0
    while asyncio.get_event_loop().time() < deadline:
        try:
            h = await tab.evaluate("document.documentElement.scrollHeight")
            if isinstance(h, tuple):
                h = h[0]
            h = int(h)
        except Exception:
            h = None
        if h is not None and h == last:
            streak += 1
            if streak >= samples:
                return
        else:
            streak = 1
            last = h
        await asyncio.sleep(0.2)


async def _evaluate_json(tab, expression: str) -> dict:
    """Run JS via CDP Runtime.evaluate with return_by_value=True so we
    always get a dict back (not a RemoteObject handle). Logs and
    returns an empty shape if the eval threw in-page."""
    try:
        result = await tab.send(cdp.runtime.evaluate(
            expression=expression,
            return_by_value=True,
            await_promise=False,
            allow_unsafe_eval_blocked_by_csp=True,
        ))
    except TypeError:
        # Older nodriver builds don't accept allow_unsafe_eval_blocked_by_csp.
        result = await tab.send(cdp.runtime.evaluate(
            expression=expression,
            return_by_value=True,
            await_promise=False,
        ))

    # CDP Runtime.evaluate returns a (RemoteObject, ExceptionDetails) tuple.
    remote, exc = (result if isinstance(result, tuple) else (result, None))

    if exc is not None:
        text = getattr(exc, "text", None) or getattr(exc, "exception", None)
        log.warning("snapshot.eval_raised", extra={"text": repr(text)})
        return {"elements": [], "viewport": {}, "page": {}}

    value = getattr(remote, "value", None)
    if value is None:
        log.warning("snapshot.cdp_no_value")
        return {"elements": [], "viewport": {}, "page": {}}
    if not isinstance(value, dict):
        log.warning("snapshot.cdp_wrong_type", extra={"type": type(value).__name__})
        return {"elements": [], "viewport": {}, "page": {}}
    return value


async def _wait_ready(tab, timeout: float) -> None:
    """Poll document.readyState until 'complete' or timeout. nodriver
    has no generic wait_for_load helper — we roll our own so a dead
    page never traps us past the timeout."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            state = await tab.evaluate("document.readyState")
            if isinstance(state, tuple):
                state = state[0]
            if state == "complete":
                return
        except Exception:
            pass
        await asyncio.sleep(0.15)


async def _scroll_full_height(tab) -> None:
    """Scroll through 8 viewport heights max, triggering lazy images
    without trapping on infinite scroll."""
    await tab.evaluate(
        r"""
        (async () => {
            const step = window.innerHeight * 0.9;
            const max = window.innerHeight * 8;
            for (let y = 0; y < max; y += step) {
                window.scrollTo(0, y);
                await new Promise(r => setTimeout(r, 150));
                if (y + step >= document.documentElement.scrollHeight) break;
            }
        })()
        """
    )
