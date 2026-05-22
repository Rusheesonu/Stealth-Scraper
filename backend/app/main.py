"""Stealth-Scraper v2 API.

Endpoints:
    POST /snapshot           — URL → screenshot + element catalog
    POST /extract            — URL + template → structured data
    GET  /templates          — list saved templates (user-scoped)
    POST /templates          — create template
    GET  /templates/{id}     — get one
    PUT  /templates/{id}     — update
    DEL  /templates/{id}     — delete
    GET  /health             — liveness + browser status

All routes except /, /health, and the OpenAPI docs require a valid
Supabase user JWT in `Authorization: Bearer <token>`.
"""

# ruff: noqa: E402  — load_dotenv must run before any submodule that reads env.
from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import socket
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()  # app.auth needs SUPABASE_URL at import time.

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl

# Sentry — best-effort. Imported in a try/except so a stripped-down dev
# install (no sentry-sdk) still boots. In production both SENTRY_DSN and
# the package must be present.
try:
    import sentry_sdk  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    sentry_sdk = None  # type: ignore[assignment]

from app import assist, db, scheduler as job_scheduler
from app.actions import BrowserAction
from app.auth import get_current_user, get_current_user_jwt_only
from app.browser import pool
from app.extract import extract as extract_fields
from app.snapshot import take_snapshot
from app.usage import enforce_plan, enforce_plan_bulk, plan_limit, current_year_month


log = logging.getLogger(__name__)


# ── Sentry ────────────────────────────────────────────────────────────────
# Init early — before lifespan — so any startup error during db.init() or
# browser pool setup gets captured. send_default_pii=False because URLs we
# scrape can carry API tokens in querystrings; `before_send` strips
# querystrings from breadcrumbs as a second layer.

def _scrub_event(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
    """Strip URL query strings from breadcrumbs + request data so we don't
    leak auth tokens that visitors paste into the scraper. Keeps the path
    so we still know WHAT failed, not WHERE the secret was."""
    try:
        for crumb in event.get("breadcrumbs", {}).get("values", []) or []:
            url = (crumb.get("data") or {}).get("url")
            if isinstance(url, str) and "?" in url:
                crumb["data"]["url"] = url.split("?", 1)[0] + "?[redacted]"
        req = event.get("request") or {}
        url = req.get("url")
        if isinstance(url, str) and "?" in url:
            req["url"] = url.split("?", 1)[0] + "?[redacted]"
        # Strip Authorization header content too — never want raw bearers
        # in Sentry events even though SDK should already redact common ones.
        headers = req.get("headers") or {}
        for k in list(headers.keys()):
            if k.lower() in ("authorization", "cookie", "x-signature"):
                headers[k] = "[redacted]"
    except Exception:
        # Scrubbing must NEVER swallow the original event — return as-is
        # on any failure rather than dropping the error report.
        pass
    return event


if sentry_sdk is not None and os.getenv("SENTRY_DSN"):
    sentry_sdk.init(
        dsn=os.getenv("SENTRY_DSN"),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        environment=os.getenv("ENV", "production"),
        send_default_pii=False,
        before_send=_scrub_event,
    )


# ── Concurrency cap ───────────────────────────────────────────────────────
# Chrome is RAM-hungry — a single tab eats ~150MB and the Lightsail box
# we're launching on has ~2GB usable. 8 concurrent scrapes ≈ ~1.2GB
# resident; anything higher and the OOM killer reaps the container right
# when traffic peaks (HN front page, PH launch).
#
# Acquire is bounded to 5s — if we can't get a slot in that window the
# caller already gave up or the user-facing UI has spun far longer than
# a healthy preview should. Return 503 with retry_after_s so the
# frontend can show "we're busy, try again in 10s" instead of timing out.
SCRAPE_SEMAPHORE = asyncio.Semaphore(int(os.getenv("MAX_CONCURRENT_SCRAPES", "8")))
SCRAPE_ACQUIRE_TIMEOUT_S = float(os.getenv("SCRAPE_ACQUIRE_TIMEOUT_S", "5.0"))

# Per-user concurrency cap. The global semaphore above protects the host
# from OOM, but doesn't stop ONE user from queueing 100 requests and
# starving everyone else. Cap each authed user (identified by Supabase
# user_id) to PER_USER_CONCURRENCY_CAP in-flight scrapes; acquired BEFORE
# the global semaphore so a heavy user backs up against their own cap and
# waits in their own queue instead of holding global slots.
#
# Public/anonymous endpoints skip this cap (no user_id) — they're already
# IP-rate-limited and still subject to the global cap.
PER_USER_CAP = int(os.getenv("PER_USER_CONCURRENCY_CAP", "3"))
_per_user_semaphores: defaultdict[str, asyncio.Semaphore] = defaultdict(
    lambda: asyncio.Semaphore(PER_USER_CAP)
)


@asynccontextmanager
async def scrape_slot():
    """Async context manager: acquire one of the bounded scrape slots, or
    raise 503 if we couldn't grab one within SCRAPE_ACQUIRE_TIMEOUT_S.

    Use around every endpoint that drives the browser pool. Release is
    guaranteed via `finally` even when the body raises."""
    try:
        await asyncio.wait_for(SCRAPE_SEMAPHORE.acquire(), timeout=SCRAPE_ACQUIRE_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=503,
            detail={"kind": "overloaded", "retry_after_s": 10},
        )
    try:
        yield
    finally:
        SCRAPE_SEMAPHORE.release()


@asynccontextmanager
async def per_user_slot(user_id: str):
    """Acquire a per-user concurrency slot. Acquired BEFORE the global
    semaphore so noisy users self-throttle without blocking the global
    pool. Same 503 shape as scrape_slot on timeout — frontend already
    knows how to render it."""
    sem = _per_user_semaphores[user_id]
    try:
        await asyncio.wait_for(sem.acquire(), timeout=SCRAPE_ACQUIRE_TIMEOUT_S)
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=503,
            detail={"kind": "overloaded", "retry_after_s": 10},
        )
    try:
        yield
    finally:
        sem.release()


