"""Per-host rate limiter for outbound scrapes.

We DO NOT enforce robots.txt. robots.txt is a crawler directive for
search-engine indexers, not a legal prohibition on scraping; no
commercial scraper in this category (Bright Data, Apify, ScraperAPI,
ZenRows, PhantomBuster, Octoparse) enforces it server-side. Our Terms
of Service §3 puts legal responsibility on the user. This module
exists solely to prevent accidental same-host DDoS when a customer
fires N concurrent scrapes against one domain.

  - `RateLimiter.acquire(host)` waits until the host's per-second
    token budget allows another request. Default: 1 req/sec/host,
    burst 3. Configurable via env (SCRAPER_DEFAULT_QPS, SCRAPER_DEFAULT_BURST).
    Async-safe.

  - `SafetyCheck(url)` is the one-call async-context-manager helper.
    It's just a rate-limit acquire today; the wrapper exists so we
    have a single point to hang future per-host concerns (proxy
    rotation, per-tenant quotas, etc.) without touching every caller.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from urllib.parse import urlparse

log = logging.getLogger(__name__)

# User-agent we identify as when scraping. Matches what stealth.py
# spoofs at the JS level so the two layers agree.
SCRAPER_UA = os.getenv(
    "SCRAPER_UA",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
)

# Defaults — opinionated, can DoS NOBODY at these settings.
DEFAULT_QPS = float(os.getenv("SCRAPER_DEFAULT_QPS", "1.0"))      # 1 request per second per host
DEFAULT_BURST = int(os.getenv("SCRAPER_DEFAULT_BURST", "3"))      # allow 3 in-flight before rate-limiting kicks in


# ── Per-host rate limiter ────────────────────────────────────────────────


class RateLimiter:
    """Token-bucket rate limiter, one bucket per hostname.

    `acquire(host)` returns when the host's bucket has at least one token
    free. Tokens refill at `qps` per second. `burst` is the bucket size
    (max in-flight before throttling kicks in).

    The bucket math:
      bucket[host] = deque of recent acquire timestamps within 1/qps window
      acquire(host):
        - prune timestamps older than 1/qps from the deque
        - if len(deque) < burst: append now, return immediately
        - else: sleep until oldest entry expires, retry

    Async-safe: a single asyncio.Lock guards the deque dict. The actual
    SLEEP happens outside the lock so other hosts can proceed in parallel.
    """

    def __init__(self, qps: float = DEFAULT_QPS, burst: int = DEFAULT_BURST) -> None:
        self.qps = qps
        self.burst = burst
        self._window_s = 1.0 / qps if qps > 0 else 0.0
        self._buckets: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def acquire(self, host_or_url: str) -> None:
        """Block until the host/URL's bucket has a free token. URL works
        too — we hash by hostname."""
        host = host_or_url
        if "://" in host_or_url:
            try:
                host = urlparse(host_or_url).hostname or host_or_url
            except Exception:
                pass
        if not host or self.qps <= 0:
            return

        # Spin-loop with bounded sleeps so we don't hold the lock during sleep.
        while True:
            async with self._lock:
                now = time.monotonic()
                bucket = self._buckets[host]
                cutoff = now - max(self._window_s, 1.0)
                while bucket and bucket[0] < cutoff:
                    bucket.popleft()
                if len(bucket) < self.burst:
                    bucket.append(now)
                    return
                wait = max(0.0, bucket[0] + self._window_s - now)
            # Sleep outside the lock so other hosts aren't blocked.
            if wait > 0:
                await asyncio.sleep(wait)
            else:
                # Defensive: shouldn't happen, but avoid tight loop.
                await asyncio.sleep(0.001)

    def stats(self) -> dict:
        """For observability: how many in-flight slots per host right now."""
        return {h: len(b) for h, b in self._buckets.items()}


# Module-level singleton — the production scraper imports this.
limiter = RateLimiter()


# ── Convenience: combined gate ───────────────────────────────────────────


@dataclass
class SafetyCheck:
    """Async-context-manager wrapper around the per-host rate limiter.

    Usage:
        async with SafetyCheck(url):
            ...scrape...

    Single point in the code that gates every outbound scrape. Today
    it's just the rate limiter; the wrapper is here so we can attach
    future per-host concerns (per-tenant quota, proxy rotation, etc.)
    without changing every call site.
    """
    url: str

    async def __aenter__(self) -> "SafetyCheck":
        await limiter.acquire(self.url)
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        # No release — rate limiter uses time-window decay, not token return.
        return None
