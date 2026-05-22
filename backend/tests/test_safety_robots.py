"""Regression tests for robots.txt fetch semantics.

The May 22 2026 bug: books.toscrape.com (and any site with no
robots.txt) was being falsely blocked because Python's
`RobotFileParser.can_fetch()` returns False when the parser has
never read or parsed anything — the "empty parser = allow all"
assumption in our code was wrong.

These tests pin the correct RFC-9309 semantics so any future
"simplify robots handling" refactor that drops the explicit
allow_all flag will visibly fail.
"""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from urllib.robotparser import RobotFileParser

from app.safety import _fetch_robots, robots_check, _robots_cache


class _FakeResponse:
    def __init__(self, status_code: int, text: str = ""):
        self.status_code = status_code
        self.text = text


def _clear_cache():
    _robots_cache.clear()


@pytest.mark.asyncio
async def test_404_treated_as_allow_all():
    """books.toscrape.com / quotes.toscrape.com / example.com all
    return 404 for robots.txt. None of them have a policy → all
    fully allowed per RFC 9309."""
    _clear_cache()
    fake = _FakeResponse(status_code=404, text="<html>404 Not Found</html>")

    async def _fake_get(self, url):
        return fake

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=fake)):
        rp = await _fetch_robots("https://books.toscrape.com")

    assert rp.allow_all is True, "404 must set allow_all=True"
    assert rp.can_fetch("StealthScraper", "https://books.toscrape.com/") is True


@pytest.mark.asyncio
async def test_410_treated_as_allow_all():
    """410 Gone — another 4xx that means 'no policy'."""
    _clear_cache()
    fake = _FakeResponse(status_code=410)

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=fake)):
        rp = await _fetch_robots("https://example.com")

    assert rp.allow_all is True
    assert rp.can_fetch("StealthScraper", "https://example.com/") is True


@pytest.mark.asyncio
async def test_401_treated_as_disallow_all():
    """401 / 403 mean 'auth required to read robots' — RFC 9309 says
    treat as full disallow."""
    _clear_cache()
    fake = _FakeResponse(status_code=401)

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=fake)):
        rp = await _fetch_robots("https://private-site.example.com")

    assert rp.disallow_all is True
    assert rp.can_fetch("StealthScraper", "https://private-site.example.com/") is False


@pytest.mark.asyncio
async def test_403_treated_as_disallow_all():
    _clear_cache()
    fake = _FakeResponse(status_code=403)

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=fake)):
        rp = await _fetch_robots("https://walled-site.example.com")

    assert rp.disallow_all is True


@pytest.mark.asyncio
async def test_500_treated_as_allow_all():
    """5xx — transient server error at the target. Don't block scrapes
    just because robots.txt is temporarily down."""
    _clear_cache()
    fake = _FakeResponse(status_code=503)

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=fake)):
        rp = await _fetch_robots("https://flaky-site.example.com")

    assert rp.allow_all is True
    assert rp.can_fetch("StealthScraper", "https://flaky-site.example.com/page") is True


@pytest.mark.asyncio
async def test_network_exception_treated_as_allow_all():
    """DNS / connection errors — same logic as 5xx. Caller decided to
    scrape; a broken robots-fetch shouldn't veto."""
    _clear_cache()

    async def _raise(*a, **kw):
        raise ConnectionError("DNS lookup failed")

    with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=ConnectionError("dns fail"))):
        rp = await _fetch_robots("https://unreachable.example.com")

    assert rp.allow_all is True


@pytest.mark.asyncio
async def test_200_parses_disallow_directive():
    """200 with a Disallow directive — must HONOR it. This is the
    actual robots.txt enforcement path."""
    _clear_cache()
    fake = _FakeResponse(
        status_code=200,
        text="User-agent: *\nDisallow: /private/\n",
    )

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=fake)):
        rp = await _fetch_robots("https://strict-site.example.com")

    assert rp.can_fetch("anything", "https://strict-site.example.com/public") is True
    assert rp.can_fetch("anything", "https://strict-site.example.com/private/x") is False


@pytest.mark.asyncio
async def test_robots_check_404_url_returns_allowed():
    """Integration — `robots_check()` on a 404-robots site returns
    allowed=True. This is THE bug the user reported: books.toscrape.com
    falsely showed 'disallowed by robots.txt'."""
    _clear_cache()
    fake = _FakeResponse(status_code=404)

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=fake)):
        allowed, reason = await robots_check("https://books.toscrape.com/")

    assert allowed is True, f"books.toscrape.com (no robots.txt) must be allowed; got reason={reason!r}"
    assert reason == "allowed"


@pytest.mark.asyncio
async def test_robots_check_200_disallow_returns_blocked():
    """Integration — 200 + Disallow: / actually blocks."""
    _clear_cache()
    fake = _FakeResponse(
        status_code=200,
        text="User-agent: *\nDisallow: /\n",
    )

    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=fake)):
        allowed, reason = await robots_check("https://locked-down.example.com/page")

    assert allowed is False
    assert "robots.txt" in reason


@pytest.mark.asyncio
async def test_robots_check_override_skips_fetch():
    """override=True must bypass the check entirely (no fetch, no
    decision based on robots)."""
    _clear_cache()
    with patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=AssertionError("should not be called"))):
        allowed, reason = await robots_check(
            "https://anything.example.com/", override=True
        )
    assert allowed is True
    assert reason == "override"
