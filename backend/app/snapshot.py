"""URL → (screenshot + element catalog) via nodriver + stealth."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from nodriver import cdp

from app.browser import pool
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
    tab = await pool.open_tab("about:blank")
    try:
        # Resize viewport via CDP (nodriver's default window size isn't
        # guaranteed to match a 1440x900 layout the picker expects).
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
        await asyncio.sleep(0.6)

        # Scroll to trigger lazy images, then back to top.
        await _scroll_full_height(tab)
        await tab.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(0.4)

        # Full-page screenshot via CDP. `capture_beyond_viewport=True`
        # is what gives us the full-height PNG we render the picker over.
        shot = await tab.send(cdp.page.capture_screenshot(
            format_="png",
            capture_beyond_viewport=True,
        ))
        screenshot_b64 = shot if isinstance(shot, str) else str(shot)

        data = await tab.evaluate(COLLECT_ELEMENTS_JS, return_by_value=True)

        # nodriver's evaluate sometimes wraps results in a tuple
        # (value, meta) depending on the version — normalize.
        if isinstance(data, tuple):
            data = data[0]
        if not isinstance(data, dict):
            data = {"elements": [], "viewport": {}, "page": {}}

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
