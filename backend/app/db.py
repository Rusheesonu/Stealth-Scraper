"""Persistent data layer — async via asyncpg pool against Supabase Postgres.

DATABASE_URL env var is REQUIRED. For Supabase use the session pooler URL:

    postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres

Supabase direct connections (db.<project>.supabase.co:5432) require IPv6 since
mid-2024 and break from most ISPs — use the pooler URL.

Schema is in `backend/migrations/initial.sql` and is verified at startup.
This module just connects + runs queries; schema migrations are out-of-band.

Why no aiosqlite anymore: HF Spaces free tier has no persistent disk → SQLite
got wiped on every rebuild → subscriptions vanished → paying customers got
locked out. Postgres on Supabase is free up to 500MB + persistent.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg


DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

_pool: Optional[asyncpg.Pool] = None
_pool_lock = asyncio.Lock()


# ── Pool lifecycle ────────────────────────────────────────────────────────

async def _get_pool() -> asyncpg.Pool:
    """Lazy-init the connection pool. Safe under concurrent first-callers."""
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is not None:
            return _pool
        if not DATABASE_URL:
            raise RuntimeError(
                "DATABASE_URL env var required. For Supabase use the SESSION POOLER "
                "URL (Settings → Database → Connection string → Session pooler) — "
                "direct connection requires IPv6 and won't work from most ISPs."
            )
        # Pool sizing tuned for Product Hunt launch burst load:
        #   min_size=2  — warm pool so the FIRST request in a burst doesn't
        #                eat the asyncpg connect cost (~150ms cold).
        #   max_size=20 — Supabase free tier allows 60 client conns via the
        #                pooler; 20 leaves headroom for scheduler, bench,
        #                and the LS billing webhook listener.
        #   command_timeout=30 — kill stalled queries fast. The default 60s
        #                lets a runaway extract pin a connection long enough
        #                that the pool saturates under burst load.
        #   max_inactive_connection_lifetime=300 — recycle idle conns every
        #                5 min so PgBouncer's stale-conn cleanup doesn't
        #                hand us a dead socket.
        _pool = await asyncpg.create_pool(
            DATABASE_URL,
            min_size=2,
            max_size=20,
            command_timeout=30,
            # Supabase's pooler runs PgBouncer in transaction mode, which doesn't
            # support PREPARE — disable the per-connection statement cache.
            statement_cache_size=0,
            max_inactive_connection_lifetime=300,
        )
    return _pool


async def init() -> None:
    """Initialize pool + verify schema exists. Called from FastAPI lifespan
    on startup. Raises if DATABASE_URL is unset or schema is missing."""
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        present = await conn.fetchval(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name='templates'"
        )
        if present == 0:
            raise RuntimeError(
                "Schema not initialized — run the migration in Supabase SQL editor "
                "or `python -m app.migrate`. See backend/migrations/initial.sql."
            )
        # Late-add table — webhook idempotency was bolted on after the
        # initial migration was already applied to prod, so self-create
        # here for backwards compat. Idempotent CREATE IF NOT EXISTS.
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_webhook_events (
                event_id      TEXT PRIMARY KEY,
                received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                payload       JSONB
            )
            """
        )


# ── Acquire helper — bounded wait, surfaces saturation as HTTP 503 ────────

# Default 5s budget for getting a connection from the pool. If the pool is
# saturated (all 20 conns in flight, all callers waiting), the 21st caller
# would hang for the full asyncpg default (~60s) without this guard. 5s is
# the sweet spot: long enough to absorb a brief burst, short enough that a
# saturated pool surfaces to the user as a clean 503 instead of a Caddy
# upstream timeout. Override via DB_ACQUIRE_TIMEOUT for stress testing.
ACQUIRE_TIMEOUT_S = float(os.getenv("DB_ACQUIRE_TIMEOUT", "5.0"))


class DBUnavailable(RuntimeError):
    """Raised when the pool is saturated and a connection couldn't be
    obtained within ACQUIRE_TIMEOUT_S. main.py maps this to 503 — caller
    sees a clean "service unavailable" rather than a hung request."""


