"""Unit tests for the Stealth Scraper Python SDK.

These tests stub the HTTP layer with ``httpx.MockTransport`` so they're
fully offline. They cover:

* Header propagation (auth, idempotency key auto-gen and override).
* Snapshot/extract happy paths and result parsing.
* Typed error envelopes — each `kind` should map to the expected subclass.
* Plain-status fallbacks (401 → AuthError, 429 → RateLimitError).
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from stealth_scraper import (
    AntiBotBlockError,
    ApiError,
    AsyncStealthClient,
    AuthError,
    OverloadedError,
    PlanLimitError,
    RateLimitError,
    SnapshotResult,
    StealthClient,
)

SNAPSHOT_PAYLOAD = {
    "url": "https://example.com/",
    "title": "Example",
    "screenshot": "iVBORw0KG...",
    "viewport": {"width": 1280, "height": 800},
    "page": {"description": "demo"},
    "elements": [{"selector": "h1", "text": "Hello"}],
    "element_count": 1,
}


def _mock_transport(handler):
    return httpx.MockTransport(handler)


# --- Sync client -------------------------------------------------------------


def test_snapshot_sends_auth_and_idempotency_key() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["idem"] = request.headers.get("idempotency-key")
        captured["ua"] = request.headers.get("user-agent")
        captured["body"] = json.loads(request.content.decode() or "{}")
        return httpx.Response(200, json=SNAPSHOT_PAYLOAD)

    http = httpx.Client(transport=_mock_transport(handler))
    client = StealthClient(api_key="ssk_test", http_client=http)
    snap = client.snapshot("https://example.com/")

    assert isinstance(snap, SnapshotResult)
    assert snap.title == "Example"
    assert snap.element_count == 1
    assert captured["auth"] == "Bearer ssk_test"
    assert captured["idem"] and captured["idem"].startswith("sdk-")
    assert "stealth-scraper-python" in captured["ua"]
    assert captured["body"] == {"url": "https://example.com/"}


def test_explicit_idempotency_key_passes_through() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["idem"] = request.headers.get("idempotency-key")
        return httpx.Response(200, json=SNAPSHOT_PAYLOAD)

    http = httpx.Client(transport=_mock_transport(handler))
    client = StealthClient(api_key="ssk_test", http_client=http)
    client.snapshot("https://example.com/", idempotency_key="run-42")
    assert captured["idem"] == "run-42"


def test_extract_with_template_id_fetches_first() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(f"{request.method} {request.url.path}")
        if request.url.path == "/templates/t_123":
            return httpx.Response(
                200,
                json={
                    "id": "t_123",
                    "name": "demo",
                    "source_url": "https://x.com",
                    "fields": [{"name": "title", "selector": "h1"}],
                },
            )
        return httpx.Response(
            200,
            json={"url": "https://x.com", "title": "X", "fields": {"title": "Hi"}, "errors": {}},
        )

    http = httpx.Client(transport=_mock_transport(handler))
    client = StealthClient(api_key="ssk_test", http_client=http)
    res = client.extract(url="https://x.com", template_id="t_123")
    assert res.fields == {"title": "Hi"}
    assert calls == ["GET /templates/t_123", "POST /extract"]


def test_extract_requires_template_or_template_id() -> None:
    client = StealthClient(api_key="ssk_test", http_client=httpx.Client())
    with pytest.raises(ValueError):
        client.extract(url="https://x.com")


# --- Typed error envelopes ---------------------------------------------------


def _err_handler(status: int, detail: Any, headers: dict[str, str] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"detail": detail}, headers=headers or {})

    return handler


def test_anti_bot_block_envelope_raises_typed_error() -> None:
    detail = {
        "kind": "anti_bot_block",
        "message": "blocked by cloudflare",
        "vendor": "cloudflare",
        "suggestion": "try residential proxies",
    }
    http = httpx.Client(transport=_mock_transport(_err_handler(422, detail)))
    client = StealthClient(api_key="ssk_test", http_client=http)
    with pytest.raises(AntiBotBlockError) as exc:
        client.snapshot("https://blocked.example/")
    assert exc.value.vendor == "cloudflare"
    assert exc.value.suggestion == "try residential proxies"
    assert exc.value.status_code == 422
    assert exc.value.kind == "anti_bot_block"


def test_plan_limit_envelope() -> None:
    detail = {
        "kind": "plan_limit",
        "message": "monthly cap reached",
        "used": 1000,
        "limit": 1000,
        "upgrade_url": "https://stealthscraper.dev/upgrade",
    }
    http = httpx.Client(transport=_mock_transport(_err_handler(402, detail)))
    client = StealthClient(api_key="ssk_test", http_client=http)
    with pytest.raises(PlanLimitError) as exc:
        client.snapshot("https://x.example/")
    assert exc.value.used == 1000
    assert exc.value.limit == 1000
    assert exc.value.upgrade_url.endswith("/upgrade")


def test_overloaded_envelope_with_retry_after() -> None:
    detail = {"kind": "overloaded", "message": "queue full", "retry_after_s": 12}
    http = httpx.Client(transport=_mock_transport(_err_handler(503, detail)))
    client = StealthClient(api_key="ssk_test", http_client=http)
    with pytest.raises(OverloadedError) as exc:
        client.snapshot("https://x.example/")
    assert exc.value.retry_after_s == 12.0


def test_401_without_kind_falls_back_to_auth_error() -> None:
    http = httpx.Client(transport=_mock_transport(_err_handler(401, "invalid key")))
    client = StealthClient(api_key="ssk_test", http_client=http)
    with pytest.raises(AuthError) as exc:
        client.snapshot("https://x.example/")
    assert exc.value.status_code == 401


def test_429_uses_retry_after_header() -> None:
    http = httpx.Client(
        transport=_mock_transport(
            _err_handler(429, "slow down", headers={"retry-after": "7"})
        )
    )
    client = StealthClient(api_key="ssk_test", http_client=http)
    with pytest.raises(RateLimitError) as exc:
        client.snapshot("https://x.example/")
    assert exc.value.retry_after_s == 7.0


def test_unmapped_kind_falls_through_to_api_error() -> None:
    detail = {"kind": "something_new", "message": "novel failure"}
    http = httpx.Client(transport=_mock_transport(_err_handler(500, detail)))
    client = StealthClient(api_key="ssk_test", http_client=http)
    with pytest.raises(ApiError) as exc:
        client.snapshot("https://x.example/")
    assert exc.value.kind == "something_new"
    assert exc.value.status_code == 500


def test_missing_api_key_raises_immediately(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("STEALTH_SCRAPER_API_KEY", raising=False)
    with pytest.raises(ValueError):
        StealthClient()


def test_env_var_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STEALTH_SCRAPER_API_KEY", "ssk_env_value")
    client = StealthClient(http_client=httpx.Client())
    assert client._api_key == "ssk_env_value"


# --- Async client ------------------------------------------------------------


@pytest.mark.asyncio
async def test_async_snapshot_round_trip() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=SNAPSHOT_PAYLOAD)

    async with AsyncStealthClient(
        api_key="ssk_test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        snap = await client.snapshot("https://example.com/")
        assert snap.title == "Example"


@pytest.mark.asyncio
async def test_async_assist_extract() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        assert body["description"] == "top 3 items"
        return httpx.Response(
            200,
            json={
                "url": "https://news.example/",
                "title": "News",
                "description": body["description"],
                "template": [{"name": "title", "selector": "h2"}],
                "element_count": 7,
            },
        )

    async with AsyncStealthClient(
        api_key="ssk_test",
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),
    ) as client:
        res = await client.assist_extract("https://news.example/", "top 3 items")
        assert res.template[0]["selector"] == "h2"
