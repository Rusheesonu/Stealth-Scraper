"""URL → (screenshot + element catalog) pipeline."""

from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from typing import Any

from playwright.async_api import TimeoutError as PWTimeoutError

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


async def take_snapshot(url: str, *, viewport_width: int = 1440, viewport_height: int = 900) -> SnapshotResult:
    """Navigate to `url`, screenshot the full page, and return every
    extractable element with its bounding box + selectors."""
    ctx = await pool.context(viewport_width, viewport_height)
    page = await ctx.new_page()
    try:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=25_000)
        except PWTimeoutError:
            # Fall through — we can still snapshot a partially loaded page.
            pass

        # Give client-side renders a moment to settle without blocking forever.
        try:
            await page.wait_for_load_state("networkidle", timeout=4_000)
        except PWTimeoutError:
            pass

        # Scroll through the page so lazy-loaded images render before we screenshot.
        await _scroll_full_height(page)
        await page.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(0.3)

        screenshot = await page.screenshot(full_page=True, type="png")
        data = await page.evaluate(COLLECT_ELEMENTS_JS)

        return SnapshotResult(
            url=data.get("url", url),
            title=data.get("title", ""),
            screenshot_base64=base64.b64encode(screenshot).decode("ascii"),
            viewport=data.get("viewport", {"width": viewport_width, "height": viewport_height}),
            page=data.get("page", {"width": viewport_width, "height": viewport_height}),
            elements=data.get("elements", []),
        )
    finally:
        await page.close()
        await ctx.close()


async def _scroll_full_height(page) -> None:
    """Incrementally scroll to the bottom to trigger lazy-loaded content.
    Bounded — we never scroll past 8 viewport heights, so a page with
    infinite scroll doesn't trap us."""
    await page.evaluate(
        """
        async () => {
            const step = window.innerHeight * 0.9;
            const max = window.innerHeight * 8;
            for (let y = 0; y < max; y += step) {
                window.scrollTo(0, y);
                await new Promise(r => setTimeout(r, 150));
                if (y + step >= document.documentElement.scrollHeight) break;
            }
        }
        """
    )