from contextlib import asynccontextmanager as _asynccontextmanager


@_asynccontextmanager
async def _acquire(pool: asyncpg.Pool):
    """Wrap `pool.acquire()` with a bounded wait. Use this everywhere in
    this module instead of raw `pool.acquire()` — it's the entire point
    of the 5s timeout: a saturated pool surfaces as 503 in <5s instead
    of hanging for 60s.

    The double-context-manager is deliberate: asyncpg's `pool.acquire()`
    is itself an async context manager, but the underlying mechanism is
    `pool._acquire(...)` which is awaitable. `asyncio.wait_for` works on
    the awaitable form; we then yield the connection and release it in
    finally."""
    try:
        conn = await asyncio.wait_for(pool.acquire(), timeout=ACQUIRE_TIMEOUT_S)
    except asyncio.TimeoutError as e:
        raise DBUnavailable(
            f"DB pool saturated (waited {ACQUIRE_TIMEOUT_S}s) — "
            f"all {pool.get_size()} connections in flight"
        ) from e
    try:
        yield conn
    finally:
        try:
            await pool.release(conn)
        except Exception:
            pass


async def close() -> None:
    """Close the pool. Called from FastAPI lifespan on shutdown."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ts(value: Any) -> Optional[str]:
    """Coerce a Postgres timestamptz value to ISO string (or None)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _rowcount_from_status(status: str) -> int:
    """Parse `'DELETE 1'` / `'UPDATE 0'` / `'INSERT 0 1'` → integer affected rows."""
    if not status:
        return 0
    try:
        return int(status.split()[-1])
    except ValueError:
        return 0


# ── Templates ─────────────────────────────────────────────────────────────

def _template_to_dict(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "source_url": row["source_url"],
        "fields": json.loads(row["fields_json"]),
        "is_public": bool(row["is_public"]),
        "fork_count": int(row["fork_count"]),
        "description": row["description"] or "",
        "created_at": _ts(row["created_at"]),
        "updated_at": _ts(row["updated_at"]),
    }


async def list_templates(user_id: str) -> list[dict[str, Any]]:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        rows = await conn.fetch(
            "SELECT * FROM templates WHERE user_id = $1 ORDER BY updated_at DESC",
            user_id,
        )
        return [_template_to_dict(r) for r in rows]


async def get_template(template_id: int, user_id: str) -> dict[str, Any] | None:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM templates WHERE id = $1 AND user_id = $2",
            template_id, user_id,
        )
        return _template_to_dict(row) if row else None


async def create_template(*, user_id: str, name: str, source_url: str,
                           fields: list[dict[str, Any]]) -> dict[str, Any]:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "INSERT INTO templates (user_id, name, source_url, fields_json) "
            "VALUES ($1, $2, $3, $4) RETURNING *",
            user_id, name, source_url, json.dumps(fields),
        )
        return _template_to_dict(row)


async def update_template(
    template_id: int,
    *,
    user_id: str,
    name: str | None = None,
    source_url: str | None = None,
    fields: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    existing = await get_template(template_id, user_id)
    if existing is None:
        return None
    new_name = name if name is not None else existing["name"]
    new_source = source_url if source_url is not None else existing["source_url"]
    new_fields = fields if fields is not None else existing["fields"]
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "UPDATE templates SET name = $1, source_url = $2, fields_json = $3, updated_at = NOW() "
            "WHERE id = $4 AND user_id = $5 RETURNING *",
            new_name, new_source, json.dumps(new_fields), template_id, user_id,
        )
        return _template_to_dict(row) if row else None


async def delete_template(template_id: int, user_id: str) -> bool:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "DELETE FROM templates WHERE id = $1 AND user_id = $2 RETURNING id",
            template_id, user_id,
        )
        return row is not None


# ── Marketplace ───────────────────────────────────────────────────────────

async def list_public_templates(limit: int = 50) -> list[dict[str, Any]]:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        rows = await conn.fetch(
            "SELECT * FROM templates WHERE is_public = TRUE "
            "ORDER BY fork_count DESC, updated_at DESC LIMIT $1",
            limit,
        )
        return [_template_to_dict(r) for r in rows]


