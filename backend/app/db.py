"""SQLite template store — zero-config persistence for saved recipes.

Multi-tenant: every row carries `user_id` (Supabase auth UUID). All queries
filter by user_id so account A can never see account B's templates.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "templates.db"


# Tables first (CREATE IF NOT EXISTS is safe even on old DBs — it preserves
# existing rows). Indexes that reference NEW columns go in _SCHEMA_INDEXES
# and run AFTER the column-add migrations below, otherwise SQLite errors
# with "no such column" when upgrading an old DB.
_SCHEMA_TABLES = """
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 0,
    fork_count INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    template_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    target_url TEXT NOT NULL,
    schedule_cron TEXT NOT NULL,
    webhook_url TEXT NOT NULL DEFAULT '',
    last_run_at TEXT,
    last_status TEXT,
    next_run_at TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
    ls_subscription_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    ls_variant_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    status TEXT NOT NULL,
    current_period_end TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_counts (
    user_id TEXT NOT NULL,
    year_month TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, year_month)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    hashed_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
);
"""

# Indexes run AFTER table CREATE + column ALTERs so they reference real columns
# even when upgrading an old DB.
_SCHEMA_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_public ON templates (is_public, fork_count DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON scheduled_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_next_run ON scheduled_jobs (enabled, next_run_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_usage_user_month ON usage_counts (user_id, year_month);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (hashed_key);
"""

# Migrations — run between tables and indexes. SQLite has no ADD COLUMN IF
# NOT EXISTS, so we catch+ignore the dup-column error on each attempt.
_MIGRATIONS = (
    "ALTER TABLE templates ADD COLUMN user_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE templates ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE templates ADD COLUMN fork_count INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE templates ADD COLUMN description TEXT NOT NULL DEFAULT ''",
)


async def init() -> None:
    """Three-phase migration so old DBs upgrade cleanly:
      1. Create tables (IF NOT EXISTS preserves existing rows).
      2. Run ALTER TABLE migrations to add new columns to old tables.
         Catch the dup-column OperationalError that fires on already-migrated DBs.
      3. Create indexes — safe now that all columns they reference exist.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        # Phase 1: tables
        await db.executescript(_SCHEMA_TABLES)
        # Phase 2: column migrations
        for stmt in _MIGRATIONS:
            try:
                await db.execute(stmt)
            except aiosqlite.OperationalError:
                pass
        # Phase 3: indexes (now safe to reference all columns)
        await db.executescript(_SCHEMA_INDEXES)
        await db.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    # Defensive .get-style access for columns added in later migrations
    # (is_public, fork_count, description) — aiosqlite.Row supports key
    # access but raises if the column is missing. The conditional schema
    # bump in init() should backfill these, but we don't want a single
    # untouched-db deploy to crash the templates list.
    def _opt(key: str, default: Any) -> Any:
        try:
            v = row[key]
            return v if v is not None else default
        except IndexError:
            return default

    return {
        "id": row["id"],
        "name": row["name"],
        "source_url": row["source_url"],
        "fields": json.loads(row["fields_json"]),
        "is_public": bool(_opt("is_public", 0)),
        "fork_count": int(_opt("fork_count", 0)),
        "description": _opt("description", ""),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


async def list_templates(user_id: str) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM templates WHERE user_id = ? ORDER BY updated_at DESC",
            (user_id,),
        )
        rows = await cur.fetchall()
        return [_row_to_dict(r) for r in rows]


async def get_template(template_id: int, user_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM templates WHERE id = ? AND user_id = ?",
            (template_id, user_id),
        )
        row = await cur.fetchone()
        return _row_to_dict(row) if row else None


async def create_template(
    *,
    user_id: str,
    name: str,
    source_url: str,
    fields: list[dict[str, Any]],
) -> dict[str, Any]:
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO templates (user_id, name, source_url, fields_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, name, source_url, json.dumps(fields), now, now),
        )
        await db.commit()
        new_id = cur.lastrowid
    fetched = await get_template(new_id, user_id)
    assert fetched is not None
    return fetched


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
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE templates SET name = ?, source_url = ?, fields_json = ?, updated_at = ? "
            "WHERE id = ? AND user_id = ?",
            (new_name, new_source, json.dumps(new_fields), _now(), template_id, user_id),
        )
        await db.commit()
    return await get_template(template_id, user_id)


async def delete_template(template_id: int, user_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "DELETE FROM templates WHERE id = ? AND user_id = ?",
            (template_id, user_id),
        )
        await db.commit()
        return cur.rowcount > 0


# ── Subscriptions (Lemon Squeezy) ─────────────────────────────────────────

# Plans that grant access. Cancelled subs keep access until current_period_end
# (the LS-side state machine handles that — they fire `subscription_expired`
# when the user actually loses access).
_ACTIVE_STATUSES = ("active", "on_trial", "paused", "cancelled")


async def upsert_subscription(
    *,
    user_id: str,
    ls_subscription_id: str,
    ls_variant_id: str,
    plan: str,
    status: str,
    current_period_end: str = "",
) -> None:
    """Insert or update a subscription. Idempotent — webhook handlers can
    safely re-fire (LS retries on non-2xx)."""
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO subscriptions
                (ls_subscription_id, user_id, ls_variant_id, plan, status,
                 current_period_end, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ls_subscription_id) DO UPDATE SET
                ls_variant_id = excluded.ls_variant_id,
                plan = excluded.plan,
                status = excluded.status,
                current_period_end = excluded.current_period_end,
                updated_at = excluded.updated_at
            """,
            (ls_subscription_id, user_id, ls_variant_id, plan, status,
             current_period_end, now, now),
        )
        await db.commit()


