"""Shared Playwright browser lifecycle.

One Chromium instance for the lifetime of the API process. Cheaper than
spawning a new browser per request, and the element-detection script we
inject is pure JS so there's no per-request state to worry about.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from playwright.async_api import Browser, BrowserContext, Playwright, async_playwright


_STEALTH_JS = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
window.chrome = window.chrome || { runtime: {} };
"""

_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


class BrowserPool:
    """Lazy-init singleton. Browsers are expensive to start so we keep one
    hot for the lifetime of the server."""

    def __init__(self) -> None:
        self._pw: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._browser is not None:
            return
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
                "--no-sandbox",
            ],
        )

    async def stop(self) -> None:
        try:
            if self._browser is not None:
                await self._browser.close()
        finally:
            self._browser = None
            if self._pw is not None:
                await self._pw.stop()
                self._pw = None

    async def context(self, viewport_width: int = 1440, viewport_height: int = 900) -> BrowserContext:
        async with self._lock:
            if self._browser is None:
                await self.start()
        assert self._browser is not None
        ctx = await self._browser.new_context(
            user_agent=_USER_AGENT,
            viewport={"width": viewport_width, "height": viewport_height},
            device_scale_factor=1,
            locale="en-US",
        )
        await ctx.add_init_script(_STEALTH_JS)
        return ctx


pool = BrowserPool()
