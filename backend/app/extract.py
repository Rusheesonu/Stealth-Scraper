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
from app.snapshot import _is_safe_url


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


# Provenance of an extracted value. The point: the user can ALWAYS see
# why a field has the value it does — selector hit, LLM guess, heuristic
# fallback, or honest "we didn't find it."
FieldSource = Literal["selector", "xpath", "llm", "heuristic", "none"]


class FieldResult(TypedDict):
    """The confidence envelope for one extracted field.

    Every field returned by /extract carries this envelope so a
    `null` value is ALWAYS paired with a `reason_if_null` and a
    `confidence`. No more silent failures — if extraction misses,
    the response says so explicitly.

    Schema introduced 2026-05-22 per the pre-launch audit ("Update
    API, frontend display, all 4 SDKs, docs. This is the structural
    fix — do it right."). This is a BREAKING CHANGE — the prior
    response had `result["fields"][label] = <bare_value>`. The new
    shape is `result["fields"][label] = FieldResult`. See CHANGELOG
    and the SDK migration note.

    Fields:
      value          — extracted value (str | int | float | list | None)
      source         — provenance — "selector" / "xpath" / "llm" /
                       "heuristic" / "none"
      confidence     — 0.0–1.0 — 1.0 for a CSS selector that matched,
                       0.0 for a missing field, 0.5 for a heuristic
                       guess, varies for LLM
      selector_used  — the actual CSS / XPath that produced the
                       value (or attempted, if value is None). Null
                       for non-selector sources (e.g. LLM-only).
      reason_if_null — human-readable explanation when value is None.
                       Always set when value is None; null otherwise.
    """
    value: Any
    source: FieldSource
    confidence: float
    selector_used: str | None
    reason_if_null: str | None


def _envelope(
    value: Any,
    *,
    source: FieldSource,
    confidence: float,
    selector_used: str | None,
    reason_if_null: str | None = None,
) -> FieldResult:
    """Build a FieldResult, enforcing the rule that `value is None`
    requires a non-null `reason_if_null`. Catches the silent-null bug
    structurally — a null without a reason is a programming error,
    not a runtime state.
    """
    # Treat empty string + empty list as "no value" for the purposes of
    # the reason invariant — they're not OBJECTIVELY null, but for the
    # silent-failure narrative they're the same shape.
    is_empty = value is None or value == "" or value == []
    if is_empty and not reason_if_null:
        # Default reason when caller forgot — keeps the envelope
        # honest even when the call site is sloppy.
        reason_if_null = "extractor returned empty without specifying a reason"
    if not is_empty:
        # Non-null values clear any reason — caller may have set one
        # speculatively; this normalizes.
        reason_if_null = None
    return FieldResult(
        value=value,
        source=source,
        confidence=max(0.0, min(1.0, float(confidence))),
        selector_used=selector_used,
        reason_if_null=reason_if_null,
    )


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
    # SSRF gate — extract.py opens its own tab (doesn't go through
    # take_snapshot), so we re-check the URL here. Without this, /extract
    # would let a visitor hit AWS IMDS even though /snapshot blocks it.
    ok, reason = _is_safe_url(url)
    if not ok:
        raise ValueError(f"unsafe URL: {reason}")

    result: dict[str, Any] = {"url": url, "fields": {}, "errors": {}, "title": ""}
    async with pool.tab("about:blank") as tab:
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
        #
        # Every field is now a FieldResult envelope per the 2026-05-22
        # structural fix. The legacy bare-value `result["fields"]` shape
        # is gone — callers read `result["fields"][label]["value"]`.
        # Per-row list extractor still returns raw values; we wrap them
        # into envelopes here so the response is uniform.
        merged_fields: dict[str, FieldResult] = {}
        for i, page_html in enumerate(all_pages_html):
            tree = lxml_html.fromstring(page_html)
            row_values, row_labels = _pull_lists_per_row(tree, template)
            # Wrap row-extractor results in envelopes (source=selector,
            # confidence=1.0 if non-empty; honest null otherwise).
            page_fields: dict[str, FieldResult] = {}
            for label, value in row_values.items():
                # The row extractor produced a list of values aligned
                # across the template's list fields. Find the matching
                # field's selector for `selector_used`.
                matching_field = next(
                    (f for f in template if (f.get("label") or f.get("selector") or "field") == label),
                    None,
                )
                used = (matching_field or {}).get("selector") if matching_field else None
                if value:
                    page_fields[label] = _envelope(
                        value,
                        source="selector",
                        confidence=1.0,
                        selector_used=used,
                    )
                else:
                    page_fields[label] = _envelope(
                        [],
                        source="selector",
                        confidence=0.5,
                        selector_used=used,
                        reason_if_null="per-row extractor produced empty result",
                    )
            # Non-row-handled fields go through the single-field pull.
            for field in template:
                label = field.get("label") or field.get("selector") or "field"
                if label in row_labels:
                    continue
                try:
                    page_fields[label] = _pull(tree, field)
                except Exception as e:
                    if i == 0:
                        result["errors"][label] = str(e)
                    page_fields[label] = _envelope(
                        None,
                        source="none",
                        confidence=0.0,
                        selector_used=field.get("selector") or field.get("xpath") or None,
                        reason_if_null=f"extraction raised: {type(e).__name__}: {str(e)[:120]}",
                    )

            if i == 0:
                merged_fields = page_fields
            else:
                # Concat list values across pages; keep scalar values
                # from page 1. Both sides are FieldResult envelopes.
                for k, v in page_fields.items():
                    prev = merged_fields.get(k)
                    if not prev:
                        merged_fields[k] = v
                        continue
                    if isinstance(prev["value"], list) and isinstance(v["value"], list):
                        # Build a new envelope with concatenated lists +
                        # merged provenance (selector from p1; confidence
                        # max across pages).
                        merged_fields[k] = _envelope(
                            (prev["value"] or []) + (v["value"] or []),
                            source=prev["source"],
                            confidence=max(prev["confidence"], v["confidence"]),
                            selector_used=prev["selector_used"],
                        )

        # Post-extraction broadcast pass. _null_broadcast_columns only
        # runs inside _pull_lists_per_row, so flat per-field extraction
        # (when CSS-prefix + DOM-LCA both fail) can still ship broadcast
        # columns. This catches that gap: walk the FINAL merged_fields,
        # find list columns whose values are all identical AND another
        # list column has variety, null them. Same rule as the in-row
        # heuristic, applied one level up so it doesn't matter which
        # extraction path produced the list.
        merged_fields = _null_broadcast_in_page_fields(merged_fields)

        result["fields"] = merged_fields
        if len(all_pages_html) > 1:
            result["pages_fetched"] = len(all_pages_html)
        return result
    # `pool.tab()` context manager closes the tab and returns the
    # worker to the queue automatically — no explicit close needed.


