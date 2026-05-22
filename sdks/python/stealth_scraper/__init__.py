"""Stealth Scraper — official Python SDK.

Usage::

    from stealth_scraper import StealthClient

    client = StealthClient(api_key="ssk_...")
    snap = client.snapshot("https://news.ycombinator.com/")

For async / streaming::

    from stealth_scraper import AsyncStealthClient

    async with AsyncStealthClient(api_key="ssk_...") as client:
        snap = await client.snapshot("https://example.com")
        async for ev in client.snapshot_stream("https://example.com"):
            print(ev)
"""

from stealth_scraper.client import AsyncStealthClient, StealthClient
from stealth_scraper.exceptions import (
    AntiBotBlockError,
    ApiError,
    AuthError,
    OverloadedError,
    PlanLimitError,
    RateLimitError,
    StealthScraperError,
    UnsafeUrlError,
)
from stealth_scraper.models import (
    AssistExtractResult,
    EstimateResult,
    ExtractResult,
    SnapshotProgress,
    SnapshotResult,
    Template,
)

__version__ = "0.1.0"

__all__ = [
    "StealthClient",
    "AsyncStealthClient",
    "SnapshotResult",
    "ExtractResult",
    "AssistExtractResult",
    "EstimateResult",
    "SnapshotProgress",
    "Template",
    "StealthScraperError",
    "ApiError",
    "AuthError",
    "RateLimitError",
    "AntiBotBlockError",
    "PlanLimitError",
    "OverloadedError",
    "UnsafeUrlError",
    "__version__",
]
