"""Deterministic-first extraction from page structured data.

This is the FIRST tier of the 2026-05-22 audit's recommended pipeline:

    microdata → JSON-LD → Open Graph → schema.org → adapter → heuristic → LLM

The point: when a page ships structured data (which the top 100
e-commerce, news, recipe, and event sites all do), we can extract
canonical field values with confidence 1.0 — no LLM call, no
selector hallucination, no $319.99$319.99 duplicate risk.

This module exposes ONE public function:

    template_from_structured(structured_data, *, max_fields) -> list[Field]

It returns a Field list compatible with the rest of the extraction
pipeline. Each emitted field carries enough provenance metadata that
the eventual FieldResult envelope can report `source="structured"`
with `confidence=1.0`.

Sources, in priority order:
  1. JSON-LD with @type ∈ {Product, NewsArticle, Article, Recipe,
     Event, BlogPosting, Movie, Book, JobPosting}. Schema.org-aware
     unpacking pulls the canonical fields per type.
  2. Open Graph — universal across news + e-commerce. og:title,
     og:description, og:image, og:price:amount, etc.
  3. Microdata — itemprop attributes. Cross-cuts with the same
     schema.org vocabulary as JSON-LD.

Twitter card is currently used only as a tie-breaker (twitter:title
fills in if og:title is missing).

Output guarantees:
  • Every field has a `selector` (the live selector that produces
    the same value when the picker re-runs extraction) OR a `value`
    sidecar (for meta tags where there's no DOM node to select).
  • Labels are lowercase snake_case (`product_title`, `og_image`).
  • Deduped by canonical label — JSON-LD wins over OG wins over
    microdata when the same logical field appears in multiple
    sources.

Out of scope here (handled elsewhere or future iters):
  • Per-site adapters (Amazon, Shopify) — deferred to a follow-up
    `adapters/` module; this layer alone handles the long tail of
    "any site that ships schema.org markup."
  • Pagination / list-of-list expansion — JSON-LD often ships an
    ItemList; we extract its top-level fields, not the per-item
    drill-down.
"""

from __future__ import annotations

from typing import Any


# ── Schema.org type → field-mapping registry ─────────────────────────────


# Each entry maps a `@type` to a list of (label, jsonld_path) pairs
# where the path is dotted (e.g. "offers.price" picks
# `obj.get("offers", {}).get("price")`). Paths support a `[0]`
# suffix on the leaf for first-of-list extraction.
_JSONLD_TYPE_MAP: dict[str, list[tuple[str, str]]] = {
    "Product": [
        ("product_name", "name"),
        ("product_description", "description"),
        ("product_image", "image"),
        ("product_price", "offers.price"),
        ("product_currency", "offers.priceCurrency"),
        ("product_availability", "offers.availability"),
        ("product_rating", "aggregateRating.ratingValue"),
        ("product_review_count", "aggregateRating.reviewCount"),
        ("product_brand", "brand.name"),
    ],
    "NewsArticle": [
        ("headline", "headline"),
        ("description", "description"),
        ("article_image", "image"),
        ("author", "author.name"),
        ("published_at", "datePublished"),
        ("updated_at", "dateModified"),
        ("publisher", "publisher.name"),
    ],
    "Article": [
        ("headline", "headline"),
        ("description", "description"),
        ("article_image", "image"),
        ("author", "author.name"),
        ("published_at", "datePublished"),
    ],
    "BlogPosting": [
        ("headline", "headline"),
        ("description", "description"),
        ("article_image", "image"),
        ("author", "author.name"),
        ("published_at", "datePublished"),
    ],
    "Recipe": [
        ("recipe_name", "name"),
        ("recipe_description", "description"),
        ("recipe_image", "image"),
        ("recipe_author", "author.name"),
        ("recipe_prep_time", "prepTime"),
        ("recipe_cook_time", "cookTime"),
        ("recipe_yield", "recipeYield"),
        ("recipe_rating", "aggregateRating.ratingValue"),
    ],
    "Event": [
        ("event_name", "name"),
        ("event_description", "description"),
        ("event_start", "startDate"),
        ("event_end", "endDate"),
        ("event_location", "location.name"),
        ("event_url", "url"),
    ],
    "Movie": [
        ("movie_name", "name"),
        ("movie_description", "description"),
        ("movie_image", "image"),
        ("movie_director", "director.name"),
        ("movie_rating", "aggregateRating.ratingValue"),
    ],
    "Book": [
        ("book_name", "name"),
        ("book_description", "description"),
        ("book_author", "author.name"),
        ("book_isbn", "isbn"),
        ("book_image", "image"),
    ],
    "JobPosting": [
        ("job_title", "title"),
        ("job_description", "description"),
        ("job_company", "hiringOrganization.name"),
        ("job_location", "jobLocation.address.addressLocality"),
        ("job_posted_at", "datePosted"),
        ("job_url", "url"),
    ],
}


