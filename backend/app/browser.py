"""Shared nodriver browser pool — stealth + (optionally) residential proxy.

Why nodriver instead of Playwright — nodriver patches Chromium at the
flag/CDP level to close automation leaks that Playwright+stealth-JS
can't reach. Clears soft Cloudflare challenges and Turnstile invisible
mode out of the box, even without proxies. For harder targets we layer
a residential proxy via Chromium's --proxy-server flag.

Lifecycle: single nodriver Browser, lazy-init on first request, kept
hot for the process lifetime. Per-request we open a fresh Tab, inject
stealth via CDP `addScriptToEvaluateOnNewDocument` so it runs before
any page JS on every nav, then navigate + screenshot + close tab.

Proxies: if `backend/data/proxies.json` is populated, the pool picks a
random proxy at browser-start time. Auth challenges are auto-answered
via CDP `Fetch.authRequired` so Chromium doesn't hang on the basic-auth
dialog. On restart (transient error path) we rotate to a new proxy.

Resilience: nodriver has well-known transient errors (StopIteration in
its CDP cleanup coroutine, target crashed, websocket closed) that
happen on healthy browsers under timing races. We detect by error
string and restart+retry once.
"""

from __future__ import annotations

import asyncio
from typing import Optional

import nodriver as uc
from nodriver import cdp

from app import proxies
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


# (host, port, user, password) — what we hand to Chromium + CDP auth handler.
ProxyTuple = tuple[str, int, str, str]


