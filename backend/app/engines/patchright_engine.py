"""Patchright engine — undetected Chromium via rebrowser-patches.

Why this engine exists:
  nodriver and camoufox are both great, but they leave gaps. nodriver
  patches Chromium at the CDP/flag layer — solid for basic Cloudflare
  but DataDome's runtime-leak sensors (Object.defineProperty traps on
  navigator, Runtime.evaluate stack inspection, cdc_ probe via getter
  hooks) still catch it. camoufox switches to Firefox which sidesteps
  every Chromium-specific detector but is not strictly better — some
  sites SPECIFICALLY profile Firefox + bundled-WebDriver quirks.

  Patchright is the third leg: Chromium-based (so the site sees Chrome
  TLS/H2/UA, blending into 70%+ of real traffic) BUT with the full
  rebrowser-patches suite applied — runtime-leak fixes that nodriver's
  flag-only approach can't reach. MIT-licensed. Same Playwright async
  API as camoufox so the engine code mirrors it.

What this engine is GREAT for:
  - DataDome behavioral layer — patches the exact Runtime.evaluate +
    Object.defineProperty hooks DataDome calls
  - Akamai BMP — Chromium TLS but with no runtime detection signal
  - PerimeterX behavioral mode — combines with humanize-equivalent
    `--start-maximized` + viewport randomization
  - Sites that profile Firefox specifically and let Chrome through

What this engine COSTS:
  - ~250MB Chromium binary (one-time, via `patchright install chromium`)
  - ~500MB RAM per browser instance
  - Cold-start ~2-4s (Playwright launch overhead)
  - Per-page latency ~6-10s typical (slightly faster than camoufox)

What this engine CAN'T do:
  - Native CDP — uses Playwright async API (same as camoufox)
  - Beat Firefox-only detectors (camoufox still wins those)
  - Reuse nodriver's existing browser pool (separate process)

Router strategy:
  - Chromium-based with CDP_NATIVE capability (patches don't expose
    automation flags by design)
  - JS_EXEC, SCREENSHOT, DOM_QUERY, PROXY_SUPPORT, COOKIE_PERSISTENCE
  - Cost: 2¢/page (same as camoufox — RAM-bound)
  - VENDOR_AFFINITY slots patchright between nodriver and camoufox for
    Chromium-tractable detectors (datadome, akamai, perimeterx, imperva)
  - Skipped from kasada (Chromium-targeted; camoufox/Firefox wins)
  - Skipped from cloudflare-easy (nodriver suffices)

Install:
  pip install patchright>=1.55
  patchright install chromium      # downloads patched Chromium binary

Lazy import — same pattern as camoufox. Router init stays light when
patchright isn't installed.
"""

from __future__ import annotations

import base64
import os
import shutil
import tempfile
import time
from typing import Any, Optional

from .base import (
    Capability,
    EngineFailedError,
    EngineSnapshotResult,
    Requirements,
)

# Same element extractor as camoufox/nodriver — engine-agnostic schema.
# Copied (not imported) to avoid coupling between engines.
_EXTRACT_ELEMENTS_JS = """
(() => {
  const SELECTOR = 'a, button, input, select, textarea, h1, h2, h3, h4, '
                 + 'img, p, span, li, label, form, nav, header, footer, '
                 + 'section, article, main, [role="button"], [role="link"]';
  const out = [];
  const all = document.querySelectorAll(SELECTOR);
  const cssPath = (el) => {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + el.id;
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.className && typeof cur.className === 'string') {
        const cls = cur.className.split(/\\s+/).filter(Boolean)[0];
        if (cls) part += '.' + cls;
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  for (const el of all) {
    if (out.length >= 100) break;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const text = (el.innerText || el.value || el.alt || '').trim();
    out.push({
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, 500),
      css: cssPath(el),
      xpath: '',
      attrs: {
        id: el.id || null,
        class: (typeof el.className === 'string') ? el.className : null,
        href: el.href || null,
        name: el.name || null,
        type: el.type || null,
      },
      bbox: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
    });
  }
  return {
    elements: out,
    real_total: all.length,
    page_height: Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement ? document.documentElement.scrollHeight : 0,
    ),
  };
})()
"""