def _null_broadcast_in_page_fields(
    fields: dict[str, FieldResult],
) -> dict[str, FieldResult]:
    """Top-level broadcast guard — runs across the final extraction
    result regardless of which strategy produced each field.

    A field marked `kind: list` whose value is a list of all-identical
    non-null entries (>=3 entries) AND has at least one sibling list
    column with variety is treated as a broadcast (one global element
    captured N times) and replaced with a list of nulls. Same trade-off
    as `_null_broadcast_columns`: legit flat-rate stores get nulled
    too, but honest null > misleading 'this value belongs to row N'.

    Only operates on FieldResult envelopes whose value is a list. Scalar
    fields (kind: text / attr) are passed through unchanged.
    """
    list_envelopes: list[tuple[str, FieldResult]] = []
    for label, env in fields.items():
        if not isinstance(env, dict):
            continue
        val = env.get("value")
        if isinstance(val, list):
            list_envelopes.append((label, env))

    if len(list_envelopes) < 2:
        # Need at least one sibling list column to know "another column
        # varies"; with <2 list columns we have no variety signal.
        return fields

    # Does at least one list column show variety?
    any_varied = False
    for _label, env in list_envelopes:
        col = env.get("value") or []
        non_null = [v for v in col if v not in (None, "")]
        if len(set(non_null)) > 1:
            any_varied = True
            break
    if not any_varied:
        return fields

    cleaned = dict(fields)
    for label, env in list_envelopes:
        col = env.get("value") or []
        non_null = [v for v in col if v not in (None, "")]
        if len(non_null) >= 3 and len(set(non_null)) == 1:
            # Broadcast detected. Build a new envelope with nulls,
            # preserve provenance, lower confidence, set reason.
            cleaned[label] = _envelope(
                [None] * len(col),
                source=env.get("source", "selector"),
                confidence=min(env.get("confidence", 1.0), 0.3),
                selector_used=env.get("selector_used"),
                reason_if_null=(
                    "all rows had identical value while other columns "
                    "varied — looked like a global element captured per "
                    "row, not a per-row value. Set explicit field as "
                    "scalar if this column truly has one fixed value."
                ),
            )
    return cleaned


def _js_str(s: str) -> str:
    """Safely embed a Python string as a JS string literal."""
    import json
    return json.dumps(s)


# ─────────────────────────────────────────────────────────────────────────
# Pure HTML → template-result function.
#
# Split out so callers that ALREADY have rendered HTML (e.g. /assist/schema
# right after a snapshot, the picker preview) can run extraction against
# the EXACT same DOM the schema was generated from, without re-navigating.
#
# Pre-this split: /assist/schema → take_snapshot (snap A) → LLM generates
# selectors from snap A → /extract → fresh take_snapshot (snap B) →
# runs selectors against snap B. If the page rendered differently
# between A and B (Amazon's geo-cache, lazy hydration, A/B variant),
# every selector returned null — silent "everything fails" failure.
#
# Now: /assist/schema captures the rendered HTML on snap A, runs this
# function against that HTML to produce initial values, returns BOTH
# schema + values in one response. No second navigation.
# ─────────────────────────────────────────────────────────────────────────


def extract_from_html(
    url: str,
    html: str,
    template: list[Field],
    *,
    output_format: Literal["fields", "markdown", "html"] = "fields",
) -> dict[str, Any]:
    """Run a template against pre-rendered HTML — no browser, no
    navigation.

    Returns the same shape as `extract()` minus the navigation-only
    fields. Pagination is not supported (a single HTML payload, no
    way to click "next").

    Caller is responsible for ensuring the HTML is fully rendered and
    SSRF-safe. /assist/schema gates URLs through `_is_safe_url` at
    snapshot time; this function trusts its caller.
    """
    result: dict[str, Any] = {"url": url, "fields": {}, "errors": {}, "title": ""}

    if output_format == "html":
        result["html"] = html
        return result
    if output_format == "markdown":
        result["markdown"] = _html_to_markdown(html)
        return result
    if not html:
        # Honest null-everything when there's no DOM to match — callers
        # already saw a snapshot title/screenshot; they know the page
        # was empty.
        for field in template:
            label = field.get("label") or field.get("selector") or "field"
            result["fields"][label] = _envelope(
                None,
                source="none",
                confidence=0.0,
                selector_used=field.get("selector") or field.get("xpath") or None,
                reason_if_null="no HTML captured — page may have been blocked or empty",
            )
        return result

    return _run_template_on_pages(url, [html], template, result_seed=result)