async def set_template_public(template_id: int, user_id: str, is_public: bool,
                                description: str = "") -> dict[str, Any] | None:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "UPDATE templates SET is_public = $1, description = $2, updated_at = NOW() "
            "WHERE id = $3 AND user_id = $4 RETURNING *",
            is_public, description, template_id, user_id,
        )
        return _template_to_dict(row) if row else None


async def fork_public_template(template_id: int, user_id: str) -> dict[str, Any] | None:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        async with conn.transaction():
            src = await conn.fetchrow(
                "SELECT * FROM templates WHERE id = $1 AND is_public = TRUE",
                template_id,
            )
            if src is None:
                return None
            await conn.execute(
                "UPDATE templates SET fork_count = fork_count + 1 WHERE id = $1",
                template_id,
            )
            new_row = await conn.fetchrow(
                "INSERT INTO templates (user_id, name, source_url, fields_json) "
                "VALUES ($1, $2, $3, $4) RETURNING *",
                user_id, f"{src['name']} (fork)", src["source_url"], src["fields_json"],
            )
            return _template_to_dict(new_row)


# ── Subscriptions ─────────────────────────────────────────────────────────

# Cancelled subs keep access until period end; LS fires `subscription_expired`
# at that point and we drop them out of _ACTIVE_STATUSES.
_ACTIVE_STATUSES = ("active", "on_trial", "paused", "cancelled")


async def get_user_email(user_id: str) -> str | None:
    """Best-effort email lookup against Supabase's auth.users table. Used
    to check admin allowlist (see usage.ADMIN_EMAILS). Returns None on any
    error — callers must treat that as "not admin", never as a hard fail."""
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        try:
            row = await conn.fetchrow(
                "SELECT email FROM auth.users WHERE id = $1::uuid",
                user_id,
            )
        except Exception:
            return None
        return row["email"] if row and row["email"] else None


async def get_user_plan(user_id: str) -> str:
    # Admin allowlist short-circuits the subscriptions lookup. Imported
    # lazily to avoid a usage→db→usage import cycle.
    from app.usage import is_admin_email
    email = await get_user_email(user_id)
    if is_admin_email(email):
        return "admin"

    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "SELECT plan FROM subscriptions "
            "WHERE user_id = $1 AND status = ANY($2::text[]) "
            "ORDER BY updated_at DESC LIMIT 1",
            user_id, list(_ACTIVE_STATUSES),
        )
        return row["plan"] if row else "free"


async def upsert_subscription(
    *,
    user_id: str,
    ls_subscription_id: str,
    ls_variant_id: str,
    plan: str,
    status: str,
    current_period_end: str = "",
) -> None:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        await conn.execute(
            """
            INSERT INTO subscriptions
                (ls_subscription_id, user_id, ls_variant_id, plan, status, current_period_end)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (ls_subscription_id) DO UPDATE SET
                ls_variant_id = EXCLUDED.ls_variant_id,
                plan = EXCLUDED.plan,
                status = EXCLUDED.status,
                current_period_end = EXCLUDED.current_period_end,
                updated_at = NOW()
            """,
            ls_subscription_id, user_id, ls_variant_id, plan, status, current_period_end,
        )


async def record_processed_webhook(event_id: str, payload: dict[str, Any]) -> bool:
    """Insert (event_id, payload) into processed_webhook_events.

    Returns True on a fresh insert, False if the event_id was already
    processed (duplicate delivery). Idempotency is enforced by the table's
    PRIMARY KEY on event_id — UniqueViolationError on conflict means we've
    seen this exact webhook before and the caller should short-circuit
    rather than re-apply state.
    """
    pool = await _get_pool()
    async with pool.acquire() as conn:
        try:
            await conn.execute(
                "INSERT INTO processed_webhook_events (event_id, payload) "
                "VALUES ($1, $2::jsonb)",
                event_id, json.dumps(payload),
            )
            return True
        except asyncpg.UniqueViolationError:
            return False


