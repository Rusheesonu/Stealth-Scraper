"""Stealth-Scraper v2 API.

Endpoints:
    POST /snapshot           — URL → screenshot + element catalog
    POST /extract            — URL + template → structured data
    GET  /templates          — list saved templates
    POST /templates          — create template
    GET  /templates/{id}     — get one
    PUT  /templates/{id}     — update
    DEL  /templates/{id}     — delete
    GET  /health             — liveness + browser status
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl

from app import db
from app.browser import pool
from app.extract import extract as extract_fields
from app.snapshot import take_snapshot


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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    source_url: str
    fields: list[TemplateField]


class TemplateUpdate(BaseModel):
    name: str | None = None
    source_url: str | None = None
    fields: list[TemplateField] | None = None


# ── Routes ────────────────────────────────────────────────────────────────

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
        "browser": pool._browser is not None,  # noqa: SLF001 — private attr OK here
    }


@app.post("/snapshot")
async def snapshot_endpoint(req: SnapshotRequest) -> dict[str, Any]:
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
async def extract_endpoint(req: ExtractRequest) -> dict[str, Any]:
    template = [f.model_dump() for f in req.template]
    try:
        return await extract_fields(str(req.url), template)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"extract failed: {e}") from e


# Templates CRUD ---------------------------------------------------------------

@app.get("/templates")
async def templates_list() -> list[dict[str, Any]]:
    return await db.list_templates()


@app.post("/templates", status_code=201)
async def templates_create(body: TemplateCreate) -> dict[str, Any]:
    return await db.create_template(
        name=body.name,
        source_url=body.source_url,
        fields=[f.model_dump() for f in body.fields],
    )


@app.get("/templates/{template_id}")
async def templates_get(template_id: int) -> dict[str, Any]:
    tpl = await db.get_template(template_id)
    if tpl is None:
        raise HTTPException(status_code=404, detail="template not found")
    return tpl


@app.put("/templates/{template_id}")
async def templates_update(template_id: int, body: TemplateUpdate) -> dict[str, Any]:
    updated = await db.update_template(
        template_id,
        name=body.name,
        source_url=body.source_url,
        fields=[f.model_dump() for f in body.fields] if body.fields is not None else None,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="template not found")
    return updated


@app.delete("/templates/{template_id}", status_code=204)
async def templates_delete(template_id: int) -> None:
    ok = await db.delete_template(template_id)
    if not ok:
        raise HTTPException(status_code=404, detail="template not found")
