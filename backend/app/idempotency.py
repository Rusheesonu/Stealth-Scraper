"""Idempotency-Key support — SDK sends `Idempotency-Key: <uuid>` header
on every mutating call. We cache the response for ~24h so retries don't
double-bill / double-fire.

Differentiator from research: no scraper competitor implements this
(Firecrawl, Apify, Browserbase). Stripe set the standard for API
idempotency in 2014; AI agents (LangGraph, LangChain, CrewAI) emit
retries by default. Without this, every agent retry burns a credit.

Storage: in-process LRU dict. NOT distributed — if the container
restarts, the cache resets and a retry within the restart window will
re-run the scrape. Acceptable for the launch-week scale; switch to
Redis if we hit multi-container.

Key shape: hash(user_id, route, idempotency_key). NOT just the
idempotency key — different users / routes could legitimately use the
same UUID without conflict.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any


# Cache settings tuned for an 8GB RAM container:
#   - 10k entries × ~5KB avg response = ~50MB worst case
#   - 24h TTL (matches Stripe's documented window)
_MAX_ENTRIES = 10_000
_TTL_SECONDS = 24 * 3600

_lock = asyncio.Lock()


@dataclass
class _CacheEntry:
    response: dict[str, Any]
    status_code: int
    stored_at: float = field(default_factory=time.time)


# OrderedDict gives us O(1) move-to-end for LRU eviction.
_cache: OrderedDict[str, _CacheEntry] = OrderedDict()


def _make_key(user_id: str, route: str, idempotency_key: str) -> str:
    """Hash (user, route, key) into a single cache key. SHA-256 truncated
    to 16 bytes is plenty for collision-free storage at 10k entries."""
    raw = f"{user_id}|{route}|{idempotency_key}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:32]


async def get_cached(
    user_id: str, route: str, idempotency_key: str
) -> tuple[dict[str, Any] | None, int | None]:
    """Look up a cached response. Returns (body, status) or (None, None).
    Also evicts expired entries opportunistically."""
    if not idempotency_key:
        return None, None
    key = _make_key(user_id, route, idempotency_key)
    async with _lock:
        entry = _cache.get(key)
        if entry is None:
            return None, None
        age = time.time() - entry.stored_at
        if age > _TTL_SECONDS:
            _cache.pop(key, None)
            return None, None
        # LRU bump — move to end on access.
        _cache.move_to_end(key)
        return entry.response, entry.status_code


async def store(
    user_id: str,
    route: str,
    idempotency_key: str,
    response: dict[str, Any],
    status_code: int = 200,
) -> None:
    """Cache a response for ~24h. LRU-evict oldest if over capacity."""
    if not idempotency_key:
        return
    key = _make_key(user_id, route, idempotency_key)
    async with _lock:
        _cache[key] = _CacheEntry(
            response=response, status_code=status_code, stored_at=time.time()
        )
        _cache.move_to_end(key)
        # Bounded LRU.
        while len(_cache) > _MAX_ENTRIES:
            _cache.popitem(last=False)


def cache_stats() -> dict[str, Any]:
    """For /status — confirm idempotency cache is operational."""
    return {
        "entries": len(_cache),
        "max_entries": _MAX_ENTRIES,
        "ttl_seconds": _TTL_SECONDS,
    }
