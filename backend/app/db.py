"""SQLite template store — zero-config persistence for saved recipes."""

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
    name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_updated ON templates (updated_at DESC);
"""


async def init() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_SCHEMA)
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


async def list_templates() -> list[dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM templates ORDER BY updated_at DESC"
        )
        rows = await cur.fetchall()
        return [_row_to_dict(r) for r in rows]


async def get_template(template_id: int) -> dict[str, Any] | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM templates WHERE id = ?", (template_id,)
        )
        row = await cur.fetchone()
        return _row_to_dict(row) if row else None


async def create_template(name: str, source_url: str, fields: list[dict[str, Any]]) -> dict[str, Any]:
    now = _now()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO templates (name, source_url, fields_json, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (name, source_url, json.dumps(fields), now, now),
        )
        await db.commit()
        new_id = cur.lastrowid
    fetched = await get_template(new_id)
    assert fetched is not None
    return fetched


async def update_template(template_id: int, *, name: str | None = None,
                          source_url: str | None = None,
                          fields: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    existing = await get_template(template_id)
    if existing is None:
        return None
    new_name = name if name is not None else existing["name"]
    new_source = source_url if source_url is not None else existing["source_url"]
    new_fields = fields if fields is not None else existing["fields"]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE templates SET name = ?, source_url = ?, fields_json = ?, updated_at = ? "
            "WHERE id = ?",
            (new_name, new_source, json.dumps(new_fields), _now(), template_id),
        )
        await db.commit()
    return await get_template(template_id)


async def delete_template(template_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("DELETE FROM templates WHERE id = ?", (template_id,))
        await db.commit()
        return cur.rowcount > 0
