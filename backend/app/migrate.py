"""Apply the initial Postgres schema to the database in DATABASE_URL.

Idempotent — uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
everywhere. Safe to re-run.

Usage:
    DATABASE_URL=postgresql://... python -m app.migrate
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg


MIGRATION_FILE = Path(__file__).resolve().parent.parent / "migrations" / "initial.sql"


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        sys.stderr.write(
            "DATABASE_URL not set. For Supabase use the session pooler URL "
            "(Settings → Database → Connection string → Session).\n"
        )
        sys.exit(2)

    if not MIGRATION_FILE.exists():
        sys.stderr.write(f"Missing migration file: {MIGRATION_FILE}\n")
        sys.exit(2)

    sql = MIGRATION_FILE.read_text()
    print(f"Applying {MIGRATION_FILE.name} → {_redact_dsn(dsn)}")

    conn = await asyncpg.connect(dsn, timeout=15)
    try:
        await conn.execute(sql)
        tables = await conn.fetch(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' ORDER BY table_name"
        )
        print(f"✓ Done. Tables: {[t['table_name'] for t in tables]}")
    finally:
        await conn.close()


def _redact_dsn(dsn: str) -> str:
    """Hide password in a connection string for safe logging."""
    if "@" not in dsn:
        return dsn
    head, host = dsn.rsplit("@", 1)
    if ":" not in head:
        return dsn
    scheme_user = head.rsplit(":", 1)[0]
    return f"{scheme_user}:****@{host}"


if __name__ == "__main__":
    asyncio.run(main())
