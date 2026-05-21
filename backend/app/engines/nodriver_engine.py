"""nodriver-based engine — wraps the existing take_snapshot.

This is the BASELINE engine that powers production today. The router
treats it as one option among many; it's also the only engine production
currently calls directly (main.py imports take_snapshot, not router).
The bench is the first caller that actually goes through the router.

Capabilities declared honestly:
  ✓ JS_EXEC                  — Chromium runs page JS
  ✓ SCREENSHOT, DOM_QUERY    — primary outputs
  ✓ CDP_NATIVE               — nodriver IS CDP
  ✓ PROXY_SUPPORT            — proxies.py + browser.py
  ✓ COOKIE_PERSISTENCE       — within a browser session (no per-task isolation yet)
  ✗ TLS_IMPERSONATION        — vanilla Chromium TLS, can be detected
  ✗ HTTP2_FINGERPRINT        — same — H2 settings can be different from real Chrome
  ✗ BEHAVIORAL               — no mouse-path simulation in current actions.py
  ✗ FIREFOX_ENGINE           — chromium
  ✗ LIGHTWEIGHT              — full Chromium subprocess; ~800MB RAM
  ✗ HEADED                   — runs --headless=new
  ✗ MOBILE_EMULATION         — could add via CDP Emulation but not exposed here

Cost: 1¢/page bucket. Actual compute cost on Lightsail is ~0.0001¢ but
the cents-int unit doesn't represent fractions; 1 is the smallest
ranking unit and reserves room for free engines (curl_cffi=0) to rank
strictly cheaper. Don't read absolute values; the router only uses
these for ordinal comparison.
"""

from __future__ import annotations

import time

from .base import (
    Capability,
    EngineFailedError,
    EngineSnapshotResult,
    Requirements,
)


class NodriverEngine:
    """Concrete engine wrapping app.snapshot.take_snapshot."""

    name = "nodriver"
    capabilities = (
        Capability.JS_EXEC
        | Capability.SCREENSHOT
        | Capability.DOM_QUERY
        | Capability.CDP_NATIVE
        | Capability.PROXY_SUPPORT
        | Capability.COOKIE_PERSISTENCE
    )
    cost_per_request_cents = 1  # ordinal rank — see module docstring

    async def is_available(self) -> bool:
        """Import-check: if nodriver itself isn't installed, return False
        so the router skips us silently."""
        try:
            import nodriver  # noqa: F401
            return True
        except ImportError:
            return False

    async def snapshot(
        self,
        url: str,
        *,
        requirements: Requirements,
    ) -> EngineSnapshotResult:
        """Drive production take_snapshot, normalize to EngineSnapshotResult."""
        # Local imports — keeps engine module light if app.snapshot has
        # heavy deps not needed by other engines.
        from app.snapshot import take_snapshot

        viewport_w = 390 if requirements.needs_mobile_ui else 1440
        viewport_h = 844 if requirements.needs_mobile_ui else 900

        t0 = time.perf_counter()
        try:
            snap = await take_snapshot(
                url,
                viewport_width=viewport_w,
                viewport_height=viewport_h,
            )
        except Exception as e:
            raise EngineFailedError(
                f"nodriver snapshot failed: {e}",
                engine=self.name,
                # If the error is a hard "page blocked us" (vs a transient
                # nodriver flake), escalating to a different engine MIGHT
                # help — same site, different TLS fingerprint. So default
                # to retriable_on_other_engine=True.
                retriable_on_other_engine=True,
            ) from e

        # Try to capture current proxy label for telemetry — best-effort.
        proxy_label = None
        try:
            from app.browser import pool
            proxy_label = pool.current_proxy_label()
        except Exception:
            pass

        return EngineSnapshotResult(
            url=snap.url,
            title=snap.title,
            screenshot_base64=snap.screenshot_base64,
            elements=snap.elements,
            viewport=snap.viewport,
            page=snap.page,
            engine_name=self.name,
            elapsed_s=round(time.perf_counter() - t0, 3),
            cost_cents=self.cost_per_request_cents,
            proxy_used=proxy_label,
            cookies_carried=0,  # browser pool doesn't track per-call cookies yet
            notes=f"chromium, elements={len(snap.elements or [])}",
        )
