"""URL + template → structured data extractor.

A `template` is a list of fields the user picked in the UI:

    [
      {"label": "title", "selector": "h1.product-name", "kind": "text"},
      {"label": "price", "selector": ".price", "kind": "text"},
      {"label": "image", "selector": "img.hero", "kind": "attr", "attr": "src"},
    ]

We run the URL through Playwright (so JS-heavy pages work), then for each
field pull the first match's text / attribute. `kind: "list"` pulls every
match into an array — useful for catalog pages.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal, TypedDict

from playwright.async_api import TimeoutError as PWTimeoutError

from app.browser import pool


class Field(TypedDict, total=False):
    label: str
    selector: str  # CSS selector
    xpath: str  # optional — used as fallback when CSS misses
    kind: Literal["text", "attr", "list", "html"]
    attr: str


async def extract(url: str, template: list[Field]) -> dict[str, Any]:
    ctx = await pool.context()
    page = await ctx.new_page()
    result: dict[str, Any] = {"url": url, "fields": {}, "errors": {}}
    try:
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=25_000)
        except PWTimeoutError:
            pass
        try:
            await page.wait_for_load_state("networkidle", timeout=4_000)
        except PWTimeoutError:
            pass
        await asyncio.sleep(0.3)

        for field in template:
            label = field.get("label") or field.get("selector") or "field"
            kind = field.get("kind", "text")
            try:
                value = await _pull_field(page, field)
                result["fields"][label] = value
            except Exception as e:
                result["errors"][label] = str(e)
                result["fields"][label] = None

        result["title"] = await page.title()
        return result
    finally:
        await page.close()
        await ctx.close()


async def _pull_field(page, field: Field) -> Any:
    selector = field.get("selector", "").strip()
    xpath = field.get("xpath", "").strip()
    kind = field.get("kind", "text")
    attr = field.get("attr", "")

    async def _query_all():
        if selector:
            handles = await page.query_selector_all(selector)
            if handles:
                return handles
        if xpath:
            return await page.query_selector_all(f"xpath={xpath}")
        return []

    handles = await _query_all()
    if not handles:
        return [] if kind == "list" else None

    if kind == "list":
        out = []
        for h in handles:
            out.append(await _read(h, "text", attr))
        return out

    return await _read(handles[0], kind, attr)


async def _read(handle, kind: str, attr: str) -> Any:
    if kind == "attr" and attr:
        return await handle.get_attribute(attr)
    if kind == "html":
        return await handle.inner_html()
    # Default / "text"
    text = await handle.inner_text()
    return (text or "").strip()
