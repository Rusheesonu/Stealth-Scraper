"""Bearer auth — accepts either a Supabase user JWT (browser sessions)
OR a Stealth-Scraper API key (`ssk_...` prefix, programmatic clients).

JWTs are verified against Supabase's JWKS endpoint (asymmetric ES256/RS256).
API keys are SHA-256 hashed and looked up in the local `api_keys` table.

Both paths return the user_id (Supabase UUID) so downstream code is
identical regardless of credential type.
"""

from __future__ import annotations

import os
from functools import lru_cache

import jwt
from fastapi import Header, HTTPException, status
from jwt import PyJWKClient

from app import db


API_KEY_PREFIX = "ssk_"


def _supabase_url() -> str:
    """Read SUPABASE_URL at use time, not import time, so app boot doesn't
    crash before dotenv has loaded (e.g. during pytest collection or
    `python -c` smoke tests)."""
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise HTTPException(
            status_code=503,
            detail="SUPABASE_URL not configured on the server — set the env var",
        )
    return url


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    # PyJWKClient caches keys internally. We cache the client itself so all
    # requests share one connection. Computed lazily — first call to
    # get_current_user is what triggers the real env var check.
    jwks_url = f"{_supabase_url()}/auth/v1/.well-known/jwks.json"
    return PyJWKClient(jwks_url, cache_keys=True, lifespan=600)


async def get_current_user(authorization: str = Header(default="")) -> str:
    """Resolve a bearer credential to a user_id.

    Accepts:
      * `Authorization: Bearer ssk_<hex>` — Stealth-Scraper API key
      * `Authorization: Bearer <supabase-jwt>` — browser session

    Raises 401 on missing / malformed / invalid / expired / revoked credential.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization[len("Bearer "):].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="empty bearer token",
        )

    # API-key path — short, deterministic, no network.
    if token.startswith(API_KEY_PREFIX):
        user_id = await db.lookup_api_key_user(token)
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid or revoked API key",
            )
        return user_id

    # JWT path — verify via Supabase JWKS.
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
            options={"verify_exp": True},
        )
    except jwt.ExpiredSignatureError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token expired",
        ) from e
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {e}",
        ) from e

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="token has no subject",
        )
    return user_id


async def get_current_user_jwt_only(authorization: str = Header(default="")) -> str:
    """Like get_current_user but REJECTS API keys — only the browser session
    JWT is accepted. Used for credential-management endpoints (you can't
    use an API key to create/list/revoke other API keys; that would let a
    leaked key escalate)."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token (browser session required for this endpoint)",
        )
    token = authorization[len("Bearer "):].strip()
    if token.startswith(API_KEY_PREFIX):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key cannot be used to manage other API keys — sign in via browser",
        )
    return await get_current_user(authorization)