def _unsafe_url_http422(reason: str) -> HTTPException:
    """Build the structured 422 we surface when the SSRF guard rejects."""
    return HTTPException(
        status_code=422,
        detail={"kind": "unsafe_url", "message": reason},
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Postgres pool init — fails loud if DATABASE_URL is unset or schema is missing.
    await db.init()
    # Don't eagerly start the browser — lazy-init on first request keeps
    # cold-boot fast and avoids OOM on small hosts.
    # Scheduled scrapes: APScheduler tick every 60s, runs any due cron jobs.
    job_scheduler.start_scheduler()
    yield
    job_scheduler.stop_scheduler()
    await pool.stop()
    await db.close()


# Disable the interactive docs + OpenAPI schema in production. They leak
# the full route surface (including admin/internal endpoints) to anyone
# who curls /openapi.json, and we don't need them after launch — the SDKs
# already pin their schema. Keep them on in dev/staging so the local loop
# is unaffected.
_DOCS_KWARGS: dict[str, Any] = (
    {"docs_url": None, "redoc_url": None, "openapi_url": None}
    if os.getenv("ENV") == "production"
    else {}
)

app = FastAPI(
    title="Stealth-Scraper v2",
    description="Visual point-and-click web scraper. No XPath required.",
    version="2.0.0",
    lifespan=lifespan,
    **_DOCS_KWARGS,
)

# CORS — locked down for production. The Next.js frontend on Vercel
# proxies server-to-server via rewrites, so the browser never sees the
# backend origin and CORS doesn't apply for the main app. The explicit
# allowlist below covers:
#   - the canonical production host
#   - the www subdomain
#   - the Vercel preview URL (so PR preview deployments work)
#   - localhost in non-prod for the dev loop
#
# Direct curl/Postman use isn't affected by CORS (no Origin header).
# Third parties wanting to hit the API directly from their own browser
# would need to add their origin — but that's a feature request, not
# something we should grant by default.
_CORS_ORIGINS: list[str] = [
    "https://stealthscraper.dev",
    "https://www.stealthscraper.dev",
    "https://stealth-scraper.vercel.app",
]
if os.getenv("ENV") != "production":
    _CORS_ORIGINS.extend(["http://localhost:3000", "http://127.0.0.1:3000"])
# Additional origins from env (comma-separated). Used for PR preview
# subdomains under stealth-scraper-*.vercel.app — we add the regex too.
for extra in (os.getenv("CORS_EXTRA_ORIGINS", "") or "").split(","):
    if extra.strip():
        _CORS_ORIGINS.append(extra.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    # Match any Vercel preview branch deployment for this project.
    # Pattern: https://stealth-scraper-<hash>-<team>.vercel.app
    allow_origin_regex=r"^https://stealth-scraper-[a-z0-9-]+\.vercel\.app$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Billing webhook router — signature-verified, NOT auth-gated (LS sends, not users).
from app.billing import router as billing_router  # noqa: E402

app.include_router(billing_router)


# DB pool saturation → 503 instead of hanging the request for 60s.
# The DBUnavailable exception is raised by db._acquire() when the pool
# can't hand us a conn within ACQUIRE_TIMEOUT_S. This is the surface
# UptimeRobot sees during a burst — clean 503 with a short message.
from fastapi.responses import JSONResponse  # noqa: E402


@app.exception_handler(db.DBUnavailable)
async def _db_unavailable_handler(request: Request, exc: db.DBUnavailable) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": "Database busy — please retry in a moment."},
    )


# ── Models ────────────────────────────────────────────────────────────────

class ActionStep(BaseModel):
    """A pre-extraction browser action: click a button, fill a field, scroll, wait."""
    kind: str  # "click" | "fill" | "scroll" | "wait" | "wait_for"
    selector: str = ""
    value: str = ""
    ms: int = 500
    timeout_ms: int = 5000


class SnapshotRequest(BaseModel):
    url: HttpUrl
    viewport_width: int = Field(default=1440, ge=320, le=3840)
    viewport_height: int = Field(default=900, ge=480, le=2160)
    actions: list[ActionStep] | None = None


class TransformStep(BaseModel):
    """A single cleanup step on an extracted value. See extract.TRANSFORM_OPS
    for the supported `op` names. Unknown ops are silently dropped at apply
    time so old saved templates don't break."""
    op: str
    value: str = ""
    pattern: str = ""
    repl: str = ""
    sep: str = ""
    start: int | None = None
    end: int | None = None


class TemplateField(BaseModel):
    label: str
    selector: str = ""
    xpath: str = ""
    kind: str = "text"  # "text" | "attr" | "list" | "html" | "markdown"
    attr: str = ""
    # Optional post-extraction cleanup pipeline (strip/regex/cast/etc).
    transforms: list[TransformStep] = []


class ExtractRequest(BaseModel):
    url: HttpUrl
    template: list[TemplateField]
    output_format: str = "fields"      # "fields" | "markdown" | "html"
    pagination_selector: str | None = None
    max_pages: int = Field(default=1, ge=1, le=20)
    actions: list[ActionStep] | None = None
    # Pre-rendered HTML the caller already has (typically from a recent
    # /snapshot response — the picker passes `snapshot.html`). When set,
    # /extract skips browser navigation entirely and runs the template
    # against this HTML via `extract_from_html` — schema/value drift
    # between snapshot-A (picker generation time) and snapshot-B
    # (extract time) is structurally impossible.
    # Cap matches `snapshot.py`'s outerHTML cap (5 MB). When these two
    # disagree (as they did briefly between 88c971a and now) the
    # snapshot ships 2-3 MB of HTML, the picker passes it back, and
    # Pydantic rejects the request with `string_too_long` (422) before
    # extract even runs — user sees a generic 422 instead of values.
    expected_html: str | None = Field(default=None, max_length=5 * 1024 * 1024)


class BatchExtractRequest(BaseModel):
    urls: list[HttpUrl] = Field(min_length=1, max_length=100)
    template: list[TemplateField]
    output_format: str = "fields"
    actions: list[ActionStep] | None = None


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    source_url: str
    fields: list[TemplateField]


class TemplateUpdate(BaseModel):
    name: str | None = None
    source_url: str | None = None
    fields: list[TemplateField] | None = None


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class AssistSchemaRequest(BaseModel):
    """Ask the LLM to generate a template from a URL + plain-English description."""
    url: HttpUrl
    description: str = Field(min_length=3, max_length=500)
    viewport_width: int = Field(default=1440, ge=320, le=3840)
    viewport_height: int = Field(default=900, ge=480, le=2160)


# ── Public routes ─────────────────────────────────────────────────────────

@app.get("/")
async def root() -> dict[str, Any]:
    return {
        "service": "stealth-scraper",
        "version": "2.0.0",
        "docs": "/docs",
    }


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "browser": pool.running,
        "proxy": pool.current_proxy_label(),
    }


