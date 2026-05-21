"""Multi-engine scraping core with intelligent router.

The thesis: no single browser-automation library is best at every site.
nodriver gets Cloudflare-easy but flakes on Cloudflare-hard. Playwright
+ patches gets DataDome but bloats RAM. curl-impersonate-via-curl_cffi
beats Akamai TLS-fingerprinting at 50x the speed of any browser BUT
can't render JS. camoufox is the only thing that beats creepjs.

So: pluggable `Engine` protocol + a `Router` that picks the right
engine per (URL, vendor, requirements) and ESCALATES on failure.

Layout:
    engines/
    ├── __init__.py        ← public surface (Engine, Router, Capability)
    ├── base.py            ← Engine ABC, SnapshotResult dataclass shared
    ├── nodriver_engine.py ← wraps existing app.snapshot.take_snapshot
    ├── curl_cffi_engine.py← TLS-impersonating HTTP (no JS execution)  (next iter)
    ├── patchright_engine.py  ← Playwright fork w/ deep patches        (next iter)
    ├── camoufox_engine.py    ← patched Firefox for fingerprint        (next iter)
    └── router.py          ← rule-based + learning-augmented dispatcher

Usage from the production endpoint:
    from app.engines import router
    result = await router.snapshot(url, requirements=Requirements(
        needs_js=True, vendor_hint="cloudflare",
    ))
    # router picks the cheapest engine satisfying requirements + with
    # historical track record on this URL/vendor, escalates on failure.

Why a Protocol not an ABC: keeps duck-typing flexible, makes mocking
easier in tests, lets us add engines from external packages without
inheritance plumbing.
"""

from .base import (
    Engine,
    Capability,
    Requirements,
    EngineSnapshotResult,
    EngineUnavailableError,
    EngineFailedError,
)
from .router import EngineRouter, EngineDecision

__all__ = [
    "Engine",
    "Capability",
    "Requirements",
    "EngineSnapshotResult",
    "EngineUnavailableError",
    "EngineFailedError",
    "EngineRouter",
    "EngineDecision",
    "router",
]


# Module-level singleton — production endpoint imports this. Engines
# are registered lazily on first router call so a missing optional dep
# (e.g. curl_cffi not installed) doesn't crash app boot.
router = EngineRouter()


def _register_default_engines() -> None:
    """Register every engine we know about. Each engine's `is_available()`
    method gates whether it actually shows up in the router's candidate
    list — missing libs = skipped silently."""
    from .nodriver_engine import NodriverEngine
    router.register(NodriverEngine())
    # curl_cffi: TLS-impersonating HTTP. No JS, but 50x faster + wins on
    # TLS-fingerprint-checked vendors (DataDome, Akamai).
    from .curl_cffi_engine import CurlCffiEngine
    router.register(CurlCffiEngine())
    # Future iters:
    # from .patchright_engine import PatchrightEngine; router.register(PatchrightEngine())
    # from .camoufox_engine import CamoufoxEngine; router.register(CamoufoxEngine())


_register_default_engines()
