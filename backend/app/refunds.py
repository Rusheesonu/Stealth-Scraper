"""Reliability SLA — auto-refund failed scrapes.

The promise on stealthscraper.dev: "If a scrape fails — blocked, empty,
or errored — you don't pay." This module implements the detection +
refund flow that delivers on that promise. It's the single biggest
trust signal we have versus Firecrawl / Apify / Bright Data, all of
which charge for failures.

Refund rules (the OR is intentional — any single hit triggers a refund):
  1. detect_block returned `blocked=True` (Cloudflare/PerimeterX/etc wall)
  2. The result had `element_count == 0` AND the title is empty/generic
  3. The scrape raised an exception (network, timeout, OOM, anything)

Per loop iter 9 / iter 13 evidence, ~17% of antibot-bench scrapes fall
into rule 1 or 2 today. The refund cost is bounded by usage_counts >= 0
(can't go negative) and by the fact that the user already paid for the
attempt via enforce_plan — we're just giving the credit back, not
double-spending.

Honest about LIMITATIONS:
  - We don't refund partial successes (got SOME data but not all fields).
    That's because we don't have ground-truth schemas for arbitrary URLs.
  - We refund within ~minutes (the refund happens inline at the end of
    the scrape handler, NOT via batch cron — that's faster + cheaper).
  - Refund is logged in usage_refunds so users can see the audit trail
    on /settings/refunds.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app import db


log = logging.getLogger(__name__)


# Suspicious title patterns that mean "page didn't actually render."
# Used in combination with element_count==0 — neither alone is enough,
# but the combo strongly signals an anti-bot wall or hard render fail.
_SUSPICIOUS_TITLE_PATTERNS = (
    "",  # empty
    "loading",
    "please wait",
    "just a moment",
    "checking your browser",
    "are you a human",
    "access denied",
    "forbidden",
    "blocked",
    "captcha",
    "verify you are human",
)


def _is_suspicious_title(title: str | None) -> bool:
    """True if the title is the kind of generic 'loading/blocked/etc'
    string that anti-bot walls render. Case-insensitive substring match."""
    if not title:
        return True  # empty title → almost certainly a wall
    t = title.strip().lower()
    if len(t) <= 3:                   # "hi", "ok", domain-only labels
        return True
    return any(p in t for p in _SUSPICIOUS_TITLE_PATTERNS if p)


def _current_year_month() -> str:
    """Match the format usage.py uses for usage_counts.year_month."""
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def auto_refund_if_failed(
    *,
    user_id: str,
    url: str,
    snap_title: str | None,
    element_count: int,
    blocked: bool,
    detected_vendor: str | None,
    error: Exception | None,
) -> tuple[bool, str | None]:
    """Decide whether to refund this scrape's usage tick, and if so do it.

    Returns (refunded, reason). reason is human-readable for the user-
    visible audit log.

    Call this AFTER usage was incremented (enforce_plan) but BEFORE you
    return the response to the user. Failure to refund here means the
    user is charged for a bad scrape — exactly what the SLA promises
    we won't do.
    """
    reason: str | None = None
    if error is not None:
        reason = f"engine error: {type(error).__name__}: {str(error)[:120]}"
    elif blocked:
        reason = f"blocked by {detected_vendor or 'unknown anti-bot'}"
    elif element_count == 0 and _is_suspicious_title(snap_title):
        reason = "empty result with generic title — likely silent block or render fail"
    else:
        return False, None    # legitimate success, no refund

    try:
        refunded = await db.try_refund_usage(
            user_id=user_id,
            year_month=_current_year_month(),
            reason=reason,
            url=url,
            scrape_meta={
                "title": (snap_title or "")[:200],
                "element_count": element_count,
                "blocked": blocked,
                "detected_vendor": detected_vendor,
            },
        )
        if refunded:
            log.info(
                "refund.applied",
                extra={"user_id": user_id, "reason": reason, "url": url},
            )
        else:
            # Usage count was already 0 — user wasn't actually charged
            # (probably a free-tier-exhausted block that fired before
            # increment). Still log so we know the policy fired.
            log.info(
                "refund.skipped_no_credit",
                extra={"user_id": user_id, "reason": reason},
            )
        return refunded, reason
    except Exception as e:
        # Refund mechanism itself failed (DB down, etc). Log but don't
        # raise — the user-facing scrape response shouldn't fail because
        # the refund pipeline hiccupped.
        log.warning(
            "refund.error",
            extra={"user_id": user_id, "reason": reason, "error": repr(e)},
        )
        return False, reason
