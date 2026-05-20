"""URL + template → structured data extractor (nodriver + lxml).

Supports three modes:
  * fields    (default) — per-template-field extraction, returns dict
  * markdown  — full page → markdown via markdownify (for RAG ingestion)
  * html      — full page HTML, no processing

Plus per-field kinds:
  text | attr | list | html | markdown
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Literal, TypedDict

from lxml import html as lxml_html

from app.actions import run_actions, BrowserAction
from app.browser import pool, with_transient_retry


class Field(TypedDict, total=False):
    label: str
    selector: str
    xpath: str
    kind: Literal["text", "attr", "list", "html", "markdown"]
    attr: str


async def extract(
    url: str,
    template: list[Field],
    *,
    output_format: Literal["fields", "markdown", "html"] = "fields",
    pagination_selector: str | None = None,
    max_pages: int = 1,
    actions: list[BrowserAction] | None = None,
) -> dict[str, Any]:
    """Run a template against a URL. Restart+retry once on transient
    nodriver flakes, same as /snapshot.

    Pagination (max_pages > 1 + pagination_selector): after extracting page N,
    we click the selector, wait for navigation/load, and extract again. List
    fields concatenate across pages; scalar fields keep page 1's value.

    Actions: optional list of click/scroll/fill/wait steps that run BEFORE
    extraction. Lets you handle login walls, cookie banners, infinite scroll.
    """

    async def _once() -> dict[str, Any]:
        return await _extract_inner(
            url, template,
            output_format=output_format,
            pagination_selector=pagination_selector,
            max_pages=max_pages,
            actions=actions,
        )

    return await with_transient_retry(_once, label="extract")


async def _extract_inner(
    url: str,
    template: list[Field],
    *,
    output_format: Literal["fields", "markdown", "html"],
    pagination_selector: str | None,
    max_pages: int,
    actions: list[BrowserAction] | None,
) -> dict[str, Any]:
    """Uses the shared stealth browser, then runs selectors against the
    rendered HTML via lxml — faster than round-tripping every selector
    through CDP."""
    tab = await pool.open_tab("about:blank")
    result: dict[str, Any] = {"url": url, "fields": {}, "errors": {}, "title": ""}
    try:
        await tab.get(url)
        await _wait_ready(tab, timeout=8.0)
        await asyncio.sleep(0.5)

        # Run pre-extraction actions (click banners, fill forms, etc.)
        if actions:
            try:
                await run_actions(tab, actions)
            except Exception as e:
                result["errors"]["_actions"] = str(e)

        try:
            result["title"] = await tab.evaluate("document.title")
        except Exception:
            pass

        # Special output modes return early, no per-field processing.
        if output_format == "html":
            result["html"] = await tab.get_content()
            return result

        if output_format == "markdown":
            html_content = await tab.get_content()
            result["markdown"] = _html_to_markdown(html_content)
            return result

        # Standard mode: per-field extraction over rendered HTML.
        content = await tab.get_content()
        if not content:
            raise RuntimeError("Empty page content — site blocked or navigation failed")

        all_pages_html = [content]

        # Pagination loop — click next, wait, capture HTML, repeat.
        if pagination_selector and max_pages > 1:
            for _ in range(max_pages - 1):
                try:
                    clicked = await tab.evaluate(
                        f"(() => {{ const el = document.querySelector({_js_str(pagination_selector)}); "
                        f"if (!el) return false; el.click(); return true; }})()"
                    )
                    if isinstance(clicked, tuple):
                        clicked = clicked[0]
                    if not clicked:
                        break
                except Exception:
                    break
                await asyncio.sleep(1.0)
                await _wait_ready(tab, timeout=8.0)
                await asyncio.sleep(0.5)
                page_html = await tab.get_content()
                if page_html:
                    all_pages_html.append(page_html)

        # Merge: parse each page, run template, concat list fields, keep scalars from p1.
        merged_fields: dict[str, Any] = {}
        for i, page_html in enumerate(all_pages_html):
            tree = lxml_html.fromstring(page_html)
            row_values, row_labels = _pull_lists_per_row(tree, template)
            page_fields: dict[str, Any] = dict(row_values)
            for field in template:
                label = field.get("label") or field.get("selector") or "field"
                if label in row_labels:
                    continue
                try:
                    page_fields[label] = _pull(tree, field)
                except Exception as e:
                    if i == 0:
                        result["errors"][label] = str(e)
                    page_fields[label] = None

            if i == 0:
                merged_fields = page_fields
            else:
                # Concat list values; keep scalar values from page 1.
                for k, v in page_fields.items():
                    if isinstance(v, list) and isinstance(merged_fields.get(k), list):
                        merged_fields[k] = merged_fields[k] + v

        result["fields"] = merged_fields
        if len(all_pages_html) > 1:
            result["pages_fetched"] = len(all_pages_html)
        return result
    finally:
        try:
            await tab.close()
        except Exception:
            pass


def _js_str(s: str) -> str:
    """Safely embed a Python string as a JS string literal."""
    import json
    return json.dumps(s)


def _html_to_markdown(html_content: str) -> str:
    """Convert HTML to markdown for RAG ingestion. Imported lazily so the
    backend boots even if markdownify isn't installed (graceful degrade
    to a JS-stripped text fallback)."""
    if not html_content:
        return ""
    try:
        import markdownify
        return markdownify.markdownify(
            html_content,
            heading_style="ATX",  # # H1 instead of underlined
            strip=["script", "style", "noscript"],
        ).strip()
    except ImportError:
        # Fallback: strip tags via lxml.
        try:
            tree = lxml_html.fromstring(html_content)
            for tag in tree.xpath("//script | //style | //noscript"):
                tag.getparent().remove(tag)
            return (tree.text_content() or "").strip()
        except Exception:
            return html_content


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
    if kind == "markdown":
        try:
            html_str = lxml_html.tostring(node, encoding="unicode")
            return _html_to_markdown(html_str)
        except Exception:
            return None
    # text default
    try:
        if hasattr(node, "text_content"):
            return (node.text_content() or "").strip()
        return str(node).strip()
    except Exception:
        return None


async def _wait_ready(tab, timeout: float) -> None:
    """Poll document.readyState until 'complete' or timeout."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            state = await tab.evaluate("document.readyState")
            if isinstance(state, tuple):
                state = state[0]
            if state == "complete":
                return
        except Exception:
            pass
        await asyncio.sleep(0.15)