@app.get("/status")
async def status_endpoint(response: Response) -> dict[str, Any]:
    """Public status data — consumed by the /status page on the frontend
    AND by UptimeRobot (which alerts on non-200). No auth required. Don't
    expose any per-user data here.

    Probes (cheap, sub-second):
      * Pool — `pool.running` flag.
      * DB — `SELECT 1` with a 1s timeout. If asyncpg pool is saturated
        OR Supabase is unreachable, this fails fast and we degrade.
      * LLM — just checks `assist.is_configured()` (does NOT call Groq;
        that'd burn quota on every uptime check and isn't worth the cost).
      * LLM fallback — set / unset.

    Severity ladder (kept simple — fewer states = less ambiguity for
    on-call):
      * `operational` — all core probes green.
      * `degraded` — DB OR pool down (but not both). Returns 200 so the
        frontend status page renders normally; UptimeRobot won't fire.
      * `down` — 2+ core probes failing. Returns 503 so UptimeRobot pages.
    """
    models = assist.active_models() if assist.is_configured() else None
    # If we have any live model in the chain, the AI service is "operational"
    # — even if some models are dead-cached, the chain falls through.
    ai_status = (
        "not configured" if not assist.is_configured()
        else "operational" if models and any(m not in models["dead"] for m in models["chain"])
        else "degraded"  # every model in chain is currently cached as dead
    )

    # ── Probe: scrape pool ────────────────────────────────────────────
    pool_ok = bool(pool.running)

    # ── Probe: DB ─────────────────────────────────────────────────────
    # 1s budget — the status endpoint MUST stay sub-second so UptimeRobot
    # checks don't pile up. A slow Supabase counts as degraded.
    db_ok = False
    db_error: str | None = None
    try:
        pool_obj = await asyncio.wait_for(db._get_pool(), timeout=1.0)
        async with pool_obj.acquire() as conn:
            await asyncio.wait_for(conn.fetchval("SELECT 1"), timeout=1.0)
        db_ok = True
    except asyncio.TimeoutError:
        db_error = "timeout"
    except Exception as e:
        # Swallow the specific error; don't leak DSN-shaped stuff to a
        # public endpoint. Type name is enough for ops triage.
        db_error = type(e).__name__

    # ── Probe: LLM (config check only — DON'T actually call) ─────────
    llm_ok = assist.is_configured()
    fallback_ok = bool(assist.LLM_API_KEY_FALLBACK)

    # ── Severity calc ─────────────────────────────────────────────────
    # Core failure = DB unreachable. The browser pool is lazy-initialized
    # (we don't spin Chromium until the first scrape — saves ~600MB RAM
    # idle), so `pool.running=False` is the NORMAL state for a fresh
    # container with no scrapes yet. Counting that as degradation would
    # make /status flap every container restart. If pool startup itself
    # is broken, requests will surface that as 5xx — UptimeRobot fires on
    # those independently.
    #
    # LLM/fallback don't count toward severity because the product still
    # works without them (snapshot + visual picker remain usable).
    if not db_ok:
        overall = "down"
        response.status_code = 503
    else:
        overall = "operational"

    def _comp_status(ok: bool) -> str:
        return "operational" if ok else "down"

    return {
        "service": "stealth-scraper",
        "version": "2.0.0",
        "status": overall,
        "scrape_engine": {
            "running": pool_ok,
            "proxy_region": pool.current_proxy_label(),
        },
        "db": {
            "ok": db_ok,
            "error": db_error,
        },
        "llm": {
            "provider": assist.provider_label(),
            "configured": llm_ok,
            "fallback_configured": fallback_ok,
            "chain": models["chain"] if models else [],
            "dead": models["dead"] if models else [],
            "primary": models["primary"] if models else None,
        },
        "components": [
            {"name": "API",             "status": "operational"},
            {"name": "Database",        "status": _comp_status(db_ok)},
            {"name": "Scrape engine",   "status": _comp_status(pool_ok) if pool_ok else "idle"},
            {"name": "Billing webhook", "status": "operational"},
            {"name": "Auth (Supabase)", "status": _comp_status(db_ok)},  # auth uses the same Supabase
            {"name": f"AI assist ({assist.provider_label()})", "status": ai_status},
            {"name": "LLM fallback",    "status": "operational" if fallback_ok else "not configured"},
        ],
    }


@app.get("/usage")
async def usage_status(user_id: str = Depends(get_current_user)) -> dict[str, Any]:
    """Per-user usage for the current calendar month. Used by the
    /settings/usage dashboard + by the SDKs to show clients their consumption."""
    plan = await db.get_user_plan(user_id)
    limit = plan_limit(plan)
    ym = current_year_month()
    used = await db.get_usage_count(user_id, ym)
    return {
        "plan": plan,
        "year_month": ym,
        "used": used,
        "limit": limit,
        "remaining": max(0, limit - used),
        "percent": round(100 * used / limit, 1) if limit else 0,
    }


# ── Authenticated routes ──────────────────────────────────────────────────

@app.post("/snapshot")
async def snapshot_endpoint(
    req: SnapshotRequest,
    request: Request,
    user_id: str = Depends(enforce_plan),
) -> dict[str, Any]:
    from app import refunds, idempotency
    from app.detect import detect_block

    # Idempotency-Key replay: agents auto-retry; without this, every retry
    # burns another credit. SDK auto-generates a UUID per call so this is
    # effectively always set when called from our SDKs.
    idem_key = request.headers.get("Idempotency-Key", "").strip()
    if idem_key:
        cached_body, _ = await idempotency.get_cached(user_id, "/snapshot", idem_key)
        if cached_body is not None:
            return cached_body

    async with per_user_slot(user_id), scrape_slot():
        actions_payload: list[BrowserAction] | None = None
        if req.actions:
            actions_payload = [a.model_dump() for a in req.actions]  # type: ignore[misc]
        snap = None
        scrape_error: Exception | None = None
        try:
            # Authenticated callers explicitly want to scrape — they own
            # the legal/ethical risk. override_robots=True bypasses robots.txt.
            # Per-host rate limiting still applies (safety.RateLimiter).
            snap = await take_snapshot(
                str(req.url),
                viewport_width=req.viewport_width,
                viewport_height=req.viewport_height,
                actions=actions_payload,
                override_robots=True,
            )
        except ValueError as e:
            # SSRF guard refused the URL — structured 422. NOT a billable
            # failure, so no refund (the request was invalid, not the page).
            raise _unsafe_url_http422(str(e)) from e
        except PermissionError as e:
            # robots.txt block. Refund — the user attempted in good faith.
            await refunds.auto_refund_if_failed(
                user_id=user_id, url=str(req.url), snap_title=None,
                element_count=0, blocked=False, detected_vendor=None, error=e,
            )
            raise HTTPException(
                status_code=422,
                detail={"kind": "robots_disallowed", "message": str(e)},
            ) from e
        except Exception as e:
            scrape_error = e
            await refunds.auto_refund_if_failed(
                user_id=user_id, url=str(req.url), snap_title=None,
                element_count=0, blocked=False, detected_vendor=None, error=e,
            )
            raise HTTPException(status_code=502, detail=f"snapshot failed: {e}") from e

        # Reliability SLA: refund if the scrape "succeeded" but the result
        # is empty / an anti-bot wall. detect_block is the same signature
        # library the bench uses to classify failures.
        block = detect_block(
            title=snap.title or "",
            html=" ".join((el.get("text") or "")[:200] for el in (snap.elements or [])[:40]),
            url=snap.url,
        )
        await refunds.auto_refund_if_failed(
            user_id=user_id, url=str(req.url),
            snap_title=snap.title, element_count=len(snap.elements or []),
            blocked=block.blocked, detected_vendor=block.vendor,
            error=None,
        )
    result = {
        "url": snap.url,
        "title": snap.title,
        "screenshot": snap.screenshot_base64,
        "viewport": snap.viewport,
        "page": snap.page,
        "elements": snap.elements,
        "element_count": len(snap.elements),
        # Full DOM at capture time. Frontend/picker passes this back to
        # /extract via the `expected_html` body field so saved templates
        # run against the SAME DOM the picker generated selectors from
        # — no second navigation, no snapshot-A vs snapshot-B drift on
        # geo-cached / lazy-hydrated / A/B-variant sites (the bug the
        # May 22 audit flagged on Amazon-class pages).
        "html": snap.html,
    }
    if idem_key:
        try:
            await idempotency.store(user_id, "/snapshot", idem_key, result, 200)
        except Exception:
            pass    # idempotency cache failure must NEVER fail the actual scrape
    return result


