"""curl_cffi engine — TLS-impersonating HTTP, no JS execution.

Why this engine exists:
  DataDome, Akamai BMP, and Cloudflare-Enterprise inspect the TLS
  ClientHello fingerprint (JA3/JA4) BEFORE any JS runs. Chromium-via-
  nodriver has a fingerprint that DIFFERS from real Chrome on certain
  edge cases (cipher ordering, extension list, GREASE values, ALPN order).
  curl-impersonate (the underlying C library that curl_cffi wraps) was
  specifically built to send the EXACT bytes of a real Chrome 131
  ClientHello — so the TLS layer can't tell us apart.

What this engine is GREAT for:
  - Static HTML content (most news/blog/listing pages — surprisingly many)
  - APIs that return JSON
  - Sites where the anti-bot check happens at TLS layer (not JS layer)
  - 50-100x faster than a real browser (~200ms vs ~10s)
  - Cheap: pure HTTP, no Chromium process, ~10MB RAM vs ~800MB

What this engine CAN'T do:
  - Execute JavaScript (the page DOM is what the server returns)
  - Run anti-bot challenge JS (so won't pass Turnstile, PerimeterX, etc.)
  - Capture client-rendered SPAs (React/Vue/Angular apps)
  - Get a real screenshot (we render a placeholder PNG since the engine
    contract requires one — for screenshot-required cases, use a browser)

Router strategy:
  - JS_EXEC capability NOT advertised → caller must opt in to non-JS path
  - LIGHTWEIGHT capability YES → router picks this when prefer_lightweight=True
  - TLS_IMPERSONATION + HTTP2_FINGERPRINT YES → wins on those vendors
  - Cost: 0 cents/page (pure HTTP, no compute beyond the request itself)

Failure escalation:
  - HTTP 403/429/503 → return EngineFailedError(retriable_on_other_engine=True)
    so router falls through to nodriver
  - Hard timeout → same
  - DNS / connection refused → same
"""

from __future__ import annotations

import asyncio
import base64
import time
from typing import Optional

from .base import (
    Capability,
    Engine,
    EngineFailedError,
    EngineSnapshotResult,
    Requirements,
)


# 1x1 transparent PNG — placeholder for the screenshot field since the
# engine contract requires one but we can't actually render a page.
_BLANK_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjC"
    "B0C8AAAAASUVORK5CYII="
)


# Chrome impersonation profiles supported by curl_cffi. We pick the
# newest stable that matches our --user-agent flag (Chrome 131).
# If a future curl_cffi version drops chrome131 support, fall back to
# the closest available.
_IMPERSONATE_PROFILE = "chrome131"


class CurlCffiEngine:
    """TLS-impersonating HTTP client. No JS execution."""

    name = "curl_cffi"
    capabilities = (
        Capability.SCREENSHOT          # (placeholder PNG — see module docstring)
        | Capability.DOM_QUERY         # we return raw HTML; caller parses
        | Capability.TLS_IMPERSONATION # the whole point
        | Capability.HTTP2_FINGERPRINT # curl-impersonate matches Chrome H2 SETTINGS
        | Capability.LIGHTWEIGHT       # ~10MB RAM, <500ms typical
        | Capability.PROXY_SUPPORT     # honors proxy URL
        # NOT JS_EXEC — caller must accept static content
    )
    cost_per_request_cents = 0  # essentially free — pure HTTP

    async def is_available(self) -> bool:
        try:
            import curl_cffi  # noqa: F401
            return True
        except ImportError:
            return False

    async def snapshot(
        self,
        url: str,
        *,
        requirements: Requirements,
    ) -> EngineSnapshotResult:
        """Fetch HTML via curl_cffi with Chrome-131 TLS impersonation.

        Returns the raw HTML in `elements` as a single pseudo-element so
        the existing extract pipeline can still query it. NOT a real
        DOM — caller that needs computed styles / interactive state
        should use a browser engine instead.
        """
        # If caller requires JS execution, we can't help — escalate immediately
        # rather than returning empty HTML the caller will assume is real.
        if requirements.needs_js:
            raise EngineFailedError(
                "curl_cffi can't execute JS; escalate to a browser engine",
                engine=self.name,
                retriable_on_other_engine=True,
            )

        from curl_cffi.requests import AsyncSession

        # Best-effort proxy plumbing via app.proxies (same pool nodriver uses)
        proxy_url = self._maybe_proxy_url()

        t0 = time.perf_counter()
        async with AsyncSession(impersonate=_IMPERSONATE_PROFILE) as session:
            try:
                resp = await session.get(
                    url,
                    proxy=proxy_url,
                    timeout=min(requirements.max_latency_s, 30.0),
                    allow_redirects=True,
                )
            except Exception as e:
                raise EngineFailedError(
                    f"curl_cffi request failed: {type(e).__name__}: {e}",
                    engine=self.name,
                    retriable_on_other_engine=True,
                ) from e

        elapsed = round(time.perf_counter() - t0, 3)

        # Anti-bot-style HTTP statuses: escalate to a browser engine
        if resp.status_code in (403, 429, 503, 520, 521, 522, 525):
            raise EngineFailedError(
                f"curl_cffi got HTTP {resp.status_code} — likely anti-bot block, escalate",
                engine=self.name,
                retriable_on_other_engine=True,
            )

        # Parse out the title quickly without lxml dep here — engine should
        # stay lightweight. Caller can do full parsing on the html field.
        html = resp.text or ""
        title = ""
        try:
            import re
            m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
            if m:
                title = m.group(1).strip()[:200]
        except Exception:
            pass

        # Wrap the raw HTML in a single "element" so downstream code that
        # iterates result.elements still works. Tag it specially so the
        # extract pipeline (which is selector-based) knows this is the
        # whole document body, not a per-element catalog.
        elements = [
            {
                "tag": "html",
                "text": html[:200000],   # cap to 200KB to match in-browser memory budgets
                "css": "html",
                "xpath": "/html",
                "attrs": {"x-engine": "curl_cffi", "x-status": str(resp.status_code)},
                "bbox": {"x": 0, "y": 0, "w": 1440, "h": 900},
            }
        ]

        return EngineSnapshotResult(
            url=str(resp.url),
            title=title,
            screenshot_base64=_BLANK_PNG_B64,
            elements=elements,
            viewport={"width": 1440, "height": 900},
            page={"width": 1440, "height": 900},
            engine_name=self.name,
            elapsed_s=elapsed,
            cost_cents=self.cost_per_request_cents,
            proxy_used=proxy_url.split("@")[-1] if proxy_url else None,
            cookies_carried=len(resp.cookies),
            notes=f"http {resp.status_code}, {len(html)} bytes",
        )

    @staticmethod
    def _maybe_proxy_url() -> Optional[str]:
        """Same proxy pool that browser engines use — share IPs so the
        target can't detect engine swap by IP change. Best-effort."""
        try:
            from app import proxies
            if proxies.available():
                return proxies.pick_random()
        except Exception:
            pass
        return None
