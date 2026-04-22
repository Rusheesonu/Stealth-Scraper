"""URL + template → structured data extractor (nodriver + lxml)."""

from __future__ import annotations

import asyncio
from typing import Any, Literal, TypedDict

from lxml import html as lxml_html

from app.browser import pool


class Field(TypedDict, total=False):
    label: str
    selector: str
    xpath: str
    kind: Literal["text", "attr", "list", "html"]
    attr: str


async def extract(url: str, template: list[Field]) -> dict[str, Any]:
    """Run a template against a URL. Uses the same stealth browser as
    /snapshot, then runs selectors against the rendered HTML via lxml
    (faster than round-tripping every selector through CDP)."""
    tab = await pool.open_tab("about:blank")
    result: dict[str, Any] = {"url": url, "fields": {}, "errors": {}, "title": ""}
    try:
        await tab.get(url)
        # Poll document.readyState — bounded, same as snapshot.py.
        deadline = asyncio.get_event_loop().time() + 8.0
        while asyncio.get_event_loop().time() < deadline:
            try:
                state = await tab.evaluate("document.readyState")
                if isinstance(state, tuple):
                    state = state[0]
                if state == "complete":
                    break
            except Exception:
                pass
            await asyncio.sleep(0.15)
        await asyncio.sleep(0.5)

        content = await tab.get_content()
        try:
            result["title"] = await tab.evaluate("document.title")
        except Exception:
            pass

        if not content:
            raise RuntimeError("Empty page content — site blocked or navigation failed")

        tree = lxml_html.fromstring(content)

        for field in template:
            label = field.get("label") or field.get("selector") or "field"
            try:
                result["fields"][label] = _pull(tree, field)
            except Exception as e:
                result["errors"][label] = str(e)
                result["fields"][label] = None

        return result
    finally:
        try:
            await tab.close()
        except Exception:
            pass


def _pull(tree, field: Field) -> Any:
    selector = (field.get("selector") or "").strip()
    xpath = (field.get("xpath") or "").strip()
    kind = field.get("kind", "text")
    attr = field.get("attr", "")

    nodes: list[Any] = []
    if selector:
        try:
            nodes = tree.cssselect(selector)
        except Exception:
            nodes = []
    if not nodes and xpath:
        try:
            nodes = tree.xpath(xpath)
        except Exception:
            nodes = []

    if not nodes:
        return [] if kind == "list" else None

    if kind == "list":
        return [_read(n, "text", attr) for n in nodes]
    return _read(nodes[0], kind, attr)


def _read(node, kind: str, attr: str) -> Any:
    if kind == "attr" and attr:
        try:
            return node.get(attr)
        except Exception:
            return None
    if kind == "html":
        try:
            return lxml_html.tostring(node, encoding="unicode")
        except Exception:
            return None
    # text default
    try:
        if hasattr(node, "text_content"):
            return (node.text_content() or "").strip()
        return str(node).strip()
    except Exception:
        return None
