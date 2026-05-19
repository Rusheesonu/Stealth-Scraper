"""Residential proxy pool — picks proxies for the browser to route through.

Proxy config lives in `backend/data/proxies.json` (gitignored). This module
is *pure* — it just hands out formatted proxy URLs. The actual nodriver
integration (browser.py + CDP `Fetch.authRequired` handler for auth) is
the next piece — see roadmap.

Design notes for the wiring step:
    1. Free tier: bypass entirely (no proxy = no cost, no slow first byte).
    2. Hobby+: rotate per snapshot/extract request. Pick proxy → restart
       browser pool with new --proxy-server flag.
    3. Per-user sticky (later): `pick_for_user(user_id)` so a single user's
       requests land on the same egress IP and don't trip per-session
       anti-bot heuristics.
"""

from __future__ import annotations

import hashlib
import json
import random
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PROXIES_PATH = DATA_DIR / "proxies.json"


@lru_cache(maxsize=1)
def _config() -> dict:
    if not PROXIES_PATH.exists():
        return {"credentials": [], "endpoints": []}
    return json.loads(PROXIES_PATH.read_text())


def available() -> bool:
    cfg = _config()
    return bool(cfg.get("credentials")) and bool(cfg.get("endpoints"))


def pick_random() -> str | None:
    """A random `http://user:pass@host:port` URL, or None if pool empty."""
    cfg = _config()
    creds = cfg.get("credentials", [])
    endpoints = cfg.get("endpoints", [])
    if not creds or not endpoints:
        return None
    c = random.choice(creds)
    e = random.choice(endpoints)
    return f"http://{c['user']}:{c['pass']}@{e['host']}:{e['port']}"


def pick_for_user(user_id: str) -> str | None:
    """Deterministic per-user proxy endpoint (same user → same egress IP).
    Credentials still rotate per session to avoid rate-limit attribution
    across long-lived sessions."""
    cfg = _config()
    creds = cfg.get("credentials", [])
    endpoints = cfg.get("endpoints", [])
    if not creds or not endpoints:
        return None
    h = int(hashlib.sha256(user_id.encode("utf-8")).hexdigest(), 16)
    e = endpoints[h % len(endpoints)]
    c = random.choice(creds)
    return f"http://{c['user']}:{c['pass']}@{e['host']}:{e['port']}"


def host_port_user_pass() -> tuple[str, int, str, str] | None:
    """Same as pick_random but returns the 4-tuple unpacked — useful when
    nodriver wants the host+port for --proxy-server and the user+pass for
    a CDP `Fetch.authRequired` handler."""
    cfg = _config()
    creds = cfg.get("credentials", [])
    endpoints = cfg.get("endpoints", [])
    if not creds or not endpoints:
        return None
    c = random.choice(creds)
    e = random.choice(endpoints)
    return e["host"], e["port"], c["user"], c["pass"]


def all_endpoints() -> list[dict]:
    """Endpoints without credentials — for health/status views."""
    return list(_config().get("endpoints", []))