async def update_subscription_status(
    *, ls_subscription_id: str, status: str
) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE subscriptions SET status = ?, updated_at = ? WHERE ls_subscription_id = ?",
            (status, _now(), ls_subscription_id),
        )
        await db.commit()


async def get_user_plan(user_id: str) -> str:
    """Return the user's current plan name, or `'free'` if they have no
    active subscription. Used by the plan-gating dependency at request time."""
    placeholders = ",".join("?" * len(_ACTIVE_STATUSES))
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            f"SELECT plan FROM subscriptions "
            f"WHERE user_id = ? AND status IN ({placeholders}) "
            f"ORDER BY updated_at DESC LIMIT 1",
            (user_id, *_ACTIVE_STATUSES),
        )
        row = await cur.fetchone()
        return row["plan"] if row else "free"


# ── Usage metering (per-user, per-calendar-month) ─────────────────────────

async def get_usage_count(user_id: str, year_month: str) -> int:
    """Return the scrape count for this user in the given YYYY-MM bucket.
    Returns 0 if there's no row yet."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT count FROM usage_counts WHERE user_id = ? AND year_month = ?",
            (user_id, year_month),
        )
        row = await cur.fetchone()
        return int(row["count"]) if row else 0


async def increment_usage_count(user_id: str, year_month: str, by: int = 1) -> None:
    """Atomic increment of the user's usage count for the calendar month.
    Uses SQLite's ON CONFLICT DO UPDATE so concurrent requests race-safely."""
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO usage_counts (user_id, year_month, count, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, year_month) DO UPDATE SET
                count = count + excluded.count,
                updated_at = excluded.updated_at
            """,
            (user_id, year_month, by, now),
        )
        await db.commit()


# ── API keys ──────────────────────────────────────────────────────────────
#
# Storage: we save sha256(raw_key) only. Raw key shown once on creation,
# never again. Lookup: hash(incoming bearer) → row → user_id.
# Format: `ssk_<32 random hex chars>` (40 chars total).
# Prefix: first 8 chars after `ssk_` saved for UI display ("ssk_abc12345…").

import hashlib
import secrets

_API_KEY_PREFIX = "ssk_"
_API_KEY_BYTES = 16  # 32 hex chars after the prefix


def _hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _generate_api_key() -> tuple[str, str, str]:
    """Returns (raw_key, prefix_for_display, hashed_key_for_storage)."""
    raw = f"{_API_KEY_PREFIX}{secrets.token_hex(_API_KEY_BYTES)}"
    prefix_display = raw[: len(_API_KEY_PREFIX) + 8]  # e.g. "ssk_abc12345"
    return raw, prefix_display, _hash_api_key(raw)


async def create_api_key(user_id: str, name: str) -> dict[str, Any]:
    """Create a new API key. Returns full dict including the raw `key`
    field — show it to the user ONCE and never again (we only store the
    hash)."""
    raw_key, prefix, hashed = _generate_api_key()
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            INSERT INTO api_keys (user_id, name, prefix, hashed_key, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, name, prefix, hashed, now),
        )
        await db.commit()
        key_id = cur.lastrowid
    return {
        "id": key_id,
        "name": name,
        "prefix": prefix,
        "key": raw_key,  # only field that contains the secret — frontend shows once
        "created_at": now,
        "last_used_at": None,
        "revoked_at": None,
    }


async def list_api_keys(user_id: str) -> list[dict[str, Any]]:
    """Returns metadata for the user's keys. Does NOT include hashed_key
    or raw key — keys are write-once-read-never after creation."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, name, prefix, created_at, last_used_at, revoked_at "
            "FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
        rows = await cur.fetchall()
        return [dict(row) for row in rows]


async def revoke_api_key(key_id: int, user_id: str) -> bool:
    """Soft-delete by setting revoked_at. Revoked keys fail auth lookup."""
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "UPDATE api_keys SET revoked_at = ? "
            "WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
            (_now(), key_id, user_id),
        )
        await db.commit()
        return cur.rowcount > 0