# Public no-signup snapshot — the landing-page magic preview. -----------------
#
# Visitors paste a URL on / and see a live JSON preview without creating an
# account. This eliminates the #1 conversion killer for cold traffic
# (signup-before-value). Rate-limited per IP so a single bad actor can't
# pin our snapshot pool.

# Simple in-memory IP rate limiter. Resets on container restart, which is
# fine — the Lightsail box reboots ~weekly via apt-unattended-upgrades
# and the cap is intentionally loose. Don't replace with Redis until
# traffic actually warrants it.
# {ip -> deque[timestamps]}  ; pruned on each access.
_PUBLIC_SNAPSHOT_HITS: dict[str, deque] = defaultdict(deque)
# Default raised from 3 → 10 ahead of the launch. HN / Product Hunt
# share NAT egress IPs (corporate networks, ISPs with CGNAT) so visitors
# trip each other's caps. 10/hour/IP gives a single shared-NAT pool
# enough headroom for legit demo traffic while still capping a single
# bad actor's ability to pin our snapshot pool.
PUBLIC_SNAPSHOT_LIMIT = int(os.getenv("PUBLIC_SNAPSHOT_LIMIT", "10"))     # max requests
PUBLIC_SNAPSHOT_WINDOW = int(os.getenv("PUBLIC_SNAPSHOT_WINDOW", "3600")) # in seconds (1h)
# The rate-limit dict + deques were touched without a lock. Under
# uvicorn's async event loop this is mostly safe (single thread), but
# the moment a synchronous prune/append happens mid-async-switch we
# can lose counts or double-count. Cheap fix: a single asyncio.Lock
# around the read-modify-write. Contention is bounded to the public
# endpoint, which is itself rate-limited.
_PUBLIC_SNAPSHOT_LOCK = asyncio.Lock()


def _client_ip(req: Request) -> str:
    """Best-effort client IP behind Caddy / Vercel / any proxy chain.

    Honors X-Forwarded-For (left-most non-private) and X-Real-IP. Falls
    back to direct socket address. Strings only — never panics."""
    fwd = req.headers.get("x-forwarded-for") or ""
    if fwd:
        # Left-most IP is the original client; the rest are proxy hops.
        candidate = fwd.split(",")[0].strip()
        if candidate:
            return candidate
    real = req.headers.get("x-real-ip")
    if real:
        return real.strip()
    if req.client and req.client.host:
        return req.client.host
    return "unknown"


async def _check_public_rate_limit(ip: str) -> tuple[bool, int, int]:
    """Sliding-window rate limit. Returns (allowed, used_count, reset_seconds).

    `used_count` is how many requests have landed in the current window
    (useful for the UI "1 of 10 free previews used this hour" microcopy).
    `reset_seconds` is when the OLDEST hit in the window expires.

    Lock-protected: prune + append must be atomic relative to other
    callers or two near-simultaneous requests can both see used < limit
    and both append, blowing through the cap by 1. Cheap fix; lock is
    held for microseconds."""
    async with _PUBLIC_SNAPSHOT_LOCK:
        now = time.time()
        window_start = now - PUBLIC_SNAPSHOT_WINDOW
        hits = _PUBLIC_SNAPSHOT_HITS[ip]

        # Prune expired hits (cheap, deque from the left).
        while hits and hits[0] < window_start:
            hits.popleft()

        used = len(hits)
        if used >= PUBLIC_SNAPSHOT_LIMIT:
            reset = int(hits[0] + PUBLIC_SNAPSHOT_WINDOW - now)
            return False, used, max(reset, 1)

        hits.append(now)
        return True, used + 1, PUBLIC_SNAPSHOT_WINDOW


class PublicSnapshotRequest(BaseModel):
    url: HttpUrl


