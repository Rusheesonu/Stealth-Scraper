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

Admin tier
----------
An additional "admin" tier exists for internal accounts (founder, team,
support, trusted launch testers). It's NOT publicly purchasable. Two ways
to grant it:

  1. Email allowlist via ADMIN_EMAILS env var (csv). Anyone in this list
     resolves to plan="admin" regardless of their subscriptions table row.
     This is the easy path — change env, no DB write.
  2. Subscriptions table row with plan='admin' (out-of-band insert). Used
     when a teammate has an account but we don't want their email in env.

Admins have a 10M monthly limit (effectively unlimited for any realistic
use) AND bypass the public landing-page IP rate limit so we can test the
modal repeatedly without getting locked out.
"""

from __future__ import annotations

import os
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
    # Internal admin tier — effectively unlimited. Granted via the
    # ADMIN_EMAILS env allowlist or by inserting a subscriptions row with
    # plan='admin'. Not on the public pricing page.
    "admin":    10_000_000,
    # Defensive: unknown plan (mis-configured variant ID) = no access.
    "unknown":  0,
}


# Comma-separated emails that resolve to the admin tier. Loaded at import
# (env doesn't change at runtime in our deploy). Empty by default. Stored
# as a frozenset of lower-cased emails for case-insensitive matching.
ADMIN_EMAILS: frozenset[str] = frozenset(
    e.strip().lower()
    for e in os.getenv("ADMIN_EMAILS", "").split(",")
    if e.strip()
)


def is_admin_email(email: str | None) -> bool:
    """True if the email is in the ADMIN_EMAILS allowlist. Case-insensitive,
    None/empty-safe (returns False)."""
    if not email:
        return False
    return email.strip().lower() in ADMIN_EMAILS


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


async def try_increment_usage(user_id: str, max_allowed: int, by: int = 1) -> tuple[bool, int]:
    """Thin re-export of `db.try_increment_usage` keyed on the current
    UTC year-month. Returns (allowed, count_after_increment).

    Importing modules can call this directly without round-tripping through
    a route — useful for the scheduler that runs scheduled scrapes
    out-of-band of any HTTP request."""
    return await db.try_increment_usage(
        user_id, current_year_month(), max_allowed, by=by,
    )


async def enforce_plan(user_id: str = Depends(get_current_user)) -> str:
    """FastAPI dependency: gate a single-scrape route. Raises 403 if over
    limit; otherwise atomically increments the usage count and returns the
    user_id.

    Uses a single UPDATE...RETURNING under the hood so 10 concurrent
    requests against the same user_id can't all observe a stale `current`
    and race past the cap (was the old read-then-write pattern's failure
    mode at scale)."""
    plan = await db.get_user_plan(user_id)
    limit = plan_limit(plan)
    allowed, current = await try_increment_usage(user_id, limit, by=1)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_over_limit_message(current, limit, plan),
        )
    return user_id


async def enforce_plan_bulk(user_id: str, n: int) -> None:
    """Programmatic gate for routes that consume N units per call (e.g.
    /extract/batch). Raises 403 if (current + n) would exceed the limit;
    otherwise increments by n atomically.

    Called from within the route function — *not* as a dependency — because
    `n` depends on request body."""
    plan = await db.get_user_plan(user_id)
    limit = plan_limit(plan)
    allowed, current = await try_increment_usage(user_id, limit, by=n)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_over_limit_message(current, limit, plan, requested=n),
        )


async def get_current_usage_count(user_id: str) -> int:
    """Read-only — returns this user's usage count for the current month.
    Used by the reviews module to gate the 'verified reviewer' badge."""
    try:
        return await db.get_usage_count(user_id, current_year_month())
    except Exception:
        return 0
