"""Plan-tier gating + monthly usage metering.

Every authenticated scrape route depends on `enforce_plan` (instead of the
raw `get_current_user`). That dependency:

    1. Resolves the user's current plan via `db.get_user_plan(user_id)`.
    2. Looks up their scrape count for the current UTC month.
    3. Raises 403 if they're at or over their plan's monthly limit.
    4. Otherwise increments the count atomically and returns the user_id.

Plan limits match the published pricing page (free/hobby/pro/business).
Calendar month is UTC `YYYY-MM`. Mid-month plan changes work naturally —
we check the current plan's limit at request time, no migration needed.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status

from app import db
from app.auth import get_current_user


PLAN_LIMITS: dict[str, int] = {
    # Free tier is 50/month: enough for ~1 week of evaluation but tight
    # enough to force a paid commitment if someone's building a real
    # product. 100 lets hobbyists free-ride forever; 25 burns out before
    # they see value. 50 is the sweet spot for Chromium-per-scrape cost.
    "free":     50,
    "hobby":    1_000,
    "pro":      10_000,
    "business": 100_000,
    # Defensive: unknown plan (mis-configured variant ID) = no access.
    "unknown":  0,
}


def current_year_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def plan_limit(plan: str) -> int:
    return PLAN_LIMITS.get(plan, 0)


def _over_limit_message(current: int, limit: int, plan: str, requested: int = 1) -> str:
    if requested > 1:
        return (
            f"This batch of {requested} scrapes would put you at "
            f"{current + requested}/{limit} on the {plan} plan. "
            f"Upgrade at /pricing."
        )
    return (
        f"You've hit your {plan} plan limit: {current}/{limit} scrapes this month. "
        f"Upgrade at /pricing."
    )


async def enforce_plan(user_id: str = Depends(get_current_user)) -> str:
    """FastAPI dependency: gate a single-scrape route. Raises 403 if over
    limit; otherwise atomically increments the usage count and returns the
    user_id."""
    plan = await db.get_user_plan(user_id)
    limit = plan_limit(plan)
    year_month = current_year_month()
    current = await db.get_usage_count(user_id, year_month)

    if current >= limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_over_limit_message(current, limit, plan),
        )

    await db.increment_usage_count(user_id, year_month, by=1)
    return user_id


async def enforce_plan_bulk(user_id: str, n: int) -> None:
    """Programmatic gate for routes that consume N units per call (e.g.
    /extract/batch). Raises 403 if (current + n) would exceed the limit;
    otherwise increments by n atomically.

    Called from within the route function — *not* as a dependency — because
    `n` depends on request body."""
    plan = await db.get_user_plan(user_id)
    limit = plan_limit(plan)
    year_month = current_year_month()
    current = await db.get_usage_count(user_id, year_month)

    if current + n > limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_over_limit_message(current, limit, plan, requested=n),
        )

    await db.increment_usage_count(user_id, year_month, by=n)