class BrowserPool:
    def __init__(self) -> None:
        self._browser: Optional[uc.Browser] = None
        # nodriver is not safe under concurrent CDP traffic on a single
        # browser — serialize tab work through one lock.
        self._lock = asyncio.Lock()
        self._current_proxy: Optional[ProxyTuple] = None

    # ── lifecycle ─────────────────────────────────────────────────────────

    async def start(self, proxy: Optional[ProxyTuple] = None) -> None:
        if self._browser is not None:
            return

        args = list(ULTRA_STEALTH_CHROMIUM_ARGS)
        if proxy:
            host, port, user, password = proxy
            args.append(f"--proxy-server=http://{host}:{port}")
            # We don't want the proxy to intercept localhost / about:blank
            # which would 502 on tab init.
            args.append("--proxy-bypass-list=<-loopback>;127.0.0.1;localhost")
            self._current_proxy = proxy
            print(f"[browser] starting with proxy {host}:{port}")
        else:
            self._current_proxy = None
            print("[browser] starting without proxy (direct)")

        self._browser = await uc.start(browser_args=args)

        # Proxy auth — set up the CDP handler immediately after browser is up
        # so the very first nav already has it ready.
        if proxy:
            await self._setup_proxy_auth(proxy[2], proxy[3])

    async def stop(self) -> None:
        try:
            if self._browser is not None:
                result = self._browser.stop()
                if hasattr(result, "__await__"):
                    await result
        finally:
            self._browser = None
            self._current_proxy = None

    async def restart(self, *, rotate_proxy: bool = True) -> None:
        """Hard reset — called after we see a transient CDP error. Any
        in-flight tabs are toast; caller must re-open.

        rotate_proxy=True picks a new proxy from the pool (default — gives us
        a fresh egress IP each restart, which is half the point of having
        a proxy pool). Pass False to keep the same proxy if you're sure the
        error wasn't IP-related."""
        await self.stop()
        new_proxy: Optional[ProxyTuple] = None
        if rotate_proxy and proxies.available():
            new_proxy = proxies.host_port_user_pass()
        await self.start(proxy=new_proxy)

    # ── health / liveness ─────────────────────────────────────────────────

    @property
    def running(self) -> bool:
        return self._browser is not None

    def current_proxy_label(self) -> Optional[str]:
        """`host:port` of the current proxy, or None if direct. Safe to expose
        from /health — credentials are not included."""
        if not self._current_proxy:
            return None
        host, port, *_ = self._current_proxy
        return f"{host}:{port}"

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

    # ── tab open w/ stealth init ──────────────────────────────────────────

    async def open_tab(self, url: str = "about:blank") -> uc.Tab:
        """Open a tab with stealth JS pre-installed. Caller must close it.

        Lazy-starts the browser on first call. If a proxy pool is configured,
        the first start picks a random proxy; subsequent restarts rotate.
        """
        async with self._lock:
            await self._ensure_live()
            if self._browser is None:
                # First request — pick a proxy if pool is configured, else go direct.
                proxy = proxies.host_port_user_pass() if proxies.available() else None
                await self.start(proxy=proxy)
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
            # this still clears the soft checks even without the init hook.
            try:
                await tab.evaluate(ULTRA_STEALTH_JS)
            except Exception:
                pass
        return tab

    # ── proxy auth handler (CDP Fetch.AuthRequired) ───────────────────────

    async def _setup_proxy_auth(self, user: str, password: str) -> None:
        """Register a CDP Fetch handler that auto-responds to proxy auth
        challenges. Without this, Chromium pops a basic-auth dialog and
        the request hangs forever in headless mode.

        Best-effort: if any of the CDP calls fail (older nodriver API,
        connection not yet ready, etc.), we log + fall through. The
        proxy will still work for unauthenticated targets but will hang
        on basic-auth-required ones — visible in /health as proxy_set
        but with errors on first request."""
        if self._browser is None:
            return

        conn = getattr(self._browser, "connection", None)
        if conn is None:
            print("[browser] proxy auth setup skipped — no browser connection handle")
            return

        try:
            # Enable fetch interception for auth challenges only (not every
            # request — that would tank performance).
            await conn.send(cdp.fetch.enable(handle_auth_requests=True))
        except Exception as e:
            print(f"[browser] cdp.fetch.enable failed: {e!r} — proxy auth NOT wired")
            return

        async def _on_auth(event) -> None:
            try:
                await conn.send(
                    cdp.fetch.continue_with_auth(
                        request_id=event.request_id,
                        auth_challenge_response=cdp.fetch.AuthChallengeResponse(
                            response="ProvideCredentials",
                            username=user,
                            password=password,
                        ),
                    )
                )
            except Exception as e:
                print(f"[browser] continue_with_auth failed: {e!r}")

        async def _on_paused(event) -> None:
            # We enabled auth-only interception, but defensively handle any
            # RequestPaused that slips through so the request doesn't stall.
            try:
                await conn.send(cdp.fetch.continue_request(request_id=event.request_id))
            except Exception:
                pass

        try:
            conn.add_handler(
                cdp.fetch.AuthRequired,
                lambda evt: asyncio.create_task(_on_auth(evt)),
            )
            conn.add_handler(
                cdp.fetch.RequestPaused,
                lambda evt: asyncio.create_task(_on_paused(evt)),
            )
            print(f"[browser] proxy auth handler registered ({user}@{self.current_proxy_label()})")
        except Exception as e:
            print(f"[browser] add_handler failed: {e!r} — proxy auth NOT wired")


pool = BrowserPool()


# ── transient-retry decorator ─────────────────────────────────────────────

async def with_transient_retry(op, *, label: str = "op"):
    """Run `op()` (a zero-arg async callable). If it raises a transient
    nodriver flake, restart the browser (rotating the proxy for fresh egress
    IP) and run once more. Non-transient errors propagate on first raise."""
    try:
        return await op()
    except Exception as e:
        if not is_transient_nodriver_error(e):
            raise
        print(f"[{label}] transient nodriver error ({e!r}) — restart + retry (with proxy rotation)")
        try:
            await pool.restart(rotate_proxy=True)
        except Exception as restart_err:
            # If restart itself fails, surface the original error — it's
            # more informative than "restart failed".
            print(f"[{label}] restart also failed: {restart_err!r}")
            raise e from None
        return await op()
