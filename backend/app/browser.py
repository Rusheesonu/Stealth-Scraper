"""Shared nodriver browser pool.

Why nodriver instead of Playwright — nodriver patches Chromium at the
flag/CDP level to close automation leaks that Playwright+stealth-JS
can't reach. It clears soft Cloudflare challenges and Turnstile
"invisible mode" out of the box, even without proxies. For hardened
targets (Akamai, PerimeterX on hot sites) you still need residential
proxies — but the baseline is materially stronger.

Lifecycle: single nodriver Browser, lazy-init on first request, kept
hot for the process lifetime. Per-request we open a fresh Tab, inject
stealth via CDP `addScriptToEvaluateOnNewDocument` so it runs before
any page JS on every nav, then navigate + screenshot + close tab.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import nodriver as uc
from nodriver import cdp

from app.stealth import ULTRA_STEALTH_CHROMIUM_ARGS, ULTRA_STEALTH_JS


class BrowserPool:
    def __init__(self) -> None:
        self._browser: Optional[uc.Browser] = None
        # nodriver is not safe under concurrent CDP traffic on a single
        # browser — serialize all tab work through one lock.
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._browser is not None:
            return
        self._browser = await uc.start(browser_args=ULTRA_STEALTH_CHROMIUM_ARGS)

    async def stop(self) -> None:
        try:
            if self._browser is not None:
                result = self._browser.stop()
                if hasattr(result, "__await__"):
                    await result
        finally:
            self._browser = None

    async def open_tab(self, url: str = "about:blank") -> uc.Tab:
        """Open a tab with stealth JS pre-installed. Caller must close it.

        nodriver's `browser.get()` opens a new tab each call — we don't
        need a `new_tab` flag. We open on about:blank, wire up stealth,
        then the caller navigates to the real URL so the init-script
        catches that navigation before any page JS runs.
        """
        async with self._lock:
            if self._browser is None:
                await self.start()
            assert self._browser is not None
            tab = await self._browser.get(url)

        # Register stealth JS to run before any page script on every
        # navigation. CDP method: Page.addScriptToEvaluateOnNewDocument.
        try:
            await tab.send(
                cdp.page.add_script_to_evaluate_on_new_document(source=ULTRA_STEALTH_JS)
            )
        except Exception:
            # Fallback: inject once on the current document. Most basic
            # detectors check fingerprint bits on first script eval, so
            # this still clears the soft checks.
            try:
                await tab.evaluate(ULTRA_STEALTH_JS)
            except Exception:
                pass
        return tab

    @property
    def running(self) -> bool:
        return self._browser is not None


pool = BrowserPool()