# ── Templates marketplace (public templates) ──────────────────────────────

async def list_public_templates(limit: int = 50) -> list[dict[str, Any]]:
    """Public templates ranked by fork_count (most-used first), then recency."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM templates WHERE is_public = 1 "
            "ORDER BY fork_count DESC, updated_at DESC LIMIT ?",
            (limit,),
        )
        rows = await cur.fetchall()
        return [_row_to_dict(r) for r in rows]


async def set_template_public(template_id: int, user_id: str, is_public: bool,
                                description: str = "") -> dict[str, Any] | None:
    """Mark/unmark a template as public for the marketplace. Only the owner can."""
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "UPDATE templates SET is_public = ?, description = ?, updated_at = ? "
            "WHERE id = ? AND user_id = ?",
            (1 if is_public else 0, description, _now(), template_id, user_id),
        )
        await db.commit()
        if cur.rowcount == 0:
            return None
    return await get_template(template_id, user_id)


async def fork_public_template(template_id: int, user_id: str) -> dict[str, Any] | None:
    """Copy a public template into the calling user's account. Increments fork
    counter on the original. Returns the new template owned by `user_id`."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM templates WHERE id = ? AND is_public = 1",
            (template_id,),
        )
        src = await cur.fetchone()
        if src is None:
            return None
        await db.execute(
            "UPDATE templates SET fork_count = fork_count + 1 WHERE id = ?",
            (template_id,),
        )
        now = _now()
        ins = await db.execute(
            "INSERT INTO templates "
            "(user_id, name, source_url, fields_json, is_public, fork_count, description, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)",
            (
                user_id,
                f"{src['name']} (fork)",
                src["source_url"],
                src["fields_json"],
                "",
                now,
                now,
            ),
        )
        await db.commit()
        new_id = ins.lastrowid
    return await get_template(new_id, user_id)


# ── Scheduled jobs (cron'd scrapes) ───────────────────────────────────────

async def list_jobs(user_id: str) -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM scheduled_jobs WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        )
        return [dict(row) for row in await cur.fetchall()]


async def create_job(*, user_id: str, template_id: int, name: str,
                       target_url: str, schedule_cron: str,
                       webhook_url: str = "") -> dict[str, Any]:
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO scheduled_jobs "
            "(user_id, template_id, name, target_url, schedule_cron, webhook_url, created_at, updated_at, enabled) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
            (user_id, template_id, name, target_url, schedule_cron, webhook_url, now, now),
        )
        await db.commit()
        job_id = cur.lastrowid
    return await get_job(job_id, user_id) or {}


async def get_job(job_id: int, user_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM scheduled_jobs WHERE id = ? AND user_id = ?",
            (job_id, user_id),
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def delete_job(job_id: int, user_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "DELETE FROM scheduled_jobs WHERE id = ? AND user_id = ?",
            (job_id, user_id),
        )
        await db.commit()
        return cur.rowcount > 0


async def toggle_job(job_id: int, user_id: str, enabled: bool) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "UPDATE scheduled_jobs SET enabled = ?, updated_at = ? "
            "WHERE id = ? AND user_id = ?",
            (1 if enabled else 0, _now(), job_id, user_id),
        )
        await db.commit()
        return cur.rowcount > 0


async def list_due_jobs() -> list[dict[str, Any]]:
    """All enabled jobs whose next_run_at is in the past (or null). Used by
    the scheduler tick loop."""
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM scheduled_jobs WHERE enabled = 1 "
            "AND (next_run_at IS NULL OR next_run_at <= ?)",
            (now,),
        )
        return [dict(row) for row in await cur.fetchall()]


async def mark_job_ran(job_id: int, *, next_run_at: str, status: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE scheduled_jobs SET last_run_at = ?, last_status = ?, "
            "next_run_at = ?, updated_at = ? WHERE id = ?",
            (_now(), status, next_run_at, _now(), job_id),
        )
        await db.commit()


# ── API key auth lookup ───────────────────────────────────────────────────

async def lookup_api_key_user(raw_key: str) -> str | None:
    """Validate a bearer API key and return the owning user_id.
    Returns None for unknown, revoked, or malformed keys.

    Side effect: updates last_used_at on a successful lookup so users can
    see when their key was last hit."""
    if not raw_key.startswith(_API_KEY_PREFIX):
        return None
    hashed = _hash_api_key(raw_key)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, user_id, revoked_at FROM api_keys WHERE hashed_key = ?",
            (hashed,),
        )
        row = await cur.fetchone()
        if row is None or row["revoked_at"] is not None:
            return None
        await db.execute(
            "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
            (_now(), row["id"]),
        )
        await db.commit()
        return row["user_id"]
