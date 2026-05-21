"""Lemon Squeezy webhook handler + plan-tier helpers.

LS sends signed POST requests for subscription lifecycle events. We verify
HMAC-SHA256 signatures, parse the payload, persist state to the `subscriptions`
table, and rely on `db.get_user_plan(user_id)` for runtime plan gating.

The webhook endpoint is NOT auth-gated — LS sends without a user JWT.
Authenticity comes from the signature, not the bearer token.

User identity is passed from the frontend via the `custom_data.user_id` field
on the LS checkout link.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app import db
from app.auth import get_current_user


log = logging.getLogger(__name__)

# Reject webhook events older than this. LS doesn't sign timestamps, so
# even with a valid HMAC an attacker who captured a payload off the wire
# (or from logs) could replay it forever — combined with the idempotency
# table this is the second layer that limits replay attacks to a tight
# window. 10 minutes is generous enough for retries from LS's queue but
# tight enough that captured payloads expire quickly.
WEBHOOK_MAX_AGE_SECONDS = 600


def _parse_event_created_at(raw: str) -> datetime | None:
    """Parse an ISO-8601 timestamp from `attributes.created_at`. Returns
    None on any parse failure — the caller treats None as 'no timestamp,
    skip the freshness check'."""
    if not raw:
        return None
    try:
        # LS sends 'Z' for UTC; Python <3.11 needs +00:00.
        normalized = raw.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except (ValueError, TypeError):
        return None


LS_WEBHOOK_SECRET = os.getenv("LEMONSQUEEZY_WEBHOOK_SECRET", "")
LS_STORE_ID = os.getenv("LEMONSQUEEZY_STORE_ID", "")
LS_API_KEY = os.getenv("LEMONSQUEEZY_API_KEY", "")
LS_VARIANT_HOBBY = os.getenv("LS_VARIANT_HOBBY", "")
LS_VARIANT_PRO = os.getenv("LS_VARIANT_PRO", "")
LS_VARIANT_BUSINESS = os.getenv("LS_VARIANT_BUSINESS", "")

LS_API_BASE = "https://api.lemonsqueezy.com/v1"

_PLAN_TO_VARIANT = {
    "hobby": LS_VARIANT_HOBBY,
    "pro": LS_VARIANT_PRO,
    "business": LS_VARIANT_BUSINESS,
}


router = APIRouter(prefix="/billing", tags=["billing"])


# ── Variant → plan name ───────────────────────────────────────────────────

def _variant_to_plan(variant_id: str) -> str:
    """Map LS variant ID to internal plan name. Empty env values are ignored
    so we don't accidentally match all unknown variants to a single plan."""
    if variant_id and variant_id == LS_VARIANT_HOBBY:
        return "hobby"
    if variant_id and variant_id == LS_VARIANT_PRO:
        return "pro"
    if variant_id and variant_id == LS_VARIANT_BUSINESS:
        return "business"
    return "unknown"


# ── Signature verification ────────────────────────────────────────────────

