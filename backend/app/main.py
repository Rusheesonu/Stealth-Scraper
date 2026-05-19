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

from app import db
from app.auth import get_current_user
from app.browser import pool
from app.extract import extract as extract_fields
from app.snapshot import take_snapshot
from app.usage import enforce_plan, enforce_plan_bulk


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    # Don't eagerly start the browser — lazy-init on first request keeps
    # cold-boot fast and avoids OOM on small hosts.
    yield
    await pool.stop()


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

class SnapshotRequest(BaseModel):
    url: HttpUrl
    viewport_width: int = Field(default=1440, ge=320, le=3840)
    viewport_height: int = Field(default=900, ge=480, le=2160)


class TemplateField(BaseModel):
    label: str
    selector: str = ""
    xpath: str = ""
    kind: str = "text"  # "text" | "attr" | "list" | "html"
    attr: str = ""


class ExtractRequest(BaseModel):
    url: HttpUrl
    template: list[TemplateField]


class BatchExtractRequest(BaseModel):
    urls: list[HttpUrl] = Field(min_length=1, max_length=100)
    template: list[TemplateField]


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    source_url: str
    fields: list[TemplateField]


class TemplateUpdate(BaseModel):
    name: str | None = None
    source_url: str | None = None
    fields: list[TemplateField] | None = None


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
    }


# ── Authenticated routes ──────────────────────────────────────────────────

@app.post("/snapshot")
async def snapshot_endpoint(
    req: SnapshotRequest,
    user_id: str = Depends(enforce_plan),
) -> dict[str, Any]:
    try:
        snap = await take_snapshot(
            str(req.url),
            viewport_width=req.viewport_width,
            viewport_height=req.viewport_height,
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
    try:
        return await extract_fields(str(req.url), template)
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
    results = []
    for url in req.urls:
        try:
            data = await extract_fields(str(url), template)
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