class PatchrightEngine:
    """Patchright-driven Chromium engine with rebrowser-patches applied.

    Sits between nodriver (Chromium + flag patches) and camoufox (Firefox)
    in the escalation chain — same browser kernel as nodriver but with
    deeper runtime-leak fixes that close the DataDome/Akamai gap.
    """

    name = "patchright"
    capabilities = (
        Capability.JS_EXEC
        | Capability.SCREENSHOT
        | Capability.DOM_QUERY
        | Capability.CDP_NATIVE          # patches keep CDP attach hidden
        | Capability.PROXY_SUPPORT
        | Capability.COOKIE_PERSISTENCE
        # Not advertising FIREFOX_ENGINE — patchright is Chromium.
        # Not advertising TLS_IMPERSONATION — uses Chromium's TLS stack.
        # Not advertising BEHAVIORAL — no built-in mouse-path sim
        # (caller can drive it via Playwright API if needs_interaction=True).
    )
    cost_per_request_cents = 2  # RAM-bound, similar to camoufox

    async def is_available(self) -> bool:
        """Verify patchright package + that the patched Chromium binary
        is downloaded. Patchright shares Playwright's browser cache layout.
        """
        try:
            from patchright.async_api import async_playwright  # noqa: F401
        except Exception:
            return False
        # Probe for a downloaded Chromium. Patchright stores under the
        # Playwright cache path. Cross-platform check via env var first.
        cache_root = os.environ.get(
            "PLAYWRIGHT_BROWSERS_PATH",
            os.path.expanduser("~/Library/Caches/ms-playwright"),
        )
        # Linux falls back to ~/.cache/ms-playwright if HOME is set.
        if not os.path.isdir(cache_root):
            cache_root = os.path.expanduser("~/.cache/ms-playwright")
        if not os.path.isdir(cache_root):
            return False
        # Any chromium-* subdir means we have a binary; patchright reuses
        # Playwright's naming (chromium-XXXX where XXXX is the build id).
        try:
            for entry in os.listdir(cache_root):
                if entry.startswith("chromium-") or entry.startswith("chromium_headless"):
                    return True
        except OSError:
            return False
        return False

    async def snapshot(
        self,
        url: str,
        *,
        requirements: Requirements,
    ) -> EngineSnapshotResult:
        """Drive one snapshot through patchright (Playwright Chromium API).

        Uses launch_persistent_context per patchright's stealth recipe —
        a clean user_data_dir per snapshot avoids cross-site cookie leak
        while letting patchright's per-session storage fingerprint settle.
        """
        from patchright.async_api import async_playwright

        proxy_config = self._maybe_proxy_config(requirements.vendor_hint)

        # Per-snapshot temp user data dir. Cleaned up in finally.
        # Persistent context is patchright's recommended launch mode —
        # the cookie/storage state stays attached to the launched
        # browser instance, which a few sites use as a sign of "real user".
        user_data_dir = tempfile.mkdtemp(prefix="patchright-")

        viewport_w = 390 if requirements.needs_mobile_ui else 1440
        viewport_h = 844 if requirements.needs_mobile_ui else 900

        t0 = time.perf_counter()
        try:
            async with async_playwright() as p:
                # channel="chrome" uses real Chrome if installed (best
                # stealth — site sees actual Chrome). Falls back to
                # patched-Chromium when channel arg is omitted, which
                # is what we default to (no system Chrome dep).
                launch_kwargs: dict[str, Any] = {
                    "user_data_dir": user_data_dir,
                    "headless": True,
                    # no_viewport=True tells patchright not to override
                    # the page's natural viewport — important for stealth
                    # because forcing viewport leaks an automation signal.
                    "no_viewport": True,
                }
                if os.environ.get("PATCHRIGHT_CHANNEL"):
                    launch_kwargs["channel"] = os.environ["PATCHRIGHT_CHANNEL"]
                if proxy_config:
                    launch_kwargs["proxy"] = proxy_config

                context = await p.chromium.launch_persistent_context(**launch_kwargs)
                try:
                    page = await context.new_page()
                    # Set viewport explicitly even with no_viewport — we
                    # need a known size for screenshot determinism. This
                    # uses set_viewport_size (post-launch) which doesn't
                    # carry the automation-signal that pre-launch viewport
                    # spoofing has.
                    await page.set_viewport_size({"width": viewport_w, "height": viewport_h})

                    timeout_ms = int(min(requirements.max_latency_s, 25.0) * 1000)
                    await page.goto(url, timeout=timeout_ms, wait_until="domcontentloaded")

                    try:
                        await page.wait_for_load_state("networkidle", timeout=5000)
                    except Exception:
                        pass

                    # Fingerprint-test affinity: same 6s settle as camoufox.
                    # Patchright handles it cleanly via wait_for_timeout.
                    if requirements.vendor_hint == "fingerprint-test":
                        try:
                            await page.wait_for_timeout(6000)
                        except Exception:
                            pass

                    raw_title = await page.title()
                    title = (raw_title or "")[:200]

                    screenshot_bytes = await page.screenshot(full_page=False)
                    screenshot_b64 = base64.b64encode(screenshot_bytes).decode("ascii")

                    extract = await page.evaluate(_EXTRACT_ELEMENTS_JS)
                    elements = extract.get("elements", []) if isinstance(extract, dict) else []
                    real_total = extract.get("real_total", 0) if isinstance(extract, dict) else 0
                    page_height = (
                        extract.get("page_height", viewport_h)
                        if isinstance(extract, dict)
                        else viewport_h
                    )
                finally:
                    await context.close()
        except Exception as e:
            raise EngineFailedError(
                f"patchright snapshot failed: {type(e).__name__}: {e}",
                engine=self.name,
                retriable_on_other_engine=True,
            ) from e
        finally:
            shutil.rmtree(user_data_dir, ignore_errors=True)

        return EngineSnapshotResult(
            url=url,
            title=title,
            screenshot_base64=screenshot_b64,
            elements=elements,
            viewport={"width": viewport_w, "height": viewport_h},
            page={"width": viewport_w, "height": int(page_height)},
            engine_name=self.name,
            elapsed_s=round(time.perf_counter() - t0, 3),
            cost_cents=self.cost_per_request_cents,
            proxy_used=self._proxy_label(proxy_config),
            cookies_carried=0,
            notes=f"chromium+patches, dom-total={real_total}, returned={len(elements)}",
        )

    @staticmethod
    def _proxy_label(proxy_config: Optional[dict[str, str]]) -> Optional[str]:
        if not proxy_config:
            return None
        server = proxy_config.get("server", "")
        if "@" in server:
            return server.split("@", 1)[-1]
        return server or None

    @staticmethod
    def _maybe_proxy_config(vendor_hint: Optional[str] = None) -> Optional[dict[str, str]]:
        """Same proxy plumbing as camoufox — routes residential when
        vendor_hint indicates IP-rep-sensitive vendor and a residential
        pool is configured."""
        try:
            from app import proxies
            url = proxies.pick_for_vendor(vendor_hint)
            if not url:
                return None
            from urllib.parse import urlparse
            p = urlparse(url)
            return {
                "server": f"{p.scheme}://{p.hostname}:{p.port}",
                "username": p.username or "",
                "password": p.password or "",
            }
        except Exception:
            return None