def _run_template_on_pages(
    url: str,
    all_pages_html: list[str],
    template: list[Field],
    *,
    result_seed: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Per-page parse + merge — shared by the live-tab path and the
    pre-captured-HTML path. Pure: no awaits, no browser, no I/O.

    For each page: parse HTML, run row-extractor for list fields,
    fall back to per-field _pull() for scalars. Across pages: concat
    list values, keep scalar from page 1. Same FieldResult envelope
    contract as `_extract_inner`.
    """
    result = result_seed or {"url": url, "fields": {}, "errors": {}, "title": ""}

    merged_fields: dict[str, FieldResult] = {}
    for i, page_html in enumerate(all_pages_html):
        tree = lxml_html.fromstring(page_html) if page_html else None
        if tree is None:
            continue
        row_values, row_labels = _pull_lists_per_row(tree, template)
        page_fields: dict[str, FieldResult] = {}
        for label, value in row_values.items():
            matching_field = next(
                (f for f in template if (f.get("label") or f.get("selector") or "field") == label),
                None,
            )
            used = (matching_field or {}).get("selector") if matching_field else None
            if value:
                page_fields[label] = _envelope(
                    value, source="selector", confidence=1.0, selector_used=used,
                )
            else:
                page_fields[label] = _envelope(
                    [], source="selector", confidence=0.5, selector_used=used,
                    reason_if_null="per-row extractor produced empty result",
                )
        for field in template:
            label = field.get("label") or field.get("selector") or "field"
            if label in row_labels:
                continue
            try:
                page_fields[label] = _pull(tree, field)
            except Exception as e:
                if i == 0:
                    result["errors"][label] = str(e)
                page_fields[label] = _envelope(
                    None, source="none", confidence=0.0,
                    selector_used=field.get("selector") or field.get("xpath") or None,
                    reason_if_null=f"extraction raised: {type(e).__name__}: {str(e)[:120]}",
                )

        if i == 0:
            merged_fields = page_fields
        else:
            for k, v in page_fields.items():
                prev = merged_fields.get(k)
                if not prev:
                    merged_fields[k] = v
                    continue
                if isinstance(prev["value"], list) and isinstance(v["value"], list):
                    merged_fields[k] = _envelope(
                        (prev["value"] or []) + (v["value"] or []),
                        source=prev["source"],
                        confidence=max(prev["confidence"], v["confidence"]),
                        selector_used=prev["selector_used"],
                    )

    result["fields"] = merged_fields
    if len(all_pages_html) > 1:
        result["pages_fetched"] = len(all_pages_html)
    return result


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


def _pull(tree, field: Field) -> FieldResult:
    """Extract one field, returning the FieldResult envelope.

    Provenance: tries CSS selector first, then xpath. Reports which
    one matched in `selector_used`. If neither matched, returns a
    null-value envelope with a precise `reason_if_null`.

    Confidence: 1.0 for a deterministic selector match (the CSS /
    XPath unambiguously produced the value). 0.0 when no nodes
    matched. Future iters can lower confidence based on heuristic
    flags (e.g. selector matched but result was empty string).
    """
    selector = (field.get("selector") or "").strip()
    xpath = (field.get("xpath") or "").strip()
    kind = field.get("kind", "text")
    attr = field.get("attr", "")

    # If no selector AND no xpath, the field is unspecified.
    if not selector and not xpath:
        return _envelope(
            [] if kind == "list" else None,
            source="none",
            confidence=0.0,
            selector_used=None,
            reason_if_null="field has neither selector nor xpath",
        )

    # Try CSS first, then XPath. Record which one was the source AND
    # the failure reason if one came up — silent-swallow of the
    # selector-parse exception was the bug that hid Tailwind-class /
    # special-char selector failures behind a generic "matched zero
    # nodes" message. Now: capture the exception text so it flows
    # into reason_if_null below.
    nodes: list[Any] = []
    source: FieldSource = "none"
    used: str | None = None
    parse_error: str | None = None
    if selector:
        try:
            raw_nodes = tree.cssselect(selector)
            # Drop matches inside <template> — browsers treat template
            # content as an inert document fragment, not the live DOM.
            # lxml's cssselect doesn't know this and returns them as
            # if they were real. For a scraper this is the wrong call
            # — a real user can't see template content. Filter at the
            # earliest gate so per-row + per-field logic both benefit.
            nodes = [
                n for n in raw_nodes
                if not _has_template_ancestor(n) and not _has_hidden_ancestor(n)
            ]
            if nodes:
                source = "selector"
                used = selector
        except Exception as e:
            nodes = []
            parse_error = f"{type(e).__name__}: {str(e)[:200]}"
            # `:has()` rewrite. cssselect can't parse it; try our
            # narrow rewrite to XPath. If it works, treat the match
            # as a CSS-selector match for provenance purposes.
            if ":has(" in selector:
                xp = _rewrite_has_to_xpath(selector)
                if xp:
                    try:
                        rewritten_nodes = tree.xpath(xp)
                        if rewritten_nodes:
                            nodes = rewritten_nodes
                            source = "selector"
                            used = selector
                            parse_error = None
                    except Exception:
                        pass

    # Relaxed-selector fallback. The picker's `buildCssSelector` walks
    # up to the first stable-looking id, but many sites embed PAGE-
    # SPECIFIC identifiers in those ids: Steam's
    # `#game_area_purchase_section_2483190` (the trailing number is
    # the app id), Shopify's `#shopify-section-1234567890`,
    # WordPress's `#post-NNNN`, Reddit's `#thing_t3_xxxxx`, etc. Those
    # anchors break re-use of a saved template across sibling pages.
    # When the original selector matched zero nodes (NOT a parse
    # error), try progressively relaxed variants. First match wins.
    if not nodes and selector and not parse_error:
        for variant in _relax_selector_variants(selector):
            try:
                relaxed = tree.cssselect(variant)
            except Exception:
                continue
            if relaxed:
                nodes = relaxed
                source = "selector"
                used = variant
                break

    if not nodes and xpath:
        try:
            nodes = tree.xpath(xpath)
            if nodes:
                source = "xpath"
                used = xpath
        except Exception as e:
            nodes = []
            # XPath error overwrites CSS error only if CSS didn't fail.
            # If both failed, prefer the CSS error since CSS is the
            # primary selector the user / picker generated.
            if not parse_error:
                parse_error = f"xpath {type(e).__name__}: {str(e)[:200]}"

    # Selector did not match anything.
    if not nodes:
        # Distinguish (a) selector ran cleanly but matched zero nodes,
        # (b) selector raised a parse/syntax error, (c) the user
        # provided neither. (b) is the one we used to silent-fail on.
        attempted = selector or xpath
        if parse_error:
            return _envelope(
                [] if kind == "list" else None,
                source="none",
                confidence=0.0,
                selector_used=attempted,
                reason_if_null=(
                    f"selector parse error ({attempted!r}): {parse_error}"
                ),
            )
        return _envelope(
            [] if kind == "list" else None,
            source="none",
            confidence=0.0,
            selector_used=attempted,
            reason_if_null=f"selector matched zero nodes ({attempted!r})",
        )

    # Selector matched — pull values per kind.
    if kind == "list":
        if attr:
            raw_values = [_read(n, "attr", attr) for n in nodes]
        else:
            raw_values = [_read(n, "text", "") for n in nodes]
        # Filter out None / empty — partial nulls inside a list are
        # noise, the user wants the actual values.
        raw = [v for v in raw_values if v not in (None, "")]
    else:
        raw = _read(nodes[0], kind, attr)

    # Apply transforms.
    transforms = field.get("transforms") or []
    if transforms:
        if kind == "list" and isinstance(raw, list):
            raw = [_apply_transforms(v, transforms) for v in raw]
        else:
            raw = _apply_transforms(raw, transforms)

    # Post-transform null / empty check — selector matched but the
    # text was empty. Honest report.
    if raw in (None, "", []):
        return _envelope(
            [] if kind == "list" else None,
            source=source,
            confidence=0.5,  # selector hit but value was empty — half-credit
            selector_used=used,
            reason_if_null=(
                f"selector matched but extracted value was empty "
                f"({len(nodes)} node(s), kind={kind!r})"
            ),
        )

    # List-field transform scrub. If the transform pipeline reduced
    # every item to None (e.g. regex_extract pattern didn't match any
    # value), the list is technically non-empty but carries no signal.
    # Returning [None, None, None] with confidence=1.0 would mislead;
    # downgrade to confidence=0.5 + reason so the user sees that
    # transforms (not the selector) ate the data.
    if kind == "list" and isinstance(raw, list) and transforms and raw:
        if all(v is None for v in raw):
            return _envelope(
                [],
                source=source,
                confidence=0.5,
                selector_used=used,
                reason_if_null=(
                    "selector matched but all values were nulled by the "
                    "transform pipeline (e.g. regex_extract with no match)"
                ),
            )

    return _envelope(
        raw,
        source=source,
        confidence=1.0,
        selector_used=used,
    )


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


def _t_resolve_url(v: Any, t: Transform) -> Any:
    """Join a (possibly) relative URL against a base URL supplied as
    `value`. Uses Python's urljoin which handles:
      * absolute http(s):// URLs — passed through unchanged
      * protocol-relative `//host/path` — adopts the base scheme
      * path-relative `/products/123` — joined against base origin

    Returns the original value on any error so a malformed base URL
    can't break a whole extraction run.
    """
    if not isinstance(v, str) or not v:
        return v
    base = t.get("value") or ""
    if not base:
        return v
    try:
        from urllib.parse import urljoin
        return urljoin(base, v)
    except Exception:
        return v


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
    "resolve_url":        _t_resolve_url,
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



# `:has()` rewrite — lxml's cssselect (Translator) raises
# ExpressionError on `:has()` even though it's a stable CSS L4 feature
# now shipped in every major browser. Rather than letting users hit
# silent "selector parse error", we rewrite the simple AND common shape
# `A:has(B)` -> XPath `descendant-or-self::A[descendant::B]` ourselves
# and fall through to the xpath branch.
#
# Scope is deliberately small: only the *trailing* compound of the
# whole selector may carry the `:has()`; the inner argument must be a
# simple compound (tag + classes + optional [attr] / #id). Anything
# more elaborate (`:has(> X)`, `:has(X + Y)`, multiple `:has`) is left
# as-is and degrades to the normal parse-error envelope. Better to
# handle 95% of real-world `:has()` use than to bury a buggy rewrite.
_HAS_PSEUDO_RE = re.compile(r":has\(([^()]+)\)")
_SIMPLE_COMPOUND_RE = re.compile(
    r"^([a-zA-Z][\w-]*)?"
    r"((?:[.#][\w-]+|\[[^\]]+\])*)"
    r"$"
)


def _compound_to_xpath_predicates(compound: str):
    """Translate a simple compound (tag.foo.bar[attr=val]) to (tag, [predicates])."""
    m = _SIMPLE_COMPOUND_RE.match(compound)
    if not m:
        raise ValueError(f"compound not simple: {compound!r}")
    tag = m.group(1) or "*"
    rest = m.group(2) or ""
    preds = []
    i = 0
    while i < len(rest):
        ch = rest[i]
        if ch == ".":
            j = i + 1
            while j < len(rest) and (rest[j].isalnum() or rest[j] in "-_"):
                j += 1
            cls = rest[i + 1:j]
            preds.append(
                "contains(concat(' ', normalize-space(@class), ' '), ' " + cls + " ')"
            )
            i = j
        elif ch == "#":
            j = i + 1
            while j < len(rest) and (rest[j].isalnum() or rest[j] in "-_"):
                j += 1
            id_val = rest[i + 1:j]
            preds.append("@id='" + id_val + "'")
            i = j
        elif ch == "[":
            close = rest.find("]", i)
            if close < 0:
                raise ValueError(f"unbalanced bracket: {rest!r}")
            attr_expr = rest[i + 1:close]
            if "=" in attr_expr:
                name, _, val = attr_expr.partition("=")
                val = val.strip('"').strip("'")
                preds.append("@" + name + "='" + val + "'")
            else:
                preds.append("@" + attr_expr)
            i = close + 1
        else:
            raise ValueError(f"unexpected char {ch!r} in compound {compound!r}")
    return tag, preds


def _rewrite_has_to_xpath(selector: str):
    """Best-effort rewrite of `OUTER:has(INNER)` to XPath. Returns None
    when the selector isn't a simple shape we know how to translate."""
    if ":has(" not in selector:
        return None
    matches = list(_HAS_PSEUDO_RE.finditer(selector))
    if len(matches) != 1:
        return None
    m = matches[0]
    inner = m.group(1).strip()
    if any(ch in inner for ch in (">", "~", "+", " ", ",")):
        return None
    outer = (selector[: m.start()] + selector[m.end():]).strip()
    if not outer:
        outer = "*"
    outer_compounds = [c for c in outer.split() if c]
    try:
        compound_xps = [_compound_to_xpath_predicates(c) for c in outer_compounds]
        inner_tag, inner_preds = _compound_to_xpath_predicates(inner)
    except ValueError:
        return None
    inner_pred_str = " and ".join(inner_preds) if inner_preds else ""
    if inner_pred_str:
        descendant_pred = "descendant::" + inner_tag + "[" + inner_pred_str + "]"
    else:
        descendant_pred = "descendant::" + inner_tag

    parts = []
    for idx, (tag, preds) in enumerate(compound_xps):
        is_last = idx == len(compound_xps) - 1
        local_preds = list(preds)
        if is_last:
            local_preds.append(descendant_pred)
        pred_str = "][".join(local_preds)
        if pred_str:
            parts.append(tag + "[" + pred_str + "]")
        else:
            parts.append(tag)
    return "//" + "//".join(parts)


def _read(node, kind: str, attr: str) -> Any:
    if kind == "attr" and attr:
        try:
            val = node.get(attr)
        except Exception:
            return None
        # Lazy-image fallback. When the picker captures src="" or
        # src="data:image/svg+xml;..." (a 1px placeholder), the real
        # CDN URL is usually in one of the lazy-load shim attributes.
        # Walk through the well-known ones in order; first non-empty
        # wins. Real, non-placeholder src always wins if present.
        if attr in ("src", "href") and (not val or _is_placeholder_src(val)):
            try:
                for fallback_attr in (
                    "data-src",
                    "data-original",
                    "data-lazy-src",
                    "data-original-src",
                    "data-img-src",
                ):
                    v = node.get(fallback_attr)
                    if v and not _is_placeholder_src(v):
                        return v
                # srcset / data-srcset — comma-separated `url widthDescriptor`
                # pairs. Take the first URL (highest priority responsive
                # variant according to the browser's picker).
                for srcset_attr in ("data-srcset", "srcset"):
                    sset = node.get(srcset_attr)
                    if sset:
                        first = sset.split(",")[0].strip().split()
                        if first and first[0]:
                            return first[0]
                # <picture> wrapper fallback. The picker may have
                # captured <picture> itself; the meaningful src lives
                # on the inner <img> (or first <source srcset>). Walk
                # the children and pick the first useful URL.
                tag = getattr(node, "tag", None)
                if tag == "picture":
                    for child in node.iter():
                        ctag = getattr(child, "tag", None)
                        if ctag == "img":
                            img_src = (child.get("src") or "").strip()
                            if img_src and not _is_placeholder_src(img_src):
                                return img_src
                        elif ctag == "source":
                            srcset = child.get("srcset") or ""
                            if srcset:
                                first = srcset.split(",")[0].strip().split()
                                if first and first[0]:
                                    return first[0]
            except Exception:
                pass
        return val
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
    # text default — use the visibility-aware extractor (NOT lxml's raw
    # text_content, which concatenates aria-hidden mirror nodes and
    # screen-reader-only copies, producing the famous `$319.99$319.99`
    # bug from the pre-launch audit). See `_visible_text` for the
    # 3-pass fallback strategy.
    try:
        if hasattr(node, "text_content"):
            visible = _visible_text(node)
            # Split-price climb. When the picker clicks the dollar
            # sign of `<span>$</span><span>199</span><span>.99</span>`,
            # the selector matches one span → extracted text is just
            # "$". Climb to the parent and check whether siblings
            # together form a price pattern; if yes, return the
            # parent's visible text instead. Same trick handles "€",
            # "£", "¥", "₹", "₽", and a stray decimal point.
            climbed = _maybe_join_split_price(node, visible)
            if climbed is not None:
                return climbed
            # Media-element fallback. <img> / <area> have no text
            # content; the meaningful textual proxy is their `alt`
            # attribute. Same for <input type="button|submit"> whose
            # caption lives in the `value` attribute. When the picker
            # clicks an image and the user keeps kind=text, returning
            # the alt text matches user intent better than returning "".
            if not visible:
                tag = getattr(node, "tag", None)
                if tag == "img" or tag == "area":
                    alt = (node.get("alt") or "").strip()
                    if alt:
                        return alt
                elif tag == "input":
                    itype = (node.get("type") or "").lower()
                    if itype in ("button", "submit", "reset"):
                        cap = (node.get("value") or "").strip()
                        if cap:
                            return cap
                elif tag == "picture":
                    # <picture> contains <source> + a fallback <img>;
                    # the visible text proxy is the inner <img>'s alt.
                    for child in node.iter():
                        if getattr(child, "tag", None) == "img":
                            alt = (child.get("alt") or "").strip()
                            if alt:
                                return alt
                            break
                elif tag == "meta":
                    # Schema.org microdata convention: <meta itemprop=
                    # "price" content="199.99"> — the value lives in
                    # `content`, not in visible text. Same for
                    # <meta property="og:title" ...>.
                    content = (node.get("content") or "").strip()
                    if content:
                        return content
            # Schema.org microdata fallback for non-<meta> nodes. When
            # a node has `itemprop` set, ANY of these attributes may
            # carry the canonical value: `content` (meta/link), `value`
            # (data/object), `datetime` (time element), `src/href`
            # (resource), `datetime`. When text is empty + one of these
            # is set, prefer the attribute over the empty visible text.
            # No site-specific code — purely structural (the attribute
            # set is the schema.org spec for microdata).
            if not visible:
                try:
                    if node.get("itemprop") is not None:
                        for microdata_attr in (
                            "content", "value", "datetime", "href", "src",
                        ):
                            mv = (node.get(microdata_attr) or "").strip()
                            if mv:
                                return mv
                except Exception:
                    pass
            return visible
        return str(node).strip()
    except Exception:
        return None


# ── Helpers for the _read enhancements ─────────────────────────────────


_PLACEHOLDER_SRC_RE = re.compile(
    r"^(?:data:image/[\w+.-]+;[\w=,;-]*?(?:AAAA|R0lGOD)|"
    r"data:image/gif;base64,R0lGOD|"
    r"about:blank|"
    r"#)$",
    re.IGNORECASE,
)


def _has_template_ancestor(node) -> bool:
    """Walk up from `node` looking for a `<template>` ancestor. Returns
    True if found. Used to filter cssselect matches that are inside
    template document-fragments — those are inert in real browsers and
    shouldn't be treated as scrapable content.

    Bounded: walks at most 30 levels (real DOMs rarely exceed this; an
    infinite-loop guard for malformed trees with cycles)."""
    cur = node
    for _ in range(30):
        try:
            cur = cur.getparent()
        except Exception:
            return False
        if cur is None:
            return False
        tag = getattr(cur, "tag", None)
        if isinstance(tag, str) and tag.lower() == "template":
            return True
    return False


# Class names that universally mean "hidden". NOT site-specific — these
# are framework / CSS-utility conventions used across the web:
#   - vanilla:   hidden, invisible
#   - Bootstrap: d-none, d-md-none, d-lg-none, d-xl-none, d-xxl-none
#   - Tailwind:  lg:hidden, md:hidden, sm:hidden, xl:hidden, 2xl:hidden
#   - common UX: mobile-hidden, desktop-hidden, hide-mobile, hide-desktop,
#                hidden-mobile, hidden-desktop, hidden-xs/sm/md/lg
# The screen-reader-only patterns are handled separately in `_is_hidden`
# via `_HIDDEN_CLASSES_RE` (sr-only, a-offscreen, visually-hidden, etc).
_RESPONSIVE_HIDDEN_CLASSES_RE = re.compile(
    r"(?:^|\s)("
    r"hidden|d-none|invisible"
    r"|d-(?:sm|md|lg|xl|xxl)-none"
    r"|(?:sm|md|lg|xl|2xl):hidden"
    r"|mobile-hidden|desktop-hidden|hide-mobile|hide-desktop"
    r"|hidden-mobile|hidden-desktop|hidden-xs|hidden-sm|hidden-md|hidden-lg"
    r")(?=$|\s)",
    re.IGNORECASE,
)


def _is_node_visually_hidden(node) -> bool:
    """Single-node visibility check — returns True if this specific
    element is hidden via inline `style="display:none"`, the inline
    visibility:hidden style, or one of the universal hidden CSS class
    tokens (`.hidden`, `.d-none`, `.lg:hidden`, etc.).

    Used by `_has_hidden_ancestor` to walk up looking for any hidden
    ancestor — when a responsive site renders both mobile + desktop
    versions of a card and only one is visible, lxml's cssselect
    returns BOTH; we filter the hidden copy here."""
    try:
        attrs = node.attrib
    except AttributeError:
        return False
    style = attrs.get("style", "") or ""
    if style:
        if _DISPLAY_NONE_RE.search(style) or _VISIBILITY_HIDDEN_RE.search(style):
            return True
    classes = attrs.get("class", "") or ""
    if classes and _RESPONSIVE_HIDDEN_CLASSES_RE.search(classes):
        return True
    # aria-hidden="true" — Amazon's a-offscreen mirror pattern and
    # many other accessibility-hidden duplicates.
    if (attrs.get("aria-hidden", "") or "").lower() == "true":
        return True
    return False


def _has_hidden_ancestor(node) -> bool:
    """Walk up from `node` (inclusive) looking for any ancestor with
    a known visually-hidden marker. Used to filter cssselect matches
    that live inside a `display:none` or `lg:hidden` responsive copy.

    Bounded at 30 hops (same as _has_template_ancestor). All class
    name checks are universal CSS-utility conventions — NOT site
    specific."""
    cur = node
    for _ in range(30):
        if cur is None:
            return False
        if _is_node_visually_hidden(cur):
            return True
        try:
            cur = cur.getparent()
        except Exception:
            return False
    return False


def _is_placeholder_src(val: str) -> bool:
    """A src/href is a 'placeholder' when it's empty, a 1x1 gif data URI,
    a tiny SVG data URI, `#`, `about:blank`, or starts with a known
    skeleton-loader pattern. Real CDN URLs return False."""
    if not val or not isinstance(val, str):
        return True
    if val.startswith("data:image"):
        # Tiny placeholder data URIs (under ~200 chars after the comma
        # are almost always 1x1 gif spacers or skeleton SVGs). Real
        # base64-encoded images are >1KB.
        try:
            payload = val.split(",", 1)[1]
            if len(payload) < 200:
                return True
        except Exception:
            pass
    return bool(_PLACEHOLDER_SRC_RE.match(val.strip()))


# Price-like patterns. Matches:
#   $19.99 · €19,99 · £19 · ¥1,999 · ₹199 · ₽199.99
# The currency symbol is captured separately so we can recognize a
# bare "$" (or any of the others) as a split-price fragment.
_PRICE_CURRENCY_RE = re.compile(r"^[$€£¥₹₽]$")
# Allow currency symbol EITHER before or after the digits. European
# stores commonly render '19,99 €' (currency trailing); the picker
# captures the symbol span and we must climb to reassemble the price.
_PRICE_JOINED_RE = re.compile(
    r"^\s*[$€£¥₹₽]?\s*\d[\d,.]*(?:[.,]\d+)?\s*[$€£¥₹₽]?\s*$"
)


def _maybe_join_split_price(node, current_text: str) -> str | None:
    """When the extracted text is a stranded currency symbol or a tiny
    fragment of a split price, climb to the parent and try to assemble
    the full price from the parent's visible text.

    Returns the joined string when:
      - current text is just a currency symbol or single decimal point
      - parent has at least 2 element children (split-price structure)
      - parent's joined visible text matches the price pattern

    Otherwise returns None and the caller keeps the original text.

    Why: real-world sites split prices across spans for typography
    control. `<span>$</span><span>199</span><span>.99</span>` renders
    the dollar sign smaller than the digits. Clicking the dollar sign
    in our picker captures the inner span; without this climb, the
    extracted price is just `"$"`.
    """
    if not current_text:
        return None
    txt = current_text.strip()
    is_lone_currency = bool(_PRICE_CURRENCY_RE.match(txt))
    is_lone_dot = txt == "."
    if not (is_lone_currency or is_lone_dot):
        return None
    try:
        parent = node.getparent()
    except Exception:
        return None
    if parent is None:
        return None
    # Heuristic: parent should be a small container of inline spans.
    # If it has too many children (> 8) it's probably an unrelated
    # container — bail. If <2 children we don't have a split structure.
    try:
        children = [c for c in parent if isinstance(getattr(c, "tag", None), str)]
    except Exception:
        return None
    if not (2 <= len(children) <= 8):
        return None
    try:
        parent_visible = _visible_text(parent).strip()
    except Exception:
        return None
    if not parent_visible:
        return None
    # Reject if parent text doesn't look like a price (avoid joining
    # unrelated siblings like "Tax included" or "From the seller").
    if not _PRICE_JOINED_RE.match(parent_visible):
        return None
    # Collapse internal whitespace inside the joined price (between
    # the symbol and the digits).
    return re.sub(r"\s+", "", parent_visible)


# Well-known class names that mark "screen-reader only" content —
# visually hidden but read aloud by assistive tech. Page authors don't
# want this duplicated in scraped output.
#  • a-offscreen     — Amazon
#  • sr-only         — Bootstrap 4 / Tailwind / many
#  • screen-reader-only / screen-reader-text — WordPress, others
#  • screenreader    — variant
#  • visually-hidden / visuallyhidden — Bootstrap 5 / GOV.UK
#  • vh              — Bootstrap legacy
_HIDDEN_CLASSES_RE = re.compile(
    r"(?:^|\s)("
    r"a-offscreen|sr-only|screen-reader-only|screen-reader-text|"
    r"screenreader|visually-hidden|visuallyhidden|vh"
    r")(?=$|\s)",
    re.IGNORECASE,
)
_DISPLAY_NONE_RE = re.compile(r"display\s*:\s*none", re.IGNORECASE)
_VISIBILITY_HIDDEN_RE = re.compile(r"visibility\s*:\s*hidden", re.IGNORECASE)
_WS_COLLAPSE_RE = re.compile(r"\s+")


# Tags whose textual content is NEVER visible to the user — code
# blocks, hidden DOM, browser-only fallbacks. Filtering these out of
# _visible_text avoids "Title var x = 1;" pollution when an ancestor
# container is picked.
_NEVER_VISIBLE_TAGS = frozenset(("script", "style", "noscript", "template"))


def _is_hidden(node, pass_num: int = 1) -> bool:
    """Whether to skip this node during visible-text extraction.

    `pass_num` controls strictness — see `_visible_text` for the
    three-pass fallback that lets us recover screen-reader-only text
    when it's the ONLY copy present (e.g. some Amazon variants).

      pass 1 (strict):  skip aria-hidden, sr-only classes, display:none,
                        plus script/style/noscript/template tags
      pass 2 (medium):  skip aria-hidden + script/style/noscript/template —
                        preserves the sr text copy when no visible-marked
                        sibling exists
      pass 3 (loose):   nothing skipped, mirrors lxml's text_content

    Even on pass 3 we DO continue to skip <script>/<style>/<noscript>/
    <template> via the visit loop's tag check rather than here — these
    are NEVER user-visible text and pass 3 is meant to be a "show the
    sr-only fallback" not "include source code".
    """
    tag = getattr(node, "tag", None)
    if isinstance(tag, str) and tag.lower() in _NEVER_VISIBLE_TAGS:
        # Script / style / noscript / template are skipped at every
        # pass — they carry code/markup not visible text.
        return True
    if pass_num >= 3:
        return False
    try:
        attrs = node.attrib
    except AttributeError:
        return False
    if (attrs.get("aria-hidden", "") or "").lower() == "true":
        return True
    if pass_num >= 2:
        # Pass 2 only filters aria-hidden — the screen-reader copy is
        # treated as the authoritative text fallback.
        return False
    classes = attrs.get("class", "") or ""
    if classes and _HIDDEN_CLASSES_RE.search(classes):
        return True
    style = attrs.get("style", "") or ""
    if style and (_DISPLAY_NONE_RE.search(style) or _VISIBILITY_HIDDEN_RE.search(style)):
        return True
    return False


def _visible_text(node) -> str:
    """Extract text from an lxml node, avoiding aria-hidden / sr-only /
    display:none / visibility:hidden subtrees.

    THE BUG THIS FIXES: lxml's `text_content()` walks every descendant
    and concatenates text. Amazon (and many e-commerce sites) ship the
    same price TWICE for accessibility:

        <span class="a-price">
          <span class="a-offscreen">$319.99</span>         ← screen reader
          <span aria-hidden="true">                         ← visual layout
            <span class="a-price-symbol">$</span>
            <span class="a-price-whole">319</span>
            <span class="a-price-fraction">99</span>
          </span>
        </span>

    `text_content()` returned `"$319.99$319.99"` — the silent failure
    mode the pre-launch audit (May 22 2026) flagged. The fix walks the
    tree itself, skipping a-priori-hidden subtrees.

    Three-pass fallback:
      1. Strict — skip both aria-hidden AND sr-only/display:none. On
         Amazon, both copies are filtered → pass 1 returns empty.
      2. Aria-only — skip just aria-hidden. The .a-offscreen
         screen-reader copy ($319.99) becomes the returned value. This
         is correct: it's the authoritative text the page author
         intended, and CSS computed-style isn't available to lxml so
         we can't choose between the visible split vs the sr copy any
         better than this.
      3. Loose — full text_content. Only reached if even pass 2 was
         empty. Preserves graceful degradation for weird DOMs.
    """
    if node is None:
        return ""

    for pass_num in (1, 2, 3):
        parts: list[str] = []

        def visit(n):
            tag = getattr(n, "tag", None)
            # Skip comments / processing instructions / non-element types
            if not isinstance(tag, str):
                return
            if _is_hidden(n, pass_num):
                return
            if n.text:
                parts.append(n.text)
            for child in n:
                visit(child)
                if child.tail:
                    parts.append(child.tail)

        visit(node)
        raw = "".join(parts)
        if raw.strip():
            return _WS_COLLAPSE_RE.sub(" ", raw).strip()

    # All three passes returned empty — node genuinely has no text.
    return ""


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
# Per-row list extraction. Two strategies — CSS-prefix LCP for clean
# grids, DOM-LCA fallback for hashed-class SPA sites where selector
# strings diverge. Plus a broadcast-detector safety net that nulls
# columns where one global element is being captured across every row.
# ─────────────────────────────────────────────────────────────────────────

def _pull_lists_per_row(
    tree, template: list[Field]
) -> tuple[dict[str, list[Any]], set[str]]:
    """Per-row list extraction.

    Two strategies, tried in order:

      1. CSS-prefix LCP — split each list field's selector on `>`,
         find the longest common prefix, use it as the row container.
         Fast, works for clean grids where every field's selector
         shares a clean ancestor path.

      2. DOM-LCA fallback — when prefix-LCP yields no usable container
         (no common prefix, prefix matches < 2 rows, or yields a
         broadcast — i.e. every field returns the same scoped value
         across all rows), find each field's matches in the tree and
         walk UP from the field with the fewest matches looking for
         the smallest ancestor that "owns" exactly one match from
         every other field. That ancestor is the row container. The
         DOM walk doesn't care about selector strings — it works off
         actual DOM ancestry, which can't be faked by hashed-class
         SPA sites (Target, Shopify, Nike, Sephora, etc.).

    Safety: if BOTH strategies produce a column where every row has
    the IDENTICAL non-empty value AND that field's flat-tree match
    count is far smaller than the row count (clear broadcast signal —
    one global element captured N times), that column gets nulled
    rather than lying about per-row alignment. Frontend `zipRecords`
    requires equal lengths; nulls preserve alignment without
    inventing data.

    Returns (values_by_label, labels_handled). Labels not in the
    handled set fall back to per-field `_pull()`.
    """
    list_fields: list[tuple[str, Field]] = []
    has_comma_selector = False
    for f in template:
        if f.get("kind") != "list":
            continue
        sel = (f.get("selector") or "").strip()
        if not sel:
            continue
        # Comma-fanout: previously we skipped any selector with a comma.
        # Now we admit them — `_try_prefix_lcp` would fail on commas
        # (its split-on-`>` logic can't handle the union semantics),
        # but `_try_dom_lca` works fine because cssselect handles the
        # union natively. Flag so the prefix path can opt-out cleanly.
        if "," in sel:
            has_comma_selector = True
        label = f.get("label") or f.get("selector") or "field"
        list_fields.append((label, f))

    if len(list_fields) < 2:
        return {}, set()

    # Prefix-LCP doesn't understand `,` unions in selectors (its
    # split-on-`>` produces bogus parts inside a comma group). Skip it
    # entirely when ANY field uses a comma selector — go straight to
    # DOM-LCA which uses cssselect natively and handles unions.
    values = None if has_comma_selector else _try_prefix_lcp(tree, list_fields)

    if values is None or _looks_like_broadcast(tree, list_fields, values):
        dom_values = _try_dom_lca(tree, list_fields)
        if dom_values is not None:
            values = dom_values

    if values is None:
        return {}, set()

    cleaned = _null_broadcast_columns(tree, list_fields, values)
    return cleaned, {label for label, _ in list_fields}


def _try_prefix_lcp(
    tree, list_fields: list[tuple[str, Field]]
) -> dict[str, list[Any]] | None:
    """Original CSS-selector-prefix row extraction. Returns None when
    prefix is empty / prefix matches < 2 rows / parse error — caller
    will try the DOM-LCA fallback."""
    parsed = [_split_selector(f[1]["selector"]) for f in list_fields]
    prefix = _longest_common_prefix(parsed)

    if len(prefix) == 0:
        return None
    if any(len(prefix) >= len(parts) for parts in parsed):
        return None

    row_selector = " > ".join(prefix)
    try:
        rows = [
            r for r in tree.cssselect(row_selector)
            if not _has_template_ancestor(r) and not _has_hidden_ancestor(r)
        ]
    except Exception:
        return None
    if len(rows) < 2:
        return None

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

    return values


def _try_dom_lca(
    tree, list_fields: list[tuple[str, Field]]
) -> dict[str, list[Any]] | None:
    """DOM-based row extraction. Works when class names diverge across
    fields so CSS-prefix LCP can't find a clean container.

    Algorithm:
      1. For each list field, get ALL its tree-wide matches.
      2. The field with the FEWEST matches is our anchor.
      3. Walk UP from each anchor looking for the smallest ancestor
         that "owns" exactly one match from each OTHER field.
      4. Per-row scope each field by finding its flat-tree matches
         that are descendants of the row container.
    """
    field_matches: list[tuple[str, Field, list[Any]]] = []
    for label, field in list_fields:
        sel = field.get("selector", "")
        try:
            matches = tree.cssselect(sel)
        except Exception:
            matches = []
        # Filter out matches inside <template> (inert) or inside hidden
        # responsive duplicates (display:none / d-none / lg:hidden / etc).
        matches = [
            m for m in matches
            if not _has_template_ancestor(m) and not _has_hidden_ancestor(m)
        ]
        if not matches:
            return None
        field_matches.append((label, field, matches))

    field_matches.sort(key=lambda fm: len(fm[2]))
    anchor_matches = field_matches[0][2]
    other_fields_matches = [fm[2] for fm in field_matches[1:]]
    expected_rows = len(anchor_matches)

    if expected_rows < 2:
        return None

    row_containers: list[Any] = []
    for anchor in anchor_matches:
        container = _find_row_container(anchor, other_fields_matches)
        if container is None:
            return None
        row_containers.append(container)

    seen_ids: set[int] = set()
    unique_containers: list[Any] = []
    for c in row_containers:
        if id(c) in seen_ids:
            continue
        seen_ids.add(id(c))
        unique_containers.append(c)
    if len(unique_containers) < 2:
        return None

    values: dict[str, list[Any]] = {label: [] for label, _, _ in field_matches}
    row_descendant_sets: list[set[int]] = [
        {id(d) for d in row.iter()} for row in unique_containers
    ]

    for row_idx, _row in enumerate(unique_containers):
        descendants = row_descendant_sets[row_idx]
        for label, field, all_matches in field_matches:
            attr = field.get("attr", "")
            scoped = next((m for m in all_matches if id(m) in descendants), None)
            values[label].append(_read(scoped, "text", attr) if scoped is not None else None)

    return values


def _find_row_container(
    anchor: Any,
    other_fields_matches: list[list[Any]],
) -> Any | None:
    """Walk UP from `anchor` looking for the smallest ancestor that
    contains exactly one match from EACH other field's match list."""
    cur = anchor
    for _hop in range(12):
        cur = cur.getparent() if hasattr(cur, "getparent") else None
        if cur is None:
            return None
        descendants = {id(d) for d in cur.iter()}
        ok = True
        for matches in other_fields_matches:
            inside = sum(1 for m in matches if id(m) in descendants)
            if inside != 1:
                ok = False
                break
        if ok:
            return cur
    return None


def _looks_like_broadcast(
    tree, list_fields: list[tuple[str, Field]], values: dict[str, list[Any]]
) -> bool:
    """Detect when a column is all-identical-non-null AND the field's
    flat-tree match count is far smaller than the row count."""
    if not values:
        return False
    rows_count = max((len(v) for v in values.values()), default=0)
    if rows_count < 2:
        return False

    any_varied = False
    any_broadcast = False
    for label, field in list_fields:
        col = values.get(label, [])
        non_null = [v for v in col if v not in (None, "")]
        if not non_null:
            continue
        distinct = len(set(non_null))
        if distinct > 1:
            any_varied = True
            continue
        sel = field.get("selector", "")
        try:
            flat_matches = tree.cssselect(sel)
        except Exception:
            flat_matches = []
        if len(flat_matches) < max(2, rows_count // 2):
            any_broadcast = True

    return any_varied and any_broadcast


def _null_broadcast_columns(
    tree,
    list_fields: list[tuple[str, Field]],
    values: dict[str, list[Any]],
) -> dict[str, list[Any]]:
    """Replace per-column broadcasts with nulls.

    A field marked `kind: "list"` is the user's explicit declaration that
    they expect a list of VARYING values across rows. So:

      If a list column has all-identical-non-null values across >=3 rows
      AND at least one other column shows variety
      → null it.

    This catches the entire broadcast bug class regardless of HOW the
    broadcast happened (selector matches one element N times, or 24
    distinct promo badges that all happen to have identical content,
    or per-row scope collapses to the same node, etc.). Earlier
    heuristics that gated on `flat_match_count < row_count` missed the
    Target case where 24 sibling promo-badge elements each contain the
    same "$199.99" text — flat count matched row count, so it shipped
    24 rows of identical $199.99 lying that they're per-product prices.

    Trade-off: a legitimate flat-rate store (every product the same
    price, 3+ products) gets nulled here. We accept this — the user
    can manually re-add the flat field as a scalar. Honest null beats
    a misleading "this $199.99 is product X's price" when in fact it's
    a shared global value masquerading as per-row data. Worst case the
    user adds one scalar field; best case (and the common case) we
    avoid the bug entirely.

    Pre-condition: at least one column must show variety. If ALL
    columns are flat, the page may legitimately have all-identical
    content and we shouldn't touch it.
    """
    rows_count = max((len(v) for v in values.values()), default=0)
    if rows_count < 3:
        return values

    other_columns_varied = False
    for col in values.values():
        non_null = [v for v in col if v not in (None, "")]
        if len(set(non_null)) > 1:
            other_columns_varied = True
            break
    if not other_columns_varied:
        return values

    cleaned: dict[str, list[Any]] = {}
    for label, _field in list_fields:
        col = values.get(label, [])
        non_null = [v for v in col if v not in (None, "")]
        # >=3 identical non-null values + sibling columns varying =
        # almost certainly a broadcast. Null the column.
        if len(non_null) >= 3 and len(set(non_null)) == 1:
            cleaned[label] = [None] * len(col)
            continue
        cleaned[label] = col
    return cleaned


_STEP_SEP_RE = re.compile(r"\s*>\s*")


def _split_selector(css: str) -> list[str]:
    return [p for p in _STEP_SEP_RE.split(css.strip()) if p]


# Page-specific-id patterns. A run of 3+ consecutive digits inside an
# id is the strongest signal that the id is per-page (app id, post id,
# database row id, etc.) and won't survive across sibling pages. Used
# by `_relax_selector_variants` below.
_DIGIT_RUN_RE = re.compile(r"\d{3,}")
_ID_TOKEN_RE = re.compile(r"#([\w-]+)")
_NTH_PSEUDO_RE = re.compile(r":nth-(?:of-type|child|last-of-type|last-child)\([^)]*\)")


def _relax_selector_variants(selector: str) -> list[str]:
    """Build progressively-relaxed variants of a CSS selector.

    The picker's `buildCssSelector` walks up to the first stable-looking
    id, but many sites embed PAGE-SPECIFIC identifiers in those ids:
      - Steam:  #game_area_purchase_section_2483190 (trailing app id)
      - Shopify: #shopify-section-1234567890
      - WordPress: #post-NNNN
      - Reddit:  #thing_t3_xxxxxx
      - Medium:  #post-1234abc
    Those anchors break re-use of a saved template across sibling pages
    — the template extraction returns null because the new page's id
    has a different trailing number.

    This function returns a list of progressively-relaxed variants of
    the original selector, in priority order:

      1. Strip ids containing 3+ consecutive digits AND `:nth-*()`
         pseudo-classes. Keeps the structural shape but loses the
         page-specific anchors.
      2. Strip ALL `#id` anchors AND `:nth-*()`. Maximally structural;
         relies entirely on tag + class path.

    Each variant is tried by `_pull` in order; first match wins. The
    original selector is NOT included in this list — that's tried
    first by `_pull` separately. Returns `[]` if nothing useful can
    be relaxed (e.g. the selector has no ids or nth pseudos).
    """
    parts = _STEP_SEP_RE.split(selector.strip())
    variants: list[str] = []

    def is_page_specific_id(part: str) -> bool:
        # Find the leading id token, if any.
        m = _ID_TOKEN_RE.match(part)
        if not m:
            return False
        return bool(_DIGIT_RUN_RE.search(m.group(1)))

    def strip_part(part: str, *, all_ids: bool) -> str:
        """Drop ids + nth pseudos from one selector step. If the step
        becomes empty (was nothing but an id), return ''."""
        out = part
        if all_ids:
            out = _ID_TOKEN_RE.sub("", out)
        elif is_page_specific_id(out):
            # Strip ONLY the leading page-specific id token.
            out = _ID_TOKEN_RE.sub("", out, count=1)
        out = _NTH_PSEUDO_RE.sub("", out)
        return out.strip()

    # Variant 1: page-specific ids + nth pseudos stripped
    v1_parts = []
    changed_v1 = False
    for p in parts:
        stripped = strip_part(p, all_ids=False)
        if stripped != p:
            changed_v1 = True
        if stripped:
            v1_parts.append(stripped)
    if changed_v1 and v1_parts:
        v1 = " > ".join(v1_parts)
        if v1 and v1 != selector:
            variants.append(v1)

    # Variant 2: ALL ids + nth pseudos stripped
    v2_parts = []
    for p in parts:
        stripped = strip_part(p, all_ids=True)
        if stripped:
            v2_parts.append(stripped)
    if v2_parts:
        v2 = " > ".join(v2_parts)
        if v2 and v2 != selector and v2 not in variants:
            variants.append(v2)

    return variants


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
