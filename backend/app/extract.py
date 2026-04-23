"""URL + template → structured data extractor (nodriver + lxml)."""

from __future__ import annotations

import asyncio
import re
from typing import Any, Literal, TypedDict

from lxml import html as lxml_html

from app.browser import pool, with_transient_retry


class Field(TypedDict, total=False):
    label: str
    selector: str
    xpath: str
    kind: Literal["text", "attr", "list", "html"]
    attr: str


async def extract(url: str, template: list[Field]) -> dict[str, Any]:
    """Run a template against a URL. Restart+retry once on transient
    nodriver flakes, same as /snapshot."""

    async def _once() -> dict[str, Any]:
        return await _extract_inner(url, template)

    return await with_transient_retry(_once, label="extract")


async def _extract_inner(url: str, template: list[Field]) -> dict[str, Any]:
    """Uses the shared stealth browser, then runs selectors against the
    rendered HTML via lxml — faster than round-tripping every selector
    through CDP."""
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

        # Two-phase pull:
        #   1. Try to treat list fields as "columns of the same grid". If
        #      we can find a shared ancestor selector, we iterate rows and
        #      extract each field within the row — missing cells become
        #      `null` so lists stay aligned when the user zips records.
        #   2. Anything not handled by phase 1 (scalars, list fields whose
        #      selectors don't share an ancestor) falls through to plain
        #      per-selector extraction.
        row_values, row_labels = _pull_lists_per_row(tree, template)
        for label in row_labels:
            result["fields"][label] = row_values.get(label)

        for field in template:
            label = field.get("label") or field.get("selector") or "field"
            if label in row_labels:
                continue
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


# ─────────────────────────────────────────────────────────────────────────
# Per-row extraction
# ─────────────────────────────────────────────────────────────────────────
#
# The pain this solves: a template like
#   titles   = "#search > .a-section > h2 > a"
#   prices   = "#search > .a-section > .a-price > .a-offscreen"
#   options  = "#search > .a-section > .a-row > .a-size-base"
# produces three independent lxml queries. If product 7 has no "Options:
# 2 sizes" line, `options` returns 15 items while the other two return
# 16 — and the zipped records view now shows product 7's options on row
# 8, product 8's on row 9, etc. A user-visible alignment bug.
#
# Fix: find the longest shared CSS prefix across list fields, treat that
# as the row ancestor, then scope each field's remaining selector
# fragment to each row. Missing match within a row becomes `null` so
# every list ends up the same length.


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
        # Skip shift-click union selectors — per-row logic doesn't handle
        # alternatives cleanly and independent extraction is good enough.
        if not sel or "," in sel:
            continue
        label = f.get("label") or f.get("selector") or "field"
        list_fields.append((label, f))

    if len(list_fields) < 2:
        return {}, set()

    parsed = [_split_selector(f[1]["selector"]) for f in list_fields]
    prefix = _longest_common_prefix(parsed)

    # A usable "row ancestor" must have at least one concrete step past
    # the document root AND leave each field with a non-empty suffix.
    if len(prefix) == 0:
        return {}, set()
    if any(len(prefix) >= len(parts) for parts in parsed):
        return {}, set()

    row_selector = " > ".join(prefix)
    try:
        rows = tree.cssselect(row_selector)
    except Exception:
        return {}, set()
    # Row-based extraction is only a win when the ancestor actually
    # repeats. A single-row result means we didn't find the right level
    # — let the fallback path handle it.
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


# Split `a > b.c > d:nth-of-type(2)` into its top-level steps. We do NOT
# split on descendant combinators or commas — both would require a full
# CSS parser, and our selectors are always generated with " > " joins.
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