async def update_subscription_status(*, ls_subscription_id: str, status: str) -> None:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        await conn.execute(
            "UPDATE subscriptions SET status = $1, updated_at = NOW() "
            "WHERE ls_subscription_id = $2",
            status, ls_subscription_id,
        )


# ── Usage (per-user per-month) ────────────────────────────────────────────

async def get_usage_count(user_id: str, year_month: str) -> int:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "SELECT count FROM usage_counts WHERE user_id = $1 AND year_month = $2",
            user_id, year_month,
        )
        return int(row["count"]) if row else 0


async def increment_usage_count(user_id: str, year_month: str, by: int = 1) -> None:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        await conn.execute(
            """
            INSERT INTO usage_counts (user_id, year_month, count)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, year_month) DO UPDATE SET
                count = usage_counts.count + EXCLUDED.count,
                updated_at = NOW()
            """,
            user_id, year_month, by,
        )


async def try_increment_usage(
    user_id: str, year_month: str, max_allowed: int, by: int = 1,
) -> tuple[bool, int]:
    """Atomically increment usage if (current + by) <= max_allowed.

    Returns (allowed, count_after). When NOT allowed the count is left
    untouched and the caller should raise 403. This collapses the old
    read-then-write pattern (which races under N concurrent requests
    landing on the same user_id+month row) into a single round-trip.

    The UPDATE...RETURNING is the atomic part: Postgres holds a row-level
    lock from the WHERE-match through the SET, so two concurrent calls
    serialize on the same row. The one that pushes past `max_allowed`
    fails the WHERE clause and gets a NULL row back.
    """
    pool = await _get_pool()
    async with pool.acquire() as conn:
        # Ensure the row exists. The UNIQUE constraint on (user_id,
        # year_month) is enforced by the PRIMARY KEY in migrations/initial.sql.
        await conn.execute(
            "INSERT INTO usage_counts (user_id, year_month, count) "
            "VALUES ($1, $2, 0) "
            "ON CONFLICT (user_id, year_month) DO NOTHING",
            user_id, year_month,
        )
        row = await conn.fetchrow(
            "UPDATE usage_counts SET count = count + $4, updated_at = NOW() "
            "WHERE user_id = $1 AND year_month = $2 AND count + $4 <= $3 "
            "RETURNING count",
            user_id, year_month, max_allowed, by,
        )
        if row is None:
            current = await conn.fetchval(
                "SELECT count FROM usage_counts WHERE user_id = $1 AND year_month = $2",
                user_id, year_month,
            )
            return False, int(current or 0)
        return True, int(row["count"])


# ── API Keys ──────────────────────────────────────────────────────────────

_API_KEY_PREFIX = "ssk_"
_API_KEY_BYTES = 16


def _hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _generate_api_key() -> tuple[str, str, str]:
    raw = f"{_API_KEY_PREFIX}{secrets.token_hex(_API_KEY_BYTES)}"
    prefix_display = raw[: len(_API_KEY_PREFIX) + 8]
    return raw, prefix_display, _hash_api_key(raw)


def _api_key_to_dict(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "prefix": row["prefix"],
        "created_at": _ts(row["created_at"]),
        "last_used_at": _ts(row["last_used_at"]),
        "revoked_at": _ts(row["revoked_at"]),
    }


async def create_api_key(user_id: str, name: str) -> dict[str, Any]:
    """Create a new API key. Returns full dict INCLUDING the raw `key` field —
    frontend must show it ONCE and never query for it again (we only store
    the SHA-256 hash)."""
    raw_key, prefix, hashed = _generate_api_key()
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "INSERT INTO api_keys (user_id, name, prefix, hashed_key) "
            "VALUES ($1, $2, $3, $4) RETURNING *",
            user_id, name, prefix, hashed,
        )
        result = _api_key_to_dict(row)
        result["key"] = raw_key  # one-time field — never re-emitted
        return result


async def list_api_keys(user_id: str) -> list[dict[str, Any]]:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        rows = await conn.fetch(
            "SELECT id, name, prefix, created_at, last_used_at, revoked_at "
            "FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
            user_id,
        )
        return [_api_key_to_dict(r) for r in rows]


