"""URL → (screenshot + element catalog) via nodriver + stealth."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from nodriver import cdp

from app.browser import pool, with_transient_retry
from app.extract_js import COLLECT_ELEMENTS_JS


@dataclass
class SnapshotResult:
    url: str
    title: str
    screenshot_base64: str
    viewport: dict[str, int]
    page: dict[str, int]
    elements: list[dict[str, Any]]


async def take_snapshot(
    url: str,
    *,
    viewport_width: int = 1440,
    viewport_height: int = 900,
) -> SnapshotResult:
    """One-shot snapshot with a restart+retry on transient nodriver flakes
    (StopIteration in CDP cleanup, target crashed, connection closed)."""

    async def _once() -> SnapshotResult:
        return await _snapshot_inner(url, viewport_width, viewport_height)

    return await with_transient_retry(_once, label="snapshot")


async def _snapshot_inner(url: str, viewport_width: int, viewport_height: int) -> SnapshotResult:
    """Order matters more than anything in this function.

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
    tab = await pool.open_tab("about:blank")
    try:
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
        await asyncio.sleep(0.5)

        # 3. Force-eager all lazy images BEFORE scrolling. That way when
        # intersection-observers fire during the scroll pass, the images
        # they reference are already downloading rather than waiting for
        # an observer hit. Belt-and-suspenders: also handle data-src,
        # data-srcset, and data-lazy-src shims common on old scripts.
        await tab.evaluate(
            r"""
            (() => {
                document.querySelectorAll('img[loading="lazy"]').forEach(img => {
                    img.loading = 'eager';
                });
                document.querySelectorAll('img[data-src]').forEach(img => {
                    if (!img.src || img.src.startsWith('data:')) img.src = img.dataset.src;
                });
                document.querySelectorAll('img[data-srcset]').forEach(img => {
                    if (!img.srcset) img.srcset = img.dataset.srcset;
                });
                document.querySelectorAll('img[data-lazy-src]').forEach(img => {
                    if (!img.src) img.src = img.dataset.lazySrc;
                });
            })()
            """
        )

        # 4. Scroll through the full page to hit any observer-based
        # loaders that skip force-eager. Bounded — no infinite scroll.
        await _scroll_full_height(tab)

        # 5. Scroll back to origin and wait for the layout to settle.
        # Image decode is async; we wait for it explicitly here so our
        # bbox collection sees fully-rendered sizes.
        await tab.evaluate("window.scrollTo(0, 0)")
        await _wait_for_images(tab, timeout=4.0)
        # Poll until two consecutive samples of body scrollHeight agree —
        # catches the Amazon failure mode where a banner / filter sidebar
        # lazy-inserts content right around the 500ms mark and shoves
        # everything below it down ~70px. Without this, bbox collection
        # happens on the pre-insert layout and the screenshot ends up
        # capturing the post-insert layout, producing that "coming above
        # again" vertical offset. Cheap belt-and-suspenders; bounded.
        await _wait_for_stable_height(tab, timeout=3.0)
        await asyncio.sleep(0.3)

        # 6. COLLECT ELEMENTS FIRST. This is the bit that guarantees
        # bboxes match the screenshot: at this moment the layout is
        # stable, scroll=0, viewport unchanged since initial set.
        data = await _evaluate_json(tab, COLLECT_ELEMENTS_JS)

        # 7. THEN screenshot. capture_beyond_viewport briefly expands
        # the layout to capture the full page height. Even if that
        # expansion triggers any transient reflow, our bboxes from
        # step 6 are already frozen, so overlay and screenshot align.
        shot = await tab.send(cdp.page.capture_screenshot(
            format_="png",
            capture_beyond_viewport=True,
        ))
        screenshot_b64 = shot if isinstance(shot, str) else str(shot)

        print(
            f"[snapshot] {url} → {len(data.get('elements', []))} elements "
            f"(page {data.get('page', {}).get('width')}×{data.get('page', {}).get('height')})"
        )

        return SnapshotResult(
            url=data.get("url", url),
            title=data.get("title", ""),
            screenshot_base64=screenshot_b64,
            viewport=data.get("viewport", {"width": viewport_width, "height": viewport_height}),
            page=data.get("page", {"width": viewport_width, "height": viewport_height}),
            elements=data.get("elements", []),
        )
    finally:
        try:
            await tab.close()
        except Exception:
            pass


async def _wait_for_images(tab, timeout: float) -> None:
    """Wait until every <img> on the page has either loaded or failed.
    Bounded — a broken CDN shouldn't hang our snapshot forever."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            done = await tab.evaluate(
                "Array.from(document.images).every(img => img.complete)"
            )
            if isinstance(done, tuple):
                done = done[0]
            if done:
                return
        except Exception:
            pass
        await asyncio.sleep(0.25)


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
        print(f"[snapshot] in-page eval raised: {text!r}")
        return {"elements": [], "viewport": {}, "page": {}}

    value = getattr(remote, "value", None)
    if value is None:
        print("[snapshot] CDP returned no value (type may not be serializable)")
        return {"elements": [], "viewport": {}, "page": {}}
    if not isinstance(value, dict):
        print(f"[snapshot] CDP returned {type(value).__name__} instead of dict")
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
