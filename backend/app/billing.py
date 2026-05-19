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
import os

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status

from app import db
from app.auth import get_current_user


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

    return {"received": True, "event": x_event_name}


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