async def revoke_api_key(key_id: int, user_id: str) -> bool:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "UPDATE api_keys SET revoked_at = NOW() "
            "WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id",
            key_id, user_id,
        )
        return row is not None


async def lookup_api_key_user(raw_key: str) -> str | None:
    """Validate a bearer API key, update last_used_at, return owner user_id.
    Returns None for unknown / revoked / malformed keys."""
    if not raw_key.startswith(_API_KEY_PREFIX):
        return None
    hashed = _hash_api_key(raw_key)
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "SELECT id, user_id, revoked_at FROM api_keys WHERE hashed_key = $1",
            hashed,
        )
        if row is None or row["revoked_at"] is not None:
            return None
        await conn.execute(
            "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1",
            row["id"],
        )
        return row["user_id"]


# ── Scheduled Jobs ────────────────────────────────────────────────────────

def _job_to_dict(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "template_id": row["template_id"],
        "name": row["name"],
        "target_url": row["target_url"],
        "schedule_cron": row["schedule_cron"],
        "webhook_url": row["webhook_url"] or "",
        "last_run_at": _ts(row["last_run_at"]),
        "last_status": row["last_status"],
        "next_run_at": _ts(row["next_run_at"]),
        # Frontend expects integer 0/1 for compat with the old SQLite layer.
        "enabled": 1 if row["enabled"] else 0,
        "created_at": _ts(row["created_at"]),
        "updated_at": _ts(row["updated_at"]),
    }


async def list_jobs(user_id: str) -> list[dict[str, Any]]:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        rows = await conn.fetch(
            "SELECT * FROM scheduled_jobs WHERE user_id = $1 ORDER BY created_at DESC",
            user_id,
        )
        return [_job_to_dict(r) for r in rows]


async def get_job(job_id: int, user_id: str) -> dict[str, Any] | None:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "SELECT * FROM scheduled_jobs WHERE id = $1 AND user_id = $2",
            job_id, user_id,
        )
        return _job_to_dict(row) if row else None


async def create_job(*, user_id: str, template_id: int, name: str,
                       target_url: str, schedule_cron: str,
                       webhook_url: str = "") -> dict[str, Any]:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "INSERT INTO scheduled_jobs "
            "(user_id, template_id, name, target_url, schedule_cron, webhook_url) "
            "VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            user_id, template_id, name, target_url, schedule_cron, webhook_url,
        )
        return _job_to_dict(row)


async def delete_job(job_id: int, user_id: str) -> bool:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "DELETE FROM scheduled_jobs WHERE id = $1 AND user_id = $2 RETURNING id",
            job_id, user_id,
        )
        return row is not None


async def toggle_job(job_id: int, user_id: str, enabled: bool) -> bool:
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        row = await conn.fetchrow(
            "UPDATE scheduled_jobs SET enabled = $1, updated_at = NOW() "
            "WHERE id = $2 AND user_id = $3 RETURNING id",
            enabled, job_id, user_id,
        )
        return row is not None


async def list_due_jobs() -> list[dict[str, Any]]:
    """All enabled jobs whose next_run_at is in the past (or NULL — meaning
    never run yet). Used by scheduler.tick()."""
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        rows = await conn.fetch(
            "SELECT * FROM scheduled_jobs WHERE enabled = TRUE "
            "AND (next_run_at IS NULL OR next_run_at <= NOW())"
        )
        return [_job_to_dict(r) for r in rows]


async def mark_job_ran(job_id: int, *, next_run_at: str, status: str) -> None:
    """next_run_at comes from scheduler.compute_next_run() as an ISO string —
    we cast to timestamptz on the DB side."""
    pool = await _get_pool()
    async with _acquire(pool) as conn:
        await conn.execute(
            "UPDATE scheduled_jobs SET last_run_at = NOW(), last_status = $1, "
            "next_run_at = $2::timestamptz, updated_at = NOW() WHERE id = $3",
            status, next_run_at, job_id,
        )
