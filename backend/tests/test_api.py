"""Light smoke tests for the FastAPI app.

No Playwright is invoked here — we just assert that the endpoints are
wired, validation works, and the templates CRUD round-trips through HTTP.
"""

from fastapi.testclient import TestClient

import pytest


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Isolate DB first, THEN import the app so main.lifespan binds to our tmp DB.
    from app import db

    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    monkeypatch.setattr(db, "DATA_DIR", tmp_path)

    from app.main import app

    with TestClient(app) as c:
        yield c


def test_root(client):
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["service"] == "stealth-scraper"


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    # Browser shouldn't be up until we actually hit /snapshot.
    assert body["browser"] is False


def test_templates_crud(client):
    # Empty list
    r = client.get("/templates")
    assert r.status_code == 200
    assert r.json() == []

    # Create
    payload = {
        "name": "HN",
        "source_url": "https://news.ycombinator.com",
        "fields": [
            {"label": "title", "selector": ".titleline a", "kind": "text", "xpath": "", "attr": ""}
        ],
    }
    r = client.post("/templates", json=payload)
    assert r.status_code == 201
    created = r.json()
    assert created["name"] == "HN"

    # Get
    r = client.get(f"/templates/{created['id']}")
    assert r.status_code == 200

    # Update
    r = client.put(f"/templates/{created['id']}", json={"name": "HN2"})
    assert r.status_code == 200
    assert r.json()["name"] == "HN2"

    # Delete
    r = client.delete(f"/templates/{created['id']}")
    assert r.status_code == 204

    # 404 on missing
    r = client.get(f"/templates/{created['id']}")
    assert r.status_code == 404


def test_snapshot_url_validation(client):
    r = client.post("/snapshot", json={"url": "not-a-url"})
    assert r.status_code == 422


def test_extract_url_validation(client):
    r = client.post("/extract", json={"url": "bogus", "template": []})
    assert r.status_code == 422
