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

Resilience: nodriver has a set of well-known transient errors
(StopIteration from its CDP cleanup coroutine, target crashed, connection
closed) that happen on healthy browsers under certain timing races. We
detect these by error string and restart+retry once, matching the
pattern from the production stealthio scraper.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import nodriver as uc
from nodriver import cdp

from app.stealth import ULTRA_STEALTH_CHROMIUM_ARGS, ULTRA_STEALTH_JS


_TRANSIENT_ERROR_MARKERS = (
    "StopIteration",
    "coroutine raised StopIteration",
    "Target crashed",
    "Connection closed",
    "connection closed",
    "websocket",
)


def is_transient_nodriver_error(exc: BaseException | str) -> bool:
    """Matches the nodriver flakes that clear on a browser restart."""
    msg = str(exc) if not isinstance(exc, str) else exc
    if not msg:
        return False
    return any(m in msg for m in _TRANSIENT_ERROR_MARKERS)


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

    async def restart(self) -> None:
        """Hard reset — called after we see a transient CDP error. Any
        in-flight tabs are toast; caller must re-open."""
        await self.stop()
        await self.start()

    async def _ensure_live(self) -> None:
        """Bounded probe against about:blank. If the browser handle is
        a zombie (OOM, crash, websocket dropped) we tear it down so the
        next caller does a clean restart."""
        if self._browser is None:
            return
        try:
            probe = await asyncio.wait_for(
                self._browser.get("about:blank"), timeout=5.0
            )
            try:
                await probe.close()
            except Exception:
                pass
        except Exception:
            try:
                await self.stop()
            except Exception:
                pass
            self._browser = None

    async def open_tab(self, url: str = "about:blank") -> uc.Tab:
        """Open a tab with stealth JS pre-installed. Caller must close it.

        nodriver's `browser.get()` opens a new tab each call — we don't
        need a `new_tab` flag. We open on about:blank, wire up stealth,
        then the caller navigates to the real URL so the init-script
        catches that navigation before any page JS runs.
        """
        async with self._lock:
            await self._ensure_live()
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


async def with_transient_retry(op, *, label: str = "op"):
    """Run `op()` (a zero-arg async callable). If it raises a transient
    nodriver flake, restart the browser and run once more. Non-transient
    errors propagate on the first raise."""
    try:
        return await op()
    except Exception as e:
        if not is_transient_nodriver_error(e):
            raise
        print(f"[{label}] transient nodriver error ({e!r}) — restart + retry")
        try:
            await pool.restart()
        except Exception as restart_err:
            # If restart itself fails, surface the original error — it's
            # more informative than "restart failed".
            print(f"[{label}] restart also failed: {restart_err!r}")
            raise e from None
        return await op()
