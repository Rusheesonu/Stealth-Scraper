"""Template SQLite store — CRUD + round-trip.

We monkeypatch app.db.DB_PATH into a tmp file per test so the dev DB
never gets touched.
"""

import asyncio
from pathlib import Path

import pytest

from app import db


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_file = tmp_path / "templates.db"
    monkeypatch.setattr(db, "DB_PATH", db_file)
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)
    asyncio.run(db.init())
    yield db_file


def _run(coro):
    return asyncio.run(coro)


def test_create_and_list_template(tmp_db):
    t = _run(
        db.create_template(
            name="HN frontpage",
            source_url="https://news.ycombinator.com",
            fields=[{"label": "title", "selector": ".titleline a", "kind": "list"}],
        )
    )
    assert t["id"] > 0
    assert t["name"] == "HN frontpage"
    assert t["fields"][0]["label"] == "title"

    listing = _run(db.list_templates())
    assert len(listing) == 1
    assert listing[0]["id"] == t["id"]


def test_update_template(tmp_db):
    created = _run(
        db.create_template(
            name="Before",
            source_url="https://example.com",
            fields=[{"label": "t", "selector": "h1", "kind": "text"}],
        )
    )
    updated = _run(db.update_template(created["id"], name="After"))
    assert updated is not None
    assert updated["name"] == "After"
    # Fields preserved when only name changes.
    assert updated["fields"][0]["label"] == "t"


def test_delete_template(tmp_db):
    created = _run(
        db.create_template(
            name="x", source_url="https://x.com", fields=[]
        )
    )
    assert _run(db.delete_template(created["id"])) is True
    assert _run(db.get_template(created["id"])) is None
    # Second delete is a no-op.
    assert _run(db.delete_template(created["id"])) is False


def test_fields_round_trip(tmp_db):
    """List field with attr reads a non-trivial JSON blob end to end."""
    fields = [
        {"label": "titles", "selector": ".t", "kind": "list"},
        {"label": "links", "selector": ".t a", "kind": "attr", "attr": "href"},
    ]
    t = _run(db.create_template(name="R", source_url="https://r.com", fields=fields))
    fetched = _run(db.get_template(t["id"]))
    assert fetched is not None
    assert fetched["fields"] == fields
