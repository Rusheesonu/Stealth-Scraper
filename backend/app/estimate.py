"""Cost preview — POST /estimate.

Differentiator from research: no competitor (Firecrawl, Apify, ZenRows,
Bright Data, AgentQL, Browserbase) exposes pre-flight cost. Scrapfly
does — and it's their loudest pricing-transparency proof. AI-agent
buyers explicitly want this so their agent runtimes can budget cap.

Pricing model — strictly site-agnostic. We charge a flat per-scrape
cost plus optional add-ons; we do NOT keep curated "heavy" / "light"
domain lists. Site-specific heuristics drift the moment a vendor
changes their protection vendor, and they create surprise charges
when a user's domain isn't on the list. Flat-rate is honest, stable,
and matches what AI-agent runtimes can predict.

  - 1 credit per scrape
  - +1 credit if AI-extract used (LLM call)
  - +0.5 credit if a saved template is applied (LXML extraction pass)

If actual engine selection happens to be cheaper (curl_cffi fast path)
or more expensive (camoufox cold start), the per-request cost in
post-scrape accounting reflects the real engine. The estimate is an
upper-bound predictor; we'd rather under-promise and over-deliver.
"""

from __future__ import annotations

import logging
from typing import Any

from app import db
from app.usage import current_year_month, plan_limit


log = logging.getLogger(__name__)


# Per-credit price in USD. Matches the Pro plan economics ($79 / 50,000 =
# $0.00158/scrape; round up for nice numbers).
_USD_PER_CREDIT = 0.005


async def estimate_scrape(
    user_id: str,
    url: str,                          # kept in signature for API stability + future use
    *,
    has_template: bool = False,
    uses_assist: bool = False,
) -> dict[str, Any]:
    """Predict the credit cost of a scrape before running it. Pure CPU,
    no I/O against the target URL, no per-site logic.

    Returns the same shape the SDKs expect (per sdks/BACKEND_TODO.md §1).
    The `url` arg is preserved for forwards compatibility — if we ever
    add a HEAD-based size predictor it'd live here — but is not used
    for engine prediction (no hardcoded domain lists)."""
    del url  # not used today; signature preserved for SDK stability

    snapshot_cost = 1.0
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
            "Flat per-scrape cost. Add-ons: +1 credit for AI-assist, "
            "+0.5 credit for template extraction. Actual engine cost is "
            "absorbed by us — your charge is predictable regardless of "
            "the protection vendor on the target site."
        ),
    }