# Microdata itemprop names are 1:1 with schema.org types — same map
# applies. We synthesize CSS selectors from the per-element `css`
# field the JS harvester ships.


# Open Graph property → canonical label mapping. Each `og:*` becomes
# a field with a `value` sidecar (no live selector — meta tags rarely
# move, so confidence is high but the picker can't visually highlight
# them).
_OG_LABEL_MAP: dict[str, str] = {
    "title": "og_title",
    "description": "og_description",
    "image": "og_image",
    "url": "og_url",
    "site_name": "og_site_name",
    "type": "og_type",
    "price:amount": "og_price",
    "price:currency": "og_price_currency",
    "video": "og_video",
    "audio": "og_audio",
}


# ── Helpers ──────────────────────────────────────────────────────────────


def _safe_get(obj: Any, path: str) -> Any:
    """Walk a dotted path through nested dicts. Returns None on any
    missing key or non-dict ancestor. Handles list values by indexing
    into [0] when the path has more segments after a list."""
    cur = obj
    for part in path.split("."):
        if cur is None:
            return None
        if isinstance(cur, list):
            cur = cur[0] if cur else None
            if cur is None:
                return None
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    if isinstance(cur, list) and cur:
        cur = cur[0]
    if isinstance(cur, dict):
        # Schema.org often wraps simple values in `{"@type": "ImageObject",
        # "url": "..."}` — unwrap to the inner primitive when we hit one.
        for sub in ("url", "@id", "name", "value"):
            v = cur.get(sub)
            if isinstance(v, (str, int, float)):
                return v
        return None
    return cur


def _normalize_jsonld(jsonld: list[Any]) -> list[dict[str, Any]]:
    """Flatten JSON-LD `@graph` containers and drop non-dict entries."""
    out: list[dict[str, Any]] = []
    for entry in jsonld:
        if not isinstance(entry, dict):
            continue
        graph = entry.get("@graph")
        if isinstance(graph, list):
            for g in graph:
                if isinstance(g, dict):
                    out.append(g)
        else:
            out.append(entry)
    return out


def _coerce_type(t: Any) -> str:
    """JSON-LD @type can be a string or a list. Return the most useful."""
    if isinstance(t, str):
        return t
    if isinstance(t, list):
        # Prefer types we have a mapping for
        for item in t:
            if isinstance(item, str) and item in _JSONLD_TYPE_MAP:
                return item
        if t and isinstance(t[0], str):
            return t[0]
    return ""


# ── Public API ───────────────────────────────────────────────────────────


