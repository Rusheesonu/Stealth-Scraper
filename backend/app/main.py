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

from dotenv import load_dotenv

load_dotenv()  # app.auth needs SUPABASE_URL at import time.

from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl

from app import assist, db, scheduler as job_scheduler
from app.actions import BrowserAction
from app.auth import get_current_user, get_current_user_jwt_only
from app.browser import pool
from app.extract import extract as extract_fields
from app.snapshot import take_snapshot
from app.usage import enforce_plan, enforce_plan_bulk, plan_limit, current_year_month


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


app = FastAPI(
    title="Stealth-Scraper v2",
    description="Visual point-and-click web scraper. No XPath required.",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS — in production the Next.js frontend proxies server-to-server
# via rewrites, so the browser never sees the backend origin and CORS
# doesn't apply. We still allow all origins here so anyone can hit the
# API directly (curl, Postman, or embedding from other frontends).
# Auth happens via the Bearer header, not cookies.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Billing webhook router — signature-verified, NOT auth-gated (LS sends, not users).
from app.billing import router as billing_router  # noqa: E402

app.include_router(billing_router)


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


class TemplateField(BaseModel):
    label: str
    selector: str = ""
    xpath: str = ""
    kind: str = "text"  # "text" | "attr" | "list" | "html" | "markdown"
    attr: str = ""


class ExtractRequest(BaseModel):
    url: HttpUrl
    template: list[TemplateField]
    output_format: str = "fields"      # "fields" | "markdown" | "html"
    pagination_selector: str | None = None
    max_pages: int = Field(default=1, ge=1, le=20)
    actions: list[ActionStep] | None = None


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
async def status_endpoint() -> dict[str, Any]:
    """Public status data — consumed by the /status page on the frontend.
    No auth required. Don't expose any per-user data here."""
    return {
        "service": "stealth-scraper",
        "version": "2.0.0",
        "status": "operational",
        "scrape_engine": {
            "running": pool.running,
            "proxy_region": pool.current_proxy_label(),
        },
        "components": [
            {"name": "API",             "status": "operational"},
            {"name": "Scrape engine",   "status": "operational" if pool.running else "idle"},
            {"name": "Billing webhook", "status": "operational"},
            {"name": "Auth (Supabase)", "status": "operational"},
            {"name": f"AI assist ({assist.provider_label()})", "status": "operational" if assist.is_configured() else "not configured"},
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
    user_id: str = Depends(enforce_plan),
) -> dict[str, Any]:
    try:
        actions_payload: list[BrowserAction] | None = None
        if req.actions:
            actions_payload = [a.model_dump() for a in req.actions]  # type: ignore[misc]
        snap = await take_snapshot(
            str(req.url),
            viewport_width=req.viewport_width,
            viewport_height=req.viewport_height,
            actions=actions_payload,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"snapshot failed: {e}") from e
    return {
        "url": snap.url,
        "title": snap.title,
        "screenshot": snap.screenshot_base64,
        "viewport": snap.viewport,
        "page": snap.page,
        "elements": snap.elements,
        "element_count": len(snap.elements),
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
    # Pagination > 1 counts as N scrapes; charge the extra now.
    if req.max_pages > 1:
        await enforce_plan_bulk(user_id, n=req.max_pages - 1)
    try:
        return await extract_fields(
            str(req.url),
            template,
            output_format=req.output_format,  # type: ignore[arg-type]
            pagination_selector=req.pagination_selector,
            max_pages=req.max_pages,
            actions=actions_payload,
        )
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
    Claude, return a generated template ready to use with /extract.

    Counts as 1 scrape (for the snapshot) PLUS a flat per-call assist cost
    we absorb. Free tier: 10 assist calls/day."""
    if not assist.is_configured():
        raise HTTPException(
            status_code=503,
            detail="AI schema generation not configured on this instance (ANTHROPIC_API_KEY missing).",
        )
    try:
        snap = await take_snapshot(
            str(req.url),
            viewport_width=req.viewport_width,
            viewport_height=req.viewport_height,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"snapshot failed: {e}") from e

    try:
        template = await assist.generate_template(
            elements=snap.elements,
            description=req.description,
            url=snap.url,
            title=snap.title,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"schema generation failed: {e}") from e

    return {
        "url": snap.url,
        "title": snap.title,
        "description": req.description,
        "template": template,
        "element_count": len(snap.elements),
    }


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

class ScheduledJobCreate(BaseModel):
    template_id: int
    name: str = Field(min_length=1, max_length=80)
    target_url: str
    schedule_cron: str = Field(min_length=1, max_length=80)
    webhook_url: str = Field(default="", max_length=500)


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
    return await db.create_job(
        user_id=user_id,
        template_id=body.template_id,
        name=body.name,
        target_url=body.target_url,
        schedule_cron=body.schedule_cron,
        webhook_url=body.webhook_url,
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
