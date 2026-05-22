"""Reviews — product-level + per-template.

Per PRODUCT_FEATURES_15.md B5: "Amazon proved it: reviews drive 60-80%
of purchase decisions. B2B SaaS leaves this on the table. We won't."

API shape:
  POST   /reviews                          — create or update a review
  GET    /reviews?target_kind=X&target_id=Y — list reviews for a target
  GET    /reviews/summary?...               — {count, avg, distribution}
  DELETE /reviews/{id}                      — delete own review

Verification rule: a review is `verified=True` if the reviewer has
scraped > 5 times this month — proves they actually use the product
versus a fake-review drive-by. We don't verify EMAIL — Supabase already
does that at signup.
"""

from __future__ import annotations

import logging
from typing import Any

from app import db


log = logging.getLogger(__name__)


VERIFIED_USAGE_THRESHOLD = 5    # scrapes this month → verified review badge


async def _is_verified_reviewer(user_id: str) -> bool:
    """Check if the user has enough usage history this month to earn the
    verified badge. Bounded: any DB hiccup → not verified (safer default)."""
    try:
        from app import usage
        count = await usage.get_current_usage_count(user_id)
        return count > VERIFIED_USAGE_THRESHOLD
    except Exception as e:
        log.debug("verified_check_failed", extra={"user_id": user_id, "error": repr(e)})
        return False


async def submit_review(
    *,
    user_id: str,
    target_kind: str,
    target_id: str,
    rating: int,
    body: str,
    author_name: str = "",
) -> dict[str, Any]:
    """Create-or-update review. Raises ValueError on bad input."""
    if target_kind not in ("product", "template"):
        raise ValueError(f"target_kind must be 'product' or 'template', got {target_kind!r}")
    if not (1 <= rating <= 5):
        raise ValueError(f"rating must be 1-5, got {rating}")
    if len(body) > 2000:
        raise ValueError("review body capped at 2000 chars")
    verified = await _is_verified_reviewer(user_id)
    row = await db.upsert_review(
        user_id=user_id,
        target_kind=target_kind,
        target_id=target_id,
        rating=rating,
        body=body.strip(),
        author_name=author_name.strip()[:60],
        verified=verified,
    )
    return row


async def list_for_target(target_kind: str, target_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
    """Public read — no auth filter. Used by the landing-page review block."""
    return await db.list_reviews(target_kind, target_id, limit=limit)


async def summary_for_target(target_kind: str, target_id: str) -> dict[str, Any]:
    """{count, avg, distribution: {1:N..5:N}} — aggregate for star display."""
    return await db.review_summary(target_kind, target_id)


async def delete_own_review(review_id: int, user_id: str) -> bool:
    return await db.delete_review(review_id, user_id)
