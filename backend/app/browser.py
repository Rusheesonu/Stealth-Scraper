"""Multi-worker nodriver browser pool — stealth + (optionally) residential proxy.

Architecture (rewritten 2026-05-22 per pre-launch audit):

  Pool is N independent **workers**. Each worker owns:
    - its own `nodriver.Browser` instance
    - its own proxy assignment (or none, if `proxies.available()` is False)
    - an asyncio.Queue gives mutual exclusion — at most N concurrent
      tab operations across the whole process

  The OLD architecture was a SINGLE browser + a single asyncio.Lock that
  serialized every request. Under PH-launch concurrency (5–20 simultaneous
  visitors) the single browser became a CDP funnel — one transient flake
  triggered `pool.restart()` which destroyed every in-flight tab. The pre-
  launch audit measured 7/15 of `502 No target with given id found` under
  parallel hits. With per-worker isolation, a flake on worker[2] doesn't
  affect workers[0,1,3]; only the failed request retries.

  Tunable: `BROWSER_POOL_SIZE` env var. Default 4. On the prod box
  (Lightsail CX32, 8GB) 4 workers × ~500MB Chromium = 2GB, leaving plenty
  of headroom for FastAPI + asyncpg + the OS.

  Lazy start: workers don't boot Chromium until first use. App boot stays
  fast; idle workers don't waste RAM.

Why nodriver — nodriver patches Chromium at the flag/CDP level to close
automation leaks that Playwright+stealth-JS can't reach. Clears soft
Cloudflare challenges and Turnstile invisible mode out of the box, even
without proxies. For harder targets we layer a residential proxy via
Chromium's `--proxy-server` flag.

Proxies — if `backend/data/proxies.json` is populated, each worker picks
a random proxy on its first start. On restart (transient error path) the
worker rotates to a new proxy. Workers don't share proxies; the pool
spreads load across the proxy list naturally.

Resilience — nodriver has well-known transient errors (StopIteration in
its CDP cleanup coroutine, target crashed, websocket closed,
ProtocolException) that happen on healthy browsers under timing races.
We detect by error string in `is_transient_nodriver_error` and restart
the affected worker only.
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

import nodriver as uc
from nodriver import cdp

from app import proxies
from app.stealth import ULTRA_STEALTH_CHROMIUM_ARGS, ULTRA_STEALTH_JS


log = logging.getLogger(__name__)


_TRANSIENT_ERROR_MARKERS = (
    "StopIteration",
    "coroutine raised StopIteration",
    "Target crashed",
    "Connection closed",
    "connection closed",
    "websocket",
    # nodriver 0.45.1+ regression on Cloudflare-protected pages — the
    # tab's CDP session sometimes dies mid-load and any subsequent
    # tab.send / tab.evaluate raises this. Per upstream issue #2181 the
    # only mitigation is retry-with-fresh-tab. See research note in
    # AUDIT.md §3.x and LOOP_LOG iter 6.
    "Session with given id not found",
    "ProtocolException",
    # nodriver async-cancel path under heavy use
    "Invalid search result range",
    # Symptom of the pre-refactor single-pool collapse — kept so the
    # legacy 502 mode still triggers per-worker restart on the new path.
    "No target with given id found",
)


def is_transient_nodriver_error(exc: BaseException | str) -> bool:
    """Matches the nodriver flakes that clear on a browser restart."""
    msg = str(exc) if not isinstance(exc, str) else exc
    if not msg:
        return False
    return any(m in msg for m in _TRANSIENT_ERROR_MARKERS)


# (host, port, user, password) — what we hand to Chromium + CDP auth handler.
ProxyTuple = tuple[str, int, str, str]


# Serializes Chromium cold-starts across workers. Without this, N workers
# lazy-starting in parallel race on CDP port allocation and 4-of-4 fail
# with `Failed to connect to browser` in ~2.8s. Each boot is ~1-2s, so
# serial cold-start of 4 workers adds ~5s to the first concurrent burst.
# After that, workers are warm and the lock is uncontended.
_CHROMIUM_BOOT_LOCK: Optional[asyncio.Lock] = None


def _boot_lock() -> asyncio.Lock:
    """Lazy lock construction so we don't bind to whatever event loop is
    running at import time."""
    global _CHROMIUM_BOOT_LOCK
    if _CHROMIUM_BOOT_LOCK is None:
        _CHROMIUM_BOOT_LOCK = asyncio.Lock()
    return _CHROMIUM_BOOT_LOCK


# ── Worker ────────────────────────────────────────────────────────────────


class _Worker:
    """One Chromium slot. Owns its own browser, proxy, and lifecycle.

    Restarting one worker does NOT touch siblings. That's the whole
    point of the rewrite — the old global `pool.restart()` was
    destroying in-flight tabs on healthy browsers whenever any single
    request flaked.
    """

    def __init__(self, idx: int) -> None:
        self.idx = idx
        self._browser: Optional[uc.Browser] = None
        self._current_proxy: Optional[ProxyTuple] = None

    @property
    def running(self) -> bool:
        return self._browser is not None

    def current_proxy_label(self) -> Optional[str]:
        """`host:port` of this worker's current proxy, or None if direct.
        Safe to expose — credentials are not included."""
        if not self._current_proxy:
            return None
        host, port, *_ = self._current_proxy
        return f"{host}:{port}"

    async def start(self, proxy: Optional[ProxyTuple] = None) -> None:
        if self._browser is not None:
            return
        args = list(ULTRA_STEALTH_CHROMIUM_ARGS)
        if proxy:
            host, port, user, password = proxy
            args.append(f"--proxy-server=http://{host}:{port}")
            args.append("--proxy-bypass-list=<-loopback>;127.0.0.1;localhost")
            self._current_proxy = proxy
            log.info("worker.start", extra={"idx": self.idx, "proxy": f"{host}:{port}"})
        else:
            self._current_proxy = None
            log.info("worker.start", extra={"idx": self.idx, "proxy": "direct"})

        # Serialize Chromium spawn — N workers racing on `uc.start()`
        # collide on CDP port allocation. The 20-concurrent load test
        # before this lock showed 4/4 cold-start failures with
        # `Failed to connect to browser` in ~2.8s. With the lock,
        # boots are serial (~1-2s each) and reliable.
        async with _boot_lock():
            self._browser = await uc.start(browser_args=args)

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
        """Hard reset THIS worker only. Sibling workers are untouched."""
        await self.stop()
        new_proxy: Optional[ProxyTuple] = None
        if rotate_proxy and proxies.available():
            new_proxy = proxies.host_port_user_pass()
        await self.start(proxy=new_proxy)
        # Clear any warmup cache that assumed this worker's cookies.
        # Local import to avoid circular dependency.
        try:
            from app.snapshot import reset_warmup_cache
            reset_warmup_cache()
        except ImportError:
            pass

    async def _ensure_live(self) -> None:
        """Bounded probe — about:blank in 5s. Zombie handle → tear down so
        the next caller does a clean lazy start."""
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
        """Open a tab on this worker, with stealth JS pre-installed.
        Caller is responsible for closing the tab. Lazy-starts the
        browser if this is the first call for this worker."""
        await self._ensure_live()
        if self._browser is None:
            proxy = proxies.host_port_user_pass() if proxies.available() else None
            await self.start(proxy=proxy)
        assert self._browser is not None
        tab = await self._browser.get(url)

        # Install stealth JS to run before any page script on every nav.
        try:
            await tab.send(
                cdp.page.add_script_to_evaluate_on_new_document(source=ULTRA_STEALTH_JS)
            )
        except Exception:
            # Fallback: inject once on the current document.
            try:
                await tab.evaluate(ULTRA_STEALTH_JS)
            except Exception:
                pass
        return tab

    async def _setup_proxy_auth(self, user: str, password: str) -> None:
        """CDP Fetch handler that auto-answers proxy auth challenges.
        Without this, Chromium pops a basic-auth dialog and hangs."""
        if self._browser is None:
            return

        try:
            await self._browser.send(cdp.fetch.enable(handle_auth_requests=True))
        except Exception as e:
            log.warning("worker.cdp_fetch_enable_failed", extra={"idx": self.idx, "err": repr(e)})
            return

        async def _on_auth(event) -> None:
            try:
                await self._browser.send(
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
                log.warning("worker.continue_with_auth_failed", extra={"idx": self.idx, "err": repr(e)})

        async def _on_paused(event) -> None:
            # Auth-only interception — defensively unpause any other
            # RequestPaused that slips through so the request doesn't stall.
            try:
                await self._browser.send(cdp.fetch.continue_request(request_id=event.request_id))
            except Exception:
                pass

        try:
            self._browser.add_handler(
                cdp.fetch.AuthRequired,
                lambda evt: asyncio.create_task(_on_auth(evt)),
            )
            self._browser.add_handler(
                cdp.fetch.RequestPaused,
                lambda evt: asyncio.create_task(_on_paused(evt)),
            )
        except Exception as e:
            log.warning("worker.add_handler_failed", extra={"idx": self.idx, "err": repr(e)})


# ── Pool ──────────────────────────────────────────────────────────────────


class BrowserPool:
    """N independent workers — checkout/return via an asyncio.Queue.

    Concurrency: max N in-flight tab operations across the whole process.
    Backpressure: callers wait at `self._available.get()` when all workers
    are busy. Per-user concurrency cap (in main.py) prevents a single
    user from draining the pool.

    Safety: each worker has its own browser. A flake on worker[2] does
    not affect workers[0,1,3]. This is the contract the audit required.
    """

    DEFAULT_SIZE = 4

    def __init__(self, size: Optional[int] = None) -> None:
        n = size if size is not None else int(
            os.getenv("BROWSER_POOL_SIZE", str(self.DEFAULT_SIZE))
        )
        # Guard against silly values
        n = max(1, min(n, 32))
        self._workers: list[_Worker] = [_Worker(i) for i in range(n)]
        # All workers start as available — they're lazy, no Chromium boot yet.
        self._available: asyncio.Queue[_Worker] = asyncio.Queue(maxsize=n)
        for w in self._workers:
            self._available.put_nowait(w)
        log.info("pool.init", extra={"size": n})

    @property
    def size(self) -> int:
        return len(self._workers)

    @property
    def available_count(self) -> int:
        """How many workers are idle right now (queue size)."""
        return self._available.qsize()

    @property
    def running(self) -> bool:
        """True if ANY worker has its browser started.
        Kept for back-compat with /status checks that used `pool.running`."""
        return any(w.running for w in self._workers)

    def current_proxy_label(self) -> Optional[str]:
        """Aggregate proxy label across workers. Returns the first running
        worker's proxy, since they may be on different proxies. Kept for
        back-compat with telemetry that expects a single label."""
        for w in self._workers:
            if w.running:
                return w.current_proxy_label()
        return None

    def proxy_labels(self) -> list[Optional[str]]:
        """Per-worker proxy labels — used by the new /status detail view
        that exposes the spread across workers."""
        return [w.current_proxy_label() for w in self._workers]

    async def stop(self) -> None:
        """Stop all workers — used on app shutdown."""
        log.info("pool.stop", extra={"size": self.size})
        for w in self._workers:
            try:
                await w.stop()
            except Exception as e:
                log.warning("worker.stop_failed", extra={"idx": w.idx, "err": repr(e)})

    @asynccontextmanager
    async def tab(self, url: str = "about:blank") -> AsyncIterator[uc.Tab]:
        """Acquire a worker, open a tab, yield, then close + release.

        Transient nodriver errors that escape the `yield` body restart
        the failing worker (with proxy rotation if a proxy pool is
        configured) before re-raising. Sibling workers are untouched.

        Usage:
            async with pool.tab(url) as tab:
                await tab.get(url)
                # ... operate on tab ...
            # tab auto-closes, worker auto-returns to the pool
        """
        worker = await self._available.get()
        tab: Optional[uc.Tab] = None
        try:
            tab = await worker.open_tab(url)
            try:
                yield tab
            finally:
                if tab is not None:
                    try:
                        await tab.close()
                    except Exception:
                        # Already-closed tab or dead browser — fine, ignore.
                        pass
        except Exception as e:
            if is_transient_nodriver_error(e):
                # Recycle THIS worker only. Don't touch siblings.
                try:
                    await worker.restart(rotate_proxy=proxies.available())
                    log.info("worker.restarted", extra={"idx": worker.idx, "reason": "transient"})
                except Exception as restart_err:
                    log.warning(
                        "worker.restart_failed",
                        extra={"idx": worker.idx, "err": repr(restart_err)},
                    )
            raise
        finally:
            # Always return the worker to the queue, even on errors.
            # The worker is either healthy (no error) or just-restarted
            # (transient error) — either way it's safe to reuse.
            self._available.put_nowait(worker)


pool = BrowserPool()


# ── Legacy API shim ───────────────────────────────────────────────────────


async def open_tab(url: str = "about:blank") -> uc.Tab:
    """DEPRECATED — migrated callers to `async with pool.tab(url) as t:`.

    This shim exists only so any third-party importer doesn't crash on
    upgrade. It does NOT manage worker lifecycle correctly — the tab
    you get back will hold a worker forever (no auto-release). Use the
    context manager.
    """
    log.warning(
        "browser.open_tab.deprecated — use `async with pool.tab(url) as tab:`"
    )
    # Pick the first worker; never release it. Genuinely broken on
    # purpose, so callers migrate.
    w = pool._workers[0]
    return await w.open_tab(url)


# ── Transient retry decorator ─────────────────────────────────────────────


async def with_transient_retry(op, *, label: str = "op", max_retries: int = 3):
    """Run `op()` (a zero-arg async callable). On any transient nodriver
    flake, sleep with linear backoff and retry up to `max_retries` times.

    Important behavior change from the pre-2026-05-22 version: this no
    longer calls `pool.restart()` (which would have restarted EVERY
    worker — defeats the whole pool refactor). The pool's `tab()`
    context manager handles per-worker restart internally on transient
    errors. The retry here just gives the caller a clean attempt against
    a (possibly different) worker.

    Non-transient errors propagate on first raise.
    """
    last_err: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            return await op()
        except Exception as e:
            if not is_transient_nodriver_error(e):
                raise
            last_err = e
            if attempt >= max_retries:
                log.warning(
                    "with_transient_retry.exhausted",
                    extra={"label": label, "attempts": max_retries + 1, "err": repr(e)},
                )
                raise
            backoff = 2.0 * (attempt + 1)
            log.info(
                "with_transient_retry.flake",
                extra={"label": label, "attempt": attempt + 1, "backoff_s": backoff, "err": repr(e)},
            )
            await asyncio.sleep(backoff)
    if last_err:
        raise last_err
    raise RuntimeError(f"[{label}] with_transient_retry exited loop with no result")
