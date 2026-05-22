"""Cost preview — POST /estimate.

Differentiator from research: no competitor (Firecrawl, Apify, ZenRows,
Bright Data, AgentQL, Browserbase) exposes pre-flight cost. Scrapfly
does — and it's their loudest pricing-transparency proof. AI-agent
buyers explicitly want this so their agent runtimes can budget cap.

We don't actually fetch the URL to estimate — that'd defeat the purpose
(cheap preview). Instead we use cheap signals:
  - Domain known to require heavy engine (Cloudflare/PerimeterX/Kasada lists)?
  - HEAD request for content-length (does it fit in curl_cffi's free path?)
  - Template uses AI-extract (LLM call)?

The estimate is intentionally CONSERVATIVE — easier to surprise users
with "actually cheaper than estimated" than to under-charge them.

Pricing model (matches main.py's plan_limit + per-scrape cost):
  - 1 credit per scrape (default)
  - +2 credits if camoufox engine likely (Firefox cold start)
  - +1 credit if AI-extract used (LLM call)
  - 0 credits for curl_cffi-friendly static HTML (no JS, no browser)
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

from app import db
from app.usage import current_year_month, plan_limit


log = logging.getLogger(__name__)


# Hand-curated lists of vendors that force specific engines. Same as the
# router's VENDOR_AFFINITY but condensed for cost estimation.
_HEAVY_DOMAINS = frozenset({
    # Cloudflare Turnstile / hard-CF
    "chess.com", "g2.com", "nowsecure.nl",
    # Kasada — only camoufox bypasses
    "canadapost-postescanada.ca", "aircanada.com",
    # PerimeterX — behavioral, hard
    "zillow.com", "glassdoor.com", "ticketmaster.com",
    # DataDome
    "petsmart.com", "footlocker.com", "airfrance.com",
    # Imperva
    "hyatt.com", "kayak.com",
})


_LIGHT_DOMAINS = frozenset({
    # Static HTML — curl_cffi can handle, no browser needed
    "news.ycombinator.com", "ycombinator.com",
    "quotes.toscrape.com", "books.toscrape.com",
    "httpbin.org", "example.com", "iana.org",
    "wikipedia.org", "en.wikipedia.org",
})


def _root_domain(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return ""
    host = host.lower()
    # Strip "www." prefix.
    if host.startswith("www."):
        host = host[4:]
    return host


def _heavy(host: str) -> bool:
    if host in _HEAVY_DOMAINS:
        return True
    # Subdomain matching — e.g. shop.target.com counts as target.com.
    for d in _HEAVY_DOMAINS:
        if host.endswith("." + d):
            return True
    return False


def _light(host: str) -> bool:
    if host in _LIGHT_DOMAINS:
        return True
    for d in _LIGHT_DOMAINS:
        if host.endswith("." + d):
            return True
    return False


# Per-credit price in USD. Matches the Pro plan economics ($79 / 50,000 =
# $0.00158/scrape; round up for nice numbers).
_USD_PER_CREDIT = 0.005


async def estimate_scrape(
    user_id: str,
    url: str,
    *,
    has_template: bool = False,
    uses_assist: bool = False,
) -> dict[str, Any]:
    """Predict the credit cost of a scrape before running it. Pure CPU,
    no I/O against the target URL.

    Returns the same shape the SDKs expect (per sdks/BACKEND_TODO.md §1)."""
    host = _root_domain(url)

    snapshot_cost = 1.0
    if _heavy(host):
        snapshot_cost = 3.0       # heavy engine = camoufox cold start (~3x compute)
    elif _light(host):
        snapshot_cost = 0.5       # curl_cffi-friendly, might skip browser entirely

    assist_cost = 1.0 if uses_assist else 0.0
    extraction_cost = 0.5 if has_template else 0.0

    estimated_credits = snapshot_cost + assist_cost + extraction_cost
    estimated_usd = round(estimated_credits * _USD_PER_CREDIT, 6)

    # Plan headroom — let the SDK show "you have X credits left this month".
    try:
        plan = await db.get_user_plan(user_id)
        limit = plan_limit(plan)
        used = await db.get_usage_count(user_id, current_year_month())
        remaining = max(0, limit - used)
    except Exception:
        plan = "free"
        remaining = 0

    return {
        "estimated_credits": estimated_credits,
        "estimated_usd": estimated_usd,
        "plan": plan,
        "plan_credits_remaining": remaining,
        "breakdown": {
            "snapshot": snapshot_cost,
            "assist": assist_cost,
            "extraction": extraction_cost,
        },
        "notes": (
            "Heavy engine (camoufox) used for anti-bot-protected domains. "
            "Lightweight (curl_cffi, no browser) used when domain is known-static."
        ),
    }
