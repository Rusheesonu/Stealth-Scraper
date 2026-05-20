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


class Transform(TypedDict, total=False):
    """A single cleanup step applied to a field's extracted value.

    Safe by design — `op` must be one of the names in TRANSFORM_OPS below.
    No arbitrary code execution. Lets users say "strip the 'Tags: ' prefix"
    or "convert to int" without us having to ship a Python eval sandbox.
    """
    op: str
    # Op-specific params (string/number depending on op):
    value: str       # strip_prefix / strip_suffix / split sep / regex pattern
    repl: str        # regex_replace replacement
    pattern: str     # regex_replace + regex_extract
    sep: str         # split sep
    start: int       # slice start
    end: int         # slice end


class Field(TypedDict, total=False):
    label: str
    selector: str
    xpath: str
    kind: Literal["text", "attr", "list", "html", "markdown"]
    attr: str
    # Optional cleanup pipeline. Applied in order to each value
    # (scalar fields once, list fields per-item).
    transforms: list[Transform]


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
        raw = [_read(n, "text", attr) for n in nodes]
    else:
        raw = _read(nodes[0], kind, attr)

    transforms = field.get("transforms") or []
    if not transforms:
        return raw
    if kind == "list" and isinstance(raw, list):
        return [_apply_transforms(v, transforms) for v in raw]
    return _apply_transforms(raw, transforms)


# ── Transform pipeline ──────────────────────────────────────────────────────
#
# A curated set of safe string/number operations users can chain to clean
# extracted values. No arbitrary code execution. Each op is a small function
# that takes the current value (str | None | list | int) + the Transform
# spec and returns the next value. Unknown ops are no-ops (forward-compat).
#
# Why not Python eval? Even with restricted globals, an `eval()` exposed
# through the REST API is a security loaded gun. The DSL approach gives
# users 95% of the cleanup power (strip/split/regex/cast) with 0% of the
# RCE risk, and serializes cleanly into saved templates + the SDK clients.
#
# Adding a new op: write a handler, add it to TRANSFORM_OPS. Frontend
# /pick UI surfaces these by name with field-specific param inputs.


def _t_strip(v: Any, _: Transform) -> Any:
    return v.strip() if isinstance(v, str) else v


def _t_lower(v: Any, _: Transform) -> Any:
    return v.lower() if isinstance(v, str) else v


def _t_upper(v: Any, _: Transform) -> Any:
    return v.upper() if isinstance(v, str) else v


def _t_strip_prefix(v: Any, t: Transform) -> Any:
    if not isinstance(v, str):
        return v
    pre = t.get("value", "")
    return v[len(pre):] if pre and v.startswith(pre) else v


def _t_strip_suffix(v: Any, t: Transform) -> Any:
    if not isinstance(v, str):
        return v
    suf = t.get("value", "")
    return v[:-len(suf)] if suf and v.endswith(suf) else v


def _t_regex_replace(v: Any, t: Transform) -> Any:
    if not isinstance(v, str):
        return v
    pattern = t.get("pattern", "")
    if not pattern:
        return v
    try:
        return re.sub(pattern, t.get("repl", ""), v)
    except re.error:
        return v


def _t_regex_extract(v: Any, t: Transform) -> Any:
    """Pull the first regex match (group 1 if grouped, else group 0).
    Useful for plucking a number out of '$1,299.99 USD' → '1299.99'."""
    if not isinstance(v, str):
        return v
    pattern = t.get("pattern", "")
    if not pattern:
        return v
    try:
        m = re.search(pattern, v)
    except re.error:
        return v
    if not m:
        return None
    return m.group(1) if m.groups() else m.group(0)


def _t_split(v: Any, t: Transform) -> Any:
    if not isinstance(v, str):
        return v
    sep = t.get("sep") or t.get("value") or " "
    return [s for s in v.split(sep) if s != ""]


def _t_slice(v: Any, t: Transform) -> Any:
    """Slice a string OR a list. start/end default to None (full range)."""
    start = t.get("start")
    end = t.get("end")
    if isinstance(v, (str, list)):
        return v[start:end]
    return v


def _t_to_int(v: Any, _: Transform) -> Any:
    if v is None or v == "":
        return None
    try:
        # Strip common formatting noise ('$', ',', whitespace)
        if isinstance(v, str):
            s = re.sub(r"[^\d\-]", "", v)
            return int(s) if s and s != "-" else None
        return int(v)
    except (ValueError, TypeError):
        return None


def _t_to_float(v: Any, _: Transform) -> Any:
    if v is None or v == "":
        return None
    try:
        if isinstance(v, str):
            s = re.sub(r"[^\d\.\-]", "", v)
            return float(s) if s and s not in ("-", ".") else None
        return float(v)
    except (ValueError, TypeError):
        return None


def _t_collapse_whitespace(v: Any, _: Transform) -> Any:
    """Replace any run of whitespace (incl. newlines) with a single space."""
    if not isinstance(v, str):
        return v
    return re.sub(r"\s+", " ", v).strip()


TRANSFORM_OPS = {
    "strip":              _t_strip,
    "lower":              _t_lower,
    "upper":              _t_upper,
    "strip_prefix":       _t_strip_prefix,
    "strip_suffix":       _t_strip_suffix,
    "regex_replace":      _t_regex_replace,
    "regex_extract":      _t_regex_extract,
    "split":              _t_split,
    "slice":              _t_slice,
    "to_int":             _t_to_int,
    "to_float":           _t_to_float,
    "collapse_whitespace": _t_collapse_whitespace,
}


def _apply_transforms(value: Any, transforms: list[Transform]) -> Any:
    """Run a value through the user's transform pipeline. Unknown ops
    are no-ops so old saved templates don't break when we remove an op."""
    for t in transforms:
        op = t.get("op", "")
        handler = TRANSFORM_OPS.get(op)
        if handler is None:
            continue
        try:
            value = handler(value, t)
        except Exception:
            # A bad regex shouldn't kill the whole extraction — keep going
            # with the pre-transform value.
            pass
    return value


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