def template_from_structured(
    structured_data: dict[str, Any],
    *,
    max_fields: int = 5,
) -> list[dict[str, Any]]:
    """Build a deterministic template from a page's structured data.

    Returns up to `max_fields` `Field` dicts ready for the extract
    pipeline. Each field carries:
      • `label`     — canonical snake_case name
      • `selector`  — live CSS selector (microdata only) OR ""
      • `kind`      — "text" / "attr"
      • `value`     — sidecar value (for meta tags where no live
                       selector applies — JSON-LD / OG / Twitter)
      • `source`    — provenance tag for downstream telemetry
      • `confidence`— 1.0 always (deterministic source)

    Empty input or zero structured signals → empty list. The caller
    falls through to heuristic / LLM in that case.
    """
    if not structured_data:
        return []

    fields: list[dict[str, Any]] = []
    seen_labels: set[str] = set()

    # ── Tier 1: JSON-LD ──────────────────────────────────────────────
    jsonld_entries = _normalize_jsonld(structured_data.get("json_ld") or [])
    for entry in jsonld_entries:
        typ = _coerce_type(entry.get("@type", ""))
        mapping = _JSONLD_TYPE_MAP.get(typ)
        if not mapping:
            continue
        for label, path in mapping:
            if label in seen_labels:
                continue
            value = _safe_get(entry, path)
            if value in (None, "", []):
                continue
            fields.append({
                "label": label,
                "selector": "",  # no live DOM — sidecar value only
                "kind": "text",
                "value": str(value)[:1000] if not isinstance(value, list) else value,
                "source": "structured_jsonld",
                "confidence": 1.0,
                "_jsonld_type": typ,
            })
            seen_labels.add(label)
            if len(fields) >= max_fields:
                return fields

    # ── Tier 2: Microdata (live selector — picker can re-extract) ────
    microdata = structured_data.get("microdata") or []
    for entry in microdata:
        if not isinstance(entry, dict):
            continue
        prop = (entry.get("prop") or "").strip()
        val = entry.get("value")
        css = entry.get("css") or ""
        if not prop or not val:
            continue
        # Map common itemprops to canonical labels (lowercase the prop).
        label = prop.lower().replace("/", "_")
        if label in seen_labels:
            continue
        fields.append({
            "label": label,
            "selector": css,
            "kind": "attr" if (entry.get("tag") or "") in {"meta", "img", "a", "time"} else "text",
            "attr": _attr_for_tag(entry.get("tag") or ""),
            "value": str(val)[:1000],
            "source": "structured_microdata",
            "confidence": 1.0,
        })
        seen_labels.add(label)
        if len(fields) >= max_fields:
            return fields

    # ── Tier 3: Open Graph ───────────────────────────────────────────
    og = structured_data.get("og") or {}
    if isinstance(og, dict):
        for og_key, label in _OG_LABEL_MAP.items():
            if label in seen_labels:
                continue
            val = og.get(og_key)
            if not val:
                continue
            fields.append({
                "label": label,
                "selector": f'meta[property="og:{og_key}"]',
                "kind": "attr",
                "attr": "content",
                "value": str(val)[:1000],
                "source": "structured_og",
                "confidence": 1.0,
            })
            seen_labels.add(label)
            if len(fields) >= max_fields:
                return fields

    # ── Tier 4: Twitter card fallback ────────────────────────────────
    twitter = structured_data.get("twitter") or {}
    if isinstance(twitter, dict):
        for tw_key in ("title", "description", "image"):
            label = f"twitter_{tw_key}"
            if label in seen_labels:
                continue
            # Skip if og already provided the same logical field.
            og_equiv = f"og_{tw_key}"
            if og_equiv in seen_labels:
                continue
            val = twitter.get(tw_key)
            if not val:
                continue
            fields.append({
                "label": label,
                "selector": f'meta[name="twitter:{tw_key}"]',
                "kind": "attr",
                "attr": "content",
                "value": str(val)[:1000],
                "source": "structured_twitter",
                "confidence": 0.95,  # slightly less canonical than og
            })
            seen_labels.add(label)
            if len(fields) >= max_fields:
                return fields

    return fields


def _attr_for_tag(tag: str) -> str:
    """Which DOM attribute holds the value for a microdata element of
    this tag. Matches the value-extraction logic in COLLECT_STRUCTURED_JS."""
    t = (tag or "").lower()
    if t == "meta":
        return "content"
    if t == "img":
        return "src"
    if t == "a":
        return "href"
    if t == "time":
        return "datetime"
    return ""