def _verify_signature(payload: bytes, signature: str) -> bool:
    if not LS_WEBHOOK_SECRET or not signature:
        return False
    expected = hmac.new(
        LS_WEBHOOK_SECRET.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


# ── Webhook endpoint ──────────────────────────────────────────────────────

@router.post("/webhook")
async def lemonsqueezy_webhook(
    request: Request,
    x_signature: str = Header(default=""),
    x_event_name: str = Header(default=""),
) -> dict:
    payload = await request.body()

    if not _verify_signature(payload, x_signature):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid webhook signature",
        )

    body = json.loads(payload)
    data = body.get("data", {})
    attributes = data.get("attributes", {}) or {}
    meta = body.get("meta", {}) or {}
    custom_data = meta.get("custom_data", {}) or {}

    # Frontend stamps user_id into custom_data when constructing checkout URLs.
    user_id = custom_data.get("user_id", "")
    ls_subscription_id = str(data.get("id", ""))
    ls_variant_id = str(attributes.get("variant_id", ""))

    # ── Replay protection ──────────────────────────────────────────────
    # Two layers below the HMAC check:
    #   1. Freshness window — reject events whose `created_at` is more
    #      than WEBHOOK_MAX_AGE_SECONDS in the past. Limits how long a
    #      captured payload remains useful to an attacker who got hold
    #      of the raw HMAC-signed body (e.g. via a log scrape).
    #   2. Idempotency table — `processed_webhook_events.event_id` is
    #      a PRIMARY KEY. A duplicate INSERT returns False and we exit
    #      without re-applying. Catches both LS retry-storms (legit) and
    #      replays within the freshness window (malicious).
    event_id = ls_subscription_id or str(body.get("id", "")) or ""
    if not event_id:
        # No id to dedupe on. Refuse rather than risk re-applying — LS
        # always sends a data.id, so missing one means malformed payload
        # or non-LS sender.
        log.warning("webhook.missing_event_id", extra={"event_name": x_event_name})
        raise HTTPException(status_code=400, detail="missing event id")

    created_at = _parse_event_created_at(attributes.get("created_at", ""))
    if created_at is not None:
        age = (datetime.now(timezone.utc) - created_at).total_seconds()
        if age > WEBHOOK_MAX_AGE_SECONDS:
            log.warning(
                "webhook.stale",
                extra={
                    "event_id": event_id,
                    "event_name": x_event_name,
                    "age_seconds": int(age),
                },
            )
            raise HTTPException(status_code=400, detail="stale webhook (replay)")

    # Log the raw payload BEFORE attempting to persist. If processing
    # crashes downstream we still have the payload in stdout / journald
    # for manual replay. The HMAC secret is the only sensitive field
    # the request carries, and it's in the header — never in the body.
    log.info(
        "webhook.received",
        extra={
            "event_id": event_id,
            "event_name": x_event_name,
            "user_id": user_id,
            "variant_id": ls_variant_id,
        },
    )

    fresh = await db.record_processed_webhook(event_id, body)
    if not fresh:
        # Already processed — return 200 so LS doesn't keep retrying.
        log.info("webhook.duplicate", extra={"event_id": event_id, "event_name": x_event_name})
        return {"status": "duplicate", "event_id": event_id}

    if x_event_name == "subscription_created":
        if not user_id:
            return {"received": True, "warn": "no user_id in custom_data — sub not linked"}
        await db.upsert_subscription(
            user_id=user_id,
            ls_subscription_id=ls_subscription_id,
            ls_variant_id=ls_variant_id,
            plan=_variant_to_plan(ls_variant_id),
            status=attributes.get("status", "active"),
            current_period_end=attributes.get("renews_at", ""),
        )

    elif x_event_name == "subscription_updated":
        if not user_id:
            return {"received": True, "warn": "no user_id in custom_data — sub not linked"}
        await db.upsert_subscription(
            user_id=user_id,
            ls_subscription_id=ls_subscription_id,
            ls_variant_id=ls_variant_id,
            plan=_variant_to_plan(ls_variant_id),
            status=attributes.get("status", "active"),
            current_period_end=attributes.get("renews_at", ""),
        )

    elif x_event_name == "subscription_cancelled":
        # User cancelled but still has access until current_period_end.
        # LS sets status="cancelled" and we keep checking the period end at gate time.
        await db.update_subscription_status(
            ls_subscription_id=ls_subscription_id,
            status="cancelled",
        )

    elif x_event_name == "subscription_expired":
        # Period ended after cancellation — actually lose access now.
        await db.update_subscription_status(
            ls_subscription_id=ls_subscription_id,
            status="expired",
        )

    return {"received": True, "status": "processed", "event": x_event_name, "event_id": event_id}


# ── Checkout session creation ─────────────────────────────────────────────

@router.post("/checkout")
async def create_checkout(
    plan: str,
    user_id: str = Depends(get_current_user),
) -> dict:
    """Create a Lemon Squeezy checkout session for the requested plan and
    return the hosted-checkout URL. We stamp `user_id` into `custom_data`
    so the subscription webhook can link the resulting LS sub back to this
    account."""
    variant_id = _PLAN_TO_VARIANT.get(plan)
    if not variant_id:
        raise HTTPException(status_code=400, detail=f"unknown plan: {plan}")

    if not LS_API_KEY or not LS_STORE_ID:
        raise HTTPException(status_code=500, detail="billing not configured")

    payload = {
        "data": {
            "type": "checkouts",
            "attributes": {
                "checkout_data": {
                    "custom": {"user_id": user_id},
                },
            },
            "relationships": {
                "store": {"data": {"type": "stores", "id": LS_STORE_ID}},
                "variant": {"data": {"type": "variants", "id": variant_id}},
            },
        },
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        res = await client.post(
            f"{LS_API_BASE}/checkouts",
            headers={
                "Authorization": f"Bearer {LS_API_KEY}",
                "Content-Type": "application/vnd.api+json",
                "Accept": "application/vnd.api+json",
            },
            json=payload,
        )

    if res.status_code != 201:
        raise HTTPException(
            status_code=502,
            detail=f"LS checkout creation failed: {res.status_code} {res.text[:300]}",
        )

    url = res.json().get("data", {}).get("attributes", {}).get("url")
    if not url:
        raise HTTPException(status_code=502, detail="LS did not return checkout URL")

    return {"checkout_url": url}