# ─────────────────────────────────────────────────────────────────────────
# Per-row extraction (unchanged from previous version)
# ─────────────────────────────────────────────────────────────────────────

def _pull_lists_per_row(
    tree, template: list[Field]
) -> tuple[dict[str, list[Any]], set[str]]:
    """Returns (values_by_label, labels_handled). Labels not in the set
    should fall back to per-field extraction."""
    list_fields: list[tuple[str, Field]] = []
    for f in template:
        if f.get("kind") != "list":
            continue
        sel = (f.get("selector") or "").strip()
        if not sel or "," in sel:
            continue
        label = f.get("label") or f.get("selector") or "field"
        list_fields.append((label, f))

    if len(list_fields) < 2:
        return {}, set()

    parsed = [_split_selector(f[1]["selector"]) for f in list_fields]
    prefix = _longest_common_prefix(parsed)

    if len(prefix) == 0:
        return {}, set()
    if any(len(prefix) >= len(parts) for parts in parsed):
        return {}, set()

    row_selector = " > ".join(prefix)
    try:
        rows = tree.cssselect(row_selector)
    except Exception:
        return {}, set()
    if len(rows) < 2:
        return {}, set()

    suffixes = [" > ".join(parts[len(prefix):]) for parts in parsed]

    values: dict[str, list[Any]] = {label: [] for label, _ in list_fields}
    for row in rows:
        for (label, field), suffix in zip(list_fields, suffixes):
            attr = field.get("attr", "")
            try:
                matches = row.cssselect(suffix) if suffix else [row]
            except Exception:
                matches = []
            values[label].append(_read(matches[0], "text", attr) if matches else None)

    return values, {label for label, _ in list_fields}


_STEP_SEP_RE = re.compile(r"\s*>\s*")


def _split_selector(css: str) -> list[str]:
    return [p for p in _STEP_SEP_RE.split(css.strip()) if p]


def _longest_common_prefix(parts_lists: list[list[str]]) -> list[str]:
    if not parts_lists:
        return []
    head = parts_lists[0]
    out: list[str] = []
    for i, step in enumerate(head):
        if all(i < len(p) and p[i] == step for p in parts_lists):
            out.append(step)
        else:
            break
    return out