async def _is_admin_request(request: Request) -> bool:
    """Best-effort: does this request carry a valid Bearer token belonging
    to an admin-allowlisted email? Used by the public endpoint to skip the
    IP rate limit for internal testers without making the endpoint require
    auth (anonymous visitors must still be able to hit it).

    Never raises — auth failure of any kind just returns False so the
    normal rate-limited path applies. Catches everything because this
    runs on the hot path of the landing page and a stray exception here
    would brick the demo.
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return False
    try:
        # Re-use the standard auth resolver. It accepts both API keys and
        # JWTs and returns a user_id — exactly what we need.
        from app.auth import get_current_user
        from app.usage import is_admin_email
        user_id = await get_current_user(auth_header)
        email = await db.get_user_email(user_id)
        return is_admin_email(email)
    except Exception:
        return False


@app.post("/public/snapshot-and-suggest")
async def public_snapshot_and_suggest(
    req: PublicSnapshotRequest,
    request: Request,
) -> dict[str, Any]:
    """Landing-page magic preview. No auth REQUIRED, but admin Bearer
    tokens bypass the IP rate limit.

    Snapshots the URL, auto-detects what kind of page it is, asks the LLM
    to suggest 3-5 useful fields, runs an extraction, returns the screenshot
    + the live values. Visitor never had to sign up.

    Rate-limited per IP. If the LLM isn't configured, gracefully falls back
    to returning the snapshot + element catalog so the visitor at least sees
    SOMETHING worked.
    """
    ip = _client_ip(request)
    is_admin = await _is_admin_request(request)
    if is_admin:
        # Admin testers — skip the IP rate limit so we can hammer the
        # modal repeatedly during dev/launch QA without locking ourselves
        # out. Still return rate_limit shape (with synthetic "unlimited"
        # values) so the frontend doesn't have to care.
        used, reset = 0, PUBLIC_SNAPSHOT_WINDOW
    else:
        allowed, used, reset = await _check_public_rate_limit(ip)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail=(
                    f"You've used {PUBLIC_SNAPSHOT_LIMIT} free previews this hour. "
                    f"Sign up free to keep going — unlimited previews + save your work."
                ),
                headers={
                    "X-RateLimit-Limit": str(PUBLIC_SNAPSHOT_LIMIT),
                    "X-RateLimit-Used": str(used),
                    "X-RateLimit-Reset": str(reset),
                },
            )

    # 1. Snapshot the page. Tighter viewport than logged-in /snapshot so
    # this stays fast even on lazy-loaded pages (we don't need the full
    # 24k px capture for a preview).
    #
    # override_robots=False — anonymous visitors don't get to bypass
    # robots.txt. Authenticated paid users get the bypass on /snapshot above.
    async with scrape_slot():
        try:
            snap = await take_snapshot(
                str(req.url),
                viewport_width=1280,
                viewport_height=900,
                override_robots=False,
            )
        except ValueError as e:
            # SSRF guard refused the URL.
            raise _unsafe_url_http422(str(e)) from e
        except PermissionError as e:
            # robots.txt disallowed — structured 422 so the landing modal
            # can render a helpful "this site asked us not to crawl" msg.
            raise HTTPException(
                status_code=422,
                detail={
                    "kind": "robots_disallowed",
                    "message": str(e),
                    "suggestion": "This site's robots.txt disallows crawling. "
                                  "Try a public docs page or a marketplace listing.",
                },
            ) from e
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"snapshot failed: {e}") from e

    # 1b. Anti-bot wall detection. If the page is a Cloudflare/PerimeterX/
    # DataDome/Akamai challenge we caught instead of the real content,
    # extraction will produce garbage. Surface that to the visitor as a
    # structured error so they understand why ("Cloudflare blocked this,
    # try residential proxies") rather than seeing 0 fields and assuming
    # we're broken. See app/detect.py for the signature library.
    from app.detect import detect_block as _detect_block
    # Block-detect now sees the real HTML + cookie jar captured during
    # the snapshot. The previous "join 40 element texts" hack missed
    # every anti-bot signature that lives in <script> tags or as
    # persistent cookies (Cloudflare __cf_bm, DataDome _ddo,
    # PerimeterX pxhd) — sites that DID get blocked silently returned
    # challenge-JS content as if it were the target.
    block = _detect_block(
        title=snap.title or "",
        html=snap.html_excerpt or "",
        cookies=snap.cookies or {},
        url=snap.url,
    )
    if block.blocked:
        # Soft-block (Cloudflare interstitial, DataDome JS challenge) —
        # return a structured warning so the modal can show "Cloudflare
        # is blocking us, want to try a different URL?" instead of
        # silently returning a useless preview. Frontend treats
        # status_code 422 as a "soft block" and renders our message.
        raise HTTPException(
            status_code=422,
            detail={
                "kind": "anti_bot_block",
                "vendor": block.vendor,
                "title": block.title,
                "message": block.message,
                "suggestion": block.suggestion,
                "is_behavioral": block.is_behavioral,
            },
        )

    # 2. Auto-suggest a template if the LLM is configured. If not, we
    # still return the snapshot + a hint so the visitor can keep going
    # by signing up (where they get the visual picker).
    template: list[dict[str, Any]] = []
    page_type = "generic"
    if assist.is_configured():
        try:
            # Hard-cap to 3 fields for the magic preview. Tighter focus
            # converts better than a wall of values; the user signs up
            # to unlock the full picker schema beyond 3. The seeds in
            # assist.PAGE_TYPE_SEED_DESCRIPTIONS already ask for "EXACTLY
            # 3", so the LLM doesn't waste tokens producing extras we'd
            # truncate.
            template, page_type = await assist.auto_suggest_template(
                elements=snap.elements,
                url=snap.url,
                title=snap.title,
                max_fields=3,
                # Page structured data → deterministic-first pipeline.
                # When a page ships JSON-LD / OG / microdata, this layer
                # extracts canonical fields with confidence 1.0 and the
                # LLM gets skipped entirely. Falls through gracefully
                # when structured signals are absent.
                structured_data=getattr(snap, "structured_data", None),
            )
        except assist.LLMError as e:
            # Soft-fail: the snapshot worked, only the AI suggest part failed.
            # Caller still gets the screenshot + can sign up to use the
            # picker manually. Log so we notice if it keeps happening.
            log.warning(
                "public_snapshot.llm_suggest_failed",
                extra={"kind": e.kind, "error": str(e)},
            )
        except Exception as e:  # defensive — never break the preview
            log.warning(
                "public_snapshot.llm_suggest_unexpected",
                extra={"error": repr(e)},
            )

    # 3. If we got a template, run extraction so the visitor sees live
    # values, not just selectors. Cap at 5 fields for the preview.
    #
    # /extract now returns the FieldResult envelope (2026-05-22 structural
    # fix — every field carries {value, source, confidence, selector_used,
    # reason_if_null} so silent nulls are structurally impossible). The
    # frontend preview UI still expects bare values keyed by label, so we
    # expose BOTH shapes for the transition:
    #
    #   sample_values    — legacy bare-value dict (what the preview UI
    #                      reads today; flatten .value from envelopes)
    #   sample_envelope  — full FieldResult per field — new consumers
    #                      get confidence + source + reason_if_null
    #
    # When the landing-preview UI is updated to display confidence /
    # reasons, it switches to `sample_envelope` and we drop the legacy.
    sample_values: dict[str, Any] = {}
    sample_envelope: dict[str, Any] = {}
    if template and snap.html:
        # Run extraction against the SAME snapshot's HTML — no second
        # navigation, no risk of A/B / geo-cache / lazy-hydration drift
        # between schema-gen and value-extract.
        try:
            from app.extract import extract_from_html
            preview_template = template[:3]
            res = extract_from_html(snap.url, snap.html, preview_template)
            envelope_fields = res.get("fields", {}) if isinstance(res, dict) else {}
            if isinstance(envelope_fields, dict):
                sample_envelope = envelope_fields
                sample_values = {
                    label: (f.get("value") if isinstance(f, dict) else f)
                    for label, f in envelope_fields.items()
                }
        except Exception as e:
            log.warning("public_snapshot.preview_extract_failed", extra={"error": repr(e)})

    # Visible-text excerpt — substantive element text from across the
    # page, capped at 8KB total. Sorts elements by text length DESC so
    # the excerpt biases toward headlines/descriptions/body, not nav
    # chrome (the first 50 elements on big sites are usually nav links
    # — "login", "new", "threads", etc. — which don't help grounding).
    #
    # Two uses:
    #   1. Bench/CI: bench/extract_correctness.py uses this as ground-
    #      truth haystack for "did the extracted value actually appear
    #      on the page?" without re-snapshotting or running an LLM.
    #   2. AI agents can use it as fallback context when structured
    #      fields come back null. Better than "I have nothing."
    # Total payload growth: ~8KB, dwarfed by the ~200KB base64 PNG.
    _texts = [
        (el.get("text", "") or "").strip()
        for el in (snap.elements or [])
        if (el.get("text", "") or "").strip()
    ]
    _texts.sort(key=len, reverse=True)
    _excerpt_parts: list[str] = []
    _excerpt_total = 0
    for t in _texts:
        if _excerpt_total + len(t) + 1 > 8000:
            continue
        _excerpt_parts.append(t)
        _excerpt_total += len(t) + 1
    visible_text_excerpt = " ".join(_excerpt_parts)

    return {
        "url": snap.url,
        "title": snap.title,
        "screenshot": snap.screenshot_base64,
        "page_type": page_type,
        "template": template[:3],
        "sample_values": sample_values,         # legacy — bare values, kept for UI compat
        "sample_envelope": sample_envelope,     # canonical — FieldResult per field
        "visible_text_excerpt": visible_text_excerpt,
        "element_count": len(snap.elements),
        "rate_limit": {
            "limit": PUBLIC_SNAPSHOT_LIMIT,
            "used": used,
            "remaining": PUBLIC_SNAPSHOT_LIMIT - used,
            "reset_seconds": reset,
        },
    }


@app.post("/extract")
async def extract_endpoint(
    req: ExtractRequest,
    user_id: str = Depends(enforce_plan),
) -> dict[str, Any]:
    template = [f.model_dump() for f in req.template]
    actions_payload: list[BrowserAction] | None = None
    if req.actions:
        actions_payload = [a.model_dump() for a in req.actions]  # type: ignore[misc]

    # Fast path: caller already has the DOM (picker just snapshotted +
    # picked elements against it). Skip navigation entirely. Eliminates
    # snapshot-A vs snapshot-B drift — selectors generated against a
    # specific DOM run against the EXACT same DOM. No actions / no
    # pagination support in this mode (the HTML is static).
    if req.expected_html and not actions_payload and req.max_pages == 1:
        try:
            from app.extract import extract_from_html
            return extract_from_html(
                str(req.url),
                req.expected_html,
                template,
                output_format=req.output_format,  # type: ignore[arg-type]
            )
        except ValueError as e:
            raise _unsafe_url_http422(str(e)) from e
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"extract failed: {e}") from e

    # Pagination > 1 counts as N scrapes; charge the extra now.
    if req.max_pages > 1:
        await enforce_plan_bulk(user_id, n=req.max_pages - 1)
    async with per_user_slot(user_id), scrape_slot():
        try:
            return await extract_fields(
                str(req.url),
                template,
                output_format=req.output_format,  # type: ignore[arg-type]
                pagination_selector=req.pagination_selector,
                max_pages=req.max_pages,
                actions=actions_payload,
            )
        except ValueError as e:
            raise _unsafe_url_http422(str(e)) from e
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"extract failed: {e}") from e


@app.post("/extract/batch")
async def extract_batch(
    req: BatchExtractRequest,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    """Run one template across many URLs. Serialized on the server side
    (nodriver lock + shared browser) — parallel clients would just queue
    against each other. Per-URL errors are captured and returned alongside
    successes so one bad URL doesn't kill the whole run.

    Plan gating: a batch of N URLs counts as N scrapes against the user's
    monthly limit. Checked + incremented up front before any URL runs."""
    await enforce_plan_bulk(user_id, n=len(req.urls))

    template = [f.model_dump() for f in req.template]
    actions_payload: list[BrowserAction] | None = None
    if req.actions:
        actions_payload = [a.model_dump() for a in req.actions]  # type: ignore[misc]
    results = []
    for url in req.urls:
        try:
            data = await extract_fields(
                str(url), template,
                output_format=req.output_format,  # type: ignore[arg-type]
                actions=actions_payload,
            )
            results.append({"url": str(url), "data": data})
        except Exception as e:
            results.append({
                "url": str(url),
                "data": {
                    "url": str(url),
                    "fields": {},
                    "errors": {"_error": str(e)},
                    "title": "",
                },
            })
    return {"count": len(results), "results": results}


# AI-assisted schema generation -----------------------------------------------

@app.post("/assist/schema")
async def assist_schema(
    req: AssistSchemaRequest,
    user_id: str = Depends(enforce_plan),
) -> dict[str, Any]:
    """Snapshot the URL, hand the element catalog + user's description to
    the configured LLM, return a generated template ready to use with /extract.

    Counts as 1 scrape (for the snapshot) PLUS a flat per-call assist cost
    we absorb. Free tier: 10 assist calls/day."""
    if not assist.is_configured():
        raise HTTPException(
            status_code=503,
            detail="AI schema generation not configured on this instance (LLM_API_KEY missing).",
        )
    async with per_user_slot(user_id), scrape_slot():
        try:
            snap = await take_snapshot(
                str(req.url),
                viewport_width=req.viewport_width,
                viewport_height=req.viewport_height,
                override_robots=True,  # authenticated paid user → they own the risk
            )
        except ValueError as e:
            raise _unsafe_url_http422(str(e)) from e
        except PermissionError as e:
            raise HTTPException(
                status_code=422,
                detail={"kind": "robots_disallowed", "message": str(e)},
            ) from e
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"snapshot failed: {e}") from e

    try:
        template = await assist.generate_template(
            elements=snap.elements,
            description=req.description,
            url=snap.url,
            title=snap.title,
        )
    except assist.LLMError as e:
        # LLMError carries a curated status + clean message. Pass through
        # the kind in headers so the frontend can route to specific UX
        # (e.g. "all models dead" → suggest visual picker).
        raise HTTPException(
            status_code=e.status,
            detail=str(e),
            headers={"X-LLM-Error-Kind": e.kind},
        ) from e
    except Exception as e:
        # Defensive: anything we didn't catch (programmer error) still
        # surfaces as 502 with the exception string, but without leaking
        # provider-specific JSON.
        raise HTTPException(status_code=502, detail=f"schema generation failed: {e}") from e

    # Run extraction against the SAME snapshot's HTML — schema and values
    # come from one DOM. Pre-this-fix the AI-extract UI re-navigated to
    # the URL on /extract, which on Amazon (and any site with geo-cache,
    # lazy hydration, or A/B variants) produced a different page than
    # the one used to generate the schema → every selector returned null
    # and the user saw "everything fails." `extract_from_html` is pure:
    # no second snapshot, no second nodriver tab. Same DOM, same result.
    sample_envelope: dict[str, Any] = {}
    sample_values: dict[str, Any] = {}
    if template and snap.html:
        try:
            from app.extract import extract_from_html
            ext = extract_from_html(snap.url, snap.html, template)
            envelope_fields = ext.get("fields", {}) if isinstance(ext, dict) else {}
            if isinstance(envelope_fields, dict):
                sample_envelope = envelope_fields
                sample_values = {
                    label: (f.get("value") if isinstance(f, dict) else f)
                    for label, f in envelope_fields.items()
                }
        except Exception as e:
            # If inline extraction throws, the user still gets the schema
            # — they can run /extract manually. Logging only.
            log.warning("assist_schema.inline_extract_failed", extra={"error": repr(e)})

    return {
        "url": snap.url,
        "title": snap.title,
        "description": req.description,
        "template": template,
        "element_count": len(snap.elements),
        # Schema + initial values from the SAME snapshot — no re-navigation
        # drift. Frontend can render these immediately under the schema
        # block. Subsequent /extract runs are still supported (and now
        # tell users when their values changed vs the initial snapshot).
        "sample_envelope": sample_envelope,
        "sample_values": sample_values,
    }


# Cost preview — AI-agent differentiator -------------------------------------

class EstimateRequest(BaseModel):
    url: HttpUrl
    has_template: bool = False
    uses_assist: bool = False


@app.post("/estimate")
async def estimate_endpoint(
    req: EstimateRequest,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    """Pre-flight cost preview. Pure CPU, no I/O against the target URL.

    AI agents call this before committing to a scrape so their runtime
    can budget-cap. No competitor (Firecrawl/Apify/ZenRows/Bright Data)
    exposes this — it's one of the SDK research bets.
    """
    from app import estimate as estimate_mod
    return await estimate_mod.estimate_scrape(
        user_id,
        str(req.url),
        has_template=req.has_template,
        uses_assist=req.uses_assist,
    )


# Reliability SLA — refund history --------------------------------------------

@app.get("/me/refunds")
async def my_refunds(
    user_id: str = Depends(get_current_user),
    limit: int = 100,
) -> dict[str, Any]:
    """User-visible refund history. Powers /settings/refunds.

    Each row: when, why, which URL. The 'reason' field is a human-readable
    string the SLA UI can render verbatim ("Cloudflare blocked us — credit
    refunded automatically")."""
    rows = await db.list_user_refunds(user_id, limit=max(1, min(limit, 500)))
    return {"refunds": rows, "count": len(rows)}


# Reviews ---------------------------------------------------------------------

class ReviewCreate(BaseModel):
    target_kind: str = Field(..., pattern="^(product|template)$")
    target_id: str = Field(..., min_length=1, max_length=120)
    rating: int = Field(..., ge=1, le=5)
    body: str = Field("", max_length=2000)
    author_name: str = Field("", max_length=60)


@app.post("/reviews", status_code=201)
async def create_or_update_review(
    req: ReviewCreate,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    """Submit a review. Same user submitting again UPSERTS — one review per
    (user, target). Auto-flags `verified=True` if the user has scraped > 5x
    this month (proves they actually use the product)."""
    from app import reviews
    try:
        row = await reviews.submit_review(
            user_id=user_id,
            target_kind=req.target_kind,
            target_id=req.target_id,
            rating=req.rating,
            body=req.body,
            author_name=req.author_name,
        )
        return {"review": row}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@app.get("/reviews")
async def list_reviews_endpoint(
    target_kind: str,
    target_id: str,
    limit: int = 20,
) -> dict[str, Any]:
    """Public read — no auth. Powers landing/pricing/template review blocks."""
    if target_kind not in ("product", "template"):
        raise HTTPException(status_code=422, detail="target_kind must be product|template")
    from app import reviews
    rows = await reviews.list_for_target(target_kind, target_id, limit=max(1, min(limit, 100)))
    return {"reviews": rows, "count": len(rows)}


@app.get("/reviews/summary")
async def review_summary_endpoint(
    target_kind: str,
    target_id: str,
) -> dict[str, Any]:
    """Public — aggregate stats for star display."""
    if target_kind not in ("product", "template"):
        raise HTTPException(status_code=422, detail="target_kind must be product|template")
    from app import reviews
    return await reviews.summary_for_target(target_kind, target_id)


@app.delete("/reviews/{review_id}", status_code=204)
async def delete_review_endpoint(
    review_id: int,
    user_id: str = Depends(get_current_user),
) -> Response:
    from app import reviews
    ok = await reviews.delete_own_review(review_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="review not found or not yours")
    return Response(status_code=204)


# Templates CRUD ---------------------------------------------------------------

@app.get("/templates")
async def templates_list(
    user_id: str = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return await db.list_templates(user_id)


@app.post("/templates", status_code=201)
async def templates_create(
    body: TemplateCreate,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    return await db.create_template(
        user_id=user_id,
        name=body.name,
        source_url=body.source_url,
        fields=[f.model_dump() for f in body.fields],
    )


@app.get("/templates/{template_id}")
async def templates_get(
    template_id: int,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    tpl = await db.get_template(template_id, user_id)
    if tpl is None:
        raise HTTPException(status_code=404, detail="template not found")
    return tpl


@app.put("/templates/{template_id}")
async def templates_update(
    template_id: int,
    body: TemplateUpdate,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    updated = await db.update_template(
        template_id,
        user_id=user_id,
        name=body.name,
        source_url=body.source_url,
        fields=[f.model_dump() for f in body.fields] if body.fields is not None else None,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="template not found")
    return updated


@app.delete("/templates/{template_id}", status_code=204)
async def templates_delete(
    template_id: int,
    user_id: str = Depends(get_current_user),
) -> None:
    ok = await db.delete_template(template_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="template not found")


# Marketplace + publish/fork ---------------------------------------------------

class TemplatePublishRequest(BaseModel):
    is_public: bool
    description: str = Field(default="", max_length=500)


@app.get("/marketplace")
async def marketplace_list() -> list[dict[str, Any]]:
    """Public marketplace — no auth required to browse. Lists templates
    marked as is_public by their owners, ranked by fork popularity."""
    return await db.list_public_templates(limit=100)


@app.put("/templates/{template_id}/publish")
async def template_publish(
    template_id: int,
    body: TemplatePublishRequest,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    updated = await db.set_template_public(
        template_id, user_id, body.is_public, body.description
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="template not found")
    return updated


@app.post("/templates/{template_id}/fork", status_code=201)
async def template_fork(
    template_id: int,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    """Copy a public template into the calling user's account. Increments
    the original's fork_count (used to rank popularity in the marketplace)."""
    forked = await db.fork_public_template(template_id, user_id)
    if forked is None:
        raise HTTPException(status_code=404, detail="public template not found")
    return forked


# Scheduled jobs ---------------------------------------------------------------

# ── SSRF guard for outbound URLs (webhook targets) ────────────────────────
#
# Without this, a malicious user could register a scheduled job whose
# `webhook_url` points at:
#   * `http://169.254.169.254/latest/meta-data/`  — AWS / GCP IMDS,
#     leaking instance credentials to the user via webhook delivery body.
#   * `http://localhost:5432/` / `http://127.0.0.1:9000/` — internal
#     services on the same host (DB, Redis, internal admin UIs).
#   * `http://[::1]/`, `http://[fc00::1]/` — IPv6 loopback / ULA.
#   * `file://...`, `gopher://...`, etc. — non-HTTP schemes.
#
# We reject:
#   * Non-http(s) schemes
#   * Bare numeric hosts that resolve into RFC1918 / loopback / link-local
#     / multicast / reserved / IMDS ranges
#   * Hostnames that resolve to ANY private IP
#
# Identical to the helper the snapshot SSRF agent is adding — at merge
# time keep one copy. Kept local here (not imported from snapshot) so
# this commit is self-contained.

# Block AWS/GCP/Azure metadata endpoints by exact IP — covered by the
# link-local /16 (169.254.0.0) check below but called out explicitly for
# clarity.
_IMDS_HOSTS = frozenset({"169.254.169.254", "metadata.google.internal", "metadata.azure.com"})


def _is_safe_url(url: str) -> tuple[bool, str]:
    """Returns (safe, reason). Caller rejects when safe=False.

    Resolves the hostname (DNS lookup, ~ms) and checks every returned IP
    against private/loopback/link-local/reserved ranges. Synchronous
    socket.getaddrinfo is OK here — DNS is cheap (<10ms cached) and we
    only call this on user-supplied input at validation time + scheduler
    tick (max 1/min).
    """
    if not url:
        return False, "empty URL"
    try:
        p = urlparse(url)
    except Exception as e:
        return False, f"unparseable: {e}"

    scheme = (p.scheme or "").lower()
    if scheme not in ("http", "https"):
        return False, f"scheme {scheme!r} not allowed (http/https only)"

    host = (p.hostname or "").lower()
    if not host:
        return False, "no host"

    if host in _IMDS_HOSTS:
        return False, "metadata endpoint blocked"

    # Resolve to all IPs (handles round-robin DNS and dual-stack hosts).
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        return False, f"DNS lookup failed: {e}"

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr.split("%", 1)[0])  # strip zone id
        except ValueError:
            return False, f"invalid resolved IP: {addr}"
        # Cover EVERY non-routable / sensitive range:
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return False, f"host resolves to non-public IP {ip}"

    return True, "ok"


class ScheduledJobCreate(BaseModel):
    template_id: int
    name: str = Field(min_length=1, max_length=80)
    target_url: str
    schedule_cron: str = Field(min_length=1, max_length=80)
    # HttpUrl forces http(s) + valid URL structure at Pydantic layer.
    # The deeper SSRF check (DNS → private-IP rejection) runs server-side
    # at create time and again before each scheduled POST. Empty string
    # is allowed (no webhook configured) — only validate when set.
    webhook_url: HttpUrl | None = None


@app.get("/schedules")
async def schedules_list(user_id: str = Depends(get_current_user)) -> list[dict[str, Any]]:
    return await db.list_jobs(user_id)


@app.post("/schedules", status_code=201)
async def schedules_create(
    body: ScheduledJobCreate,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    # Verify the template belongs to the caller.
    tpl = await db.get_template(body.template_id, user_id)
    if tpl is None:
        raise HTTPException(status_code=404, detail="template not found")
    # SSRF guard: if a webhook URL is provided, reject anything pointing
    # at internal infrastructure BEFORE we persist the job. The scheduler
    # re-checks at delivery time too, in case DNS flips post-create.
    webhook_str = str(body.webhook_url) if body.webhook_url else ""
    if webhook_str:
        safe, reason = _is_safe_url(webhook_str)
        if not safe:
            raise HTTPException(
                status_code=422,
                detail={"kind": "webhook_unsafe", "message": reason},
            )
    return await db.create_job(
        user_id=user_id,
        template_id=body.template_id,
        name=body.name,
        target_url=body.target_url,
        schedule_cron=body.schedule_cron,
        webhook_url=webhook_str,
    )


@app.put("/schedules/{job_id}/toggle")
async def schedules_toggle(
    job_id: int,
    enabled: bool,
    user_id: str = Depends(get_current_user),
) -> dict[str, Any]:
    ok = await db.toggle_job(job_id, user_id, enabled)
    if not ok:
        raise HTTPException(status_code=404, detail="job not found")
    return {"id": job_id, "enabled": enabled}


@app.delete("/schedules/{job_id}", status_code=204)
async def schedules_delete(
    job_id: int,
    user_id: str = Depends(get_current_user),
) -> None:
    ok = await db.delete_job(job_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="job not found")


# API keys ---------------------------------------------------------------------
# Locked behind JWT auth only — you can't manage keys with another key.

@app.get("/api-keys")
async def api_keys_list(
    user_id: str = Depends(get_current_user_jwt_only),
) -> list[dict[str, Any]]:
    return await db.list_api_keys(user_id)


@app.post("/api-keys", status_code=201)
async def api_keys_create(
    body: ApiKeyCreate,
    user_id: str = Depends(get_current_user_jwt_only),
) -> dict[str, Any]:
    return await db.create_api_key(user_id=user_id, name=body.name)


@app.delete("/api-keys/{key_id}", status_code=204)
async def api_keys_revoke(
    key_id: int,
    user_id: str = Depends(get_current_user_jwt_only),
) -> None:
    ok = await db.revoke_api_key(key_id, user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="API key not found or already revoked")
