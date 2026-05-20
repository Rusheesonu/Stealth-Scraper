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


_SCHEMA = """
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates (user_id, updated_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);

CREATE TABLE IF NOT EXISTS usage_counts (
    user_id TEXT NOT NULL,
    year_month TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, year_month)
);
CREATE INDEX IF NOT EXISTS idx_usage_user_month ON usage_counts (user_id, year_month);
"""


async def init() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_SCHEMA)
        # Backfill column for pre-existing dbs (older schema, no user_id).
        # SQLite has no ADD COLUMN IF NOT EXISTS — catch and ignore the dup.
        try:
            await db.execute(
                "ALTER TABLE templates ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"
            )
        except aiosqlite.OperationalError:
            pass
        await db.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "source_url": row["source_url"],
        "fields": json.loads(row["fields_json"]),
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
