"""Tests for the deterministic-first structured-data layer.

These pin the behavior of `template_from_structured` against
realistic JSON-LD / Open Graph / microdata fixtures so the
priority ordering and the schema.org type → label mapping don't
silently regress.
"""

from __future__ import annotations

import pytest

from app.structured import template_from_structured, _safe_get, _coerce_type


# ── _safe_get path walker ────────────────────────────────────────────────


def test_safe_get_simple_path():
    obj = {"name": "Tea", "offers": {"price": "9.99", "priceCurrency": "USD"}}
    assert _safe_get(obj, "name") == "Tea"
    assert _safe_get(obj, "offers.price") == "9.99"
    assert _safe_get(obj, "offers.priceCurrency") == "USD"


def test_safe_get_missing_path_returns_none():
    assert _safe_get({}, "x.y.z") is None
    assert _safe_get({"x": {}}, "x.y") is None


def test_safe_get_unwraps_schemaorg_image_object():
    """JSON-LD frequently nests image as `{"@type": "ImageObject", "url": "..."}`.
    The walker should unwrap to the primitive."""
    obj = {"image": {"@type": "ImageObject", "url": "https://x.com/a.jpg"}}
    assert _safe_get(obj, "image") == "https://x.com/a.jpg"


def test_safe_get_handles_list_at_leaf():
    obj = {"image": ["https://a.jpg", "https://b.jpg"]}
    assert _safe_get(obj, "image") == "https://a.jpg"


def test_coerce_type_string_passthrough():
    assert _coerce_type("Product") == "Product"


def test_coerce_type_list_picks_mapped_type():
    """When @type is a list, prefer types we have a mapping for."""
    assert _coerce_type(["Thing", "Product"]) == "Product"
    assert _coerce_type(["Unknown1", "Unknown2"]) == "Unknown1"


# ── JSON-LD path ─────────────────────────────────────────────────────────


def test_jsonld_product_emits_expected_fields():
    """Single JSON-LD Product → labeled fields with confidence 1.0."""
    structured = {
        "json_ld": [
            {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "Tea Cup",
                "description": "A simple cup.",
                "image": "https://x.com/cup.jpg",
                "offers": {
                    "@type": "Offer",
                    "price": "19.99",
                    "priceCurrency": "USD",
                },
                "aggregateRating": {
                    "ratingValue": "4.5",
                    "reviewCount": "127",
                },
            }
        ],
    }
    fields = template_from_structured(structured, max_fields=10)
    labels = [f["label"] for f in fields]
    assert "product_name" in labels
    assert "product_price" in labels
    assert "product_currency" in labels
    assert "product_rating" in labels
    assert "product_review_count" in labels
    # All from JSON-LD = confidence 1.0
    for f in fields:
        if f["source"] == "structured_jsonld":
            assert f["confidence"] == 1.0
    # And the price value is right
    price = next(f for f in fields if f["label"] == "product_price")
    assert price["value"] == "19.99"


def test_jsonld_graph_container_flattened():
    """JSON-LD `@graph` should be unwrapped — each child treated as
    its own entry."""
    structured = {
        "json_ld": [
            {
                "@context": "https://schema.org",
                "@graph": [
                    {"@type": "NewsArticle", "headline": "Big News", "author": {"name": "Jane"}},
                    {"@type": "BreadcrumbList"},  # ignored — no mapping
                ],
            }
        ],
    }
    fields = template_from_structured(structured)
    headline = next((f for f in fields if f["label"] == "headline"), None)
    assert headline is not None
    assert headline["value"] == "Big News"


def test_jsonld_news_article_emits_author_and_publish_date():
    structured = {
        "json_ld": [
            {
                "@type": "NewsArticle",
                "headline": "Headline",
                "author": {"name": "Jane Doe"},
                "datePublished": "2026-05-22T08:00:00Z",
            }
        ],
    }
    fields = template_from_structured(structured)
    labels = {f["label"] for f in fields}
    assert "headline" in labels
    assert "author" in labels
    assert "published_at" in labels


def test_jsonld_unknown_type_yields_nothing():
    """Schema.org types we don't have a mapping for shouldn't crash —
    they just produce no fields."""
    structured = {
        "json_ld": [{"@type": "BreadcrumbList", "name": "Crumbs"}],
    }
    assert template_from_structured(structured) == []


# ── Open Graph path ──────────────────────────────────────────────────────


def test_og_meta_emits_fields():
    structured = {
        "og": {
            "title": "Page Title",
            "description": "Page description.",
            "image": "https://x.com/og.png",
            "url": "https://x.com/page",
        },
    }
    fields = template_from_structured(structured)
    labels = {f["label"] for f in fields}
    assert "og_title" in labels
    assert "og_description" in labels
    assert "og_image" in labels
    # OG fields carry a live selector that targets the meta tag
    og_title = next(f for f in fields if f["label"] == "og_title")
    assert og_title["selector"] == 'meta[property="og:title"]'
    assert og_title["attr"] == "content"
    assert og_title["value"] == "Page Title"


def test_jsonld_takes_precedence_over_og():
    """Same logical field via both sources — JSON-LD wins because it
    runs first in the pipeline."""
    structured = {
        "json_ld": [
            {"@type": "Article", "headline": "JSON-LD headline"},
        ],
        "og": {
            "title": "OG title",
        },
    }
    fields = template_from_structured(structured)
    # JSON-LD produces `headline`; OG produces `og_title` — different
    # canonical labels, BOTH come through (no conflict). The point of
    # the test: JSON-LD entries appear FIRST in the field list.
    sources = [f["source"] for f in fields]
    assert sources[0] == "structured_jsonld"


# ── Twitter card path ────────────────────────────────────────────────────


def test_twitter_only_fills_when_og_absent():
    """When OG provides title, the Twitter card title should NOT be
    emitted again under a different label — that would just be noise."""
    structured = {
        "og": {"title": "Real title", "image": "https://x.com/og.png"},
        "twitter": {"title": "Same title", "description": "Twitter desc"},
    }
    fields = template_from_structured(structured)
    labels = {f["label"] for f in fields}
    # og_title was emitted, so twitter_title should be skipped
    assert "og_title" in labels
    assert "twitter_title" not in labels
    # twitter_description has no og equivalent provided → should appear
    assert "twitter_description" in labels


def test_twitter_alone_when_no_og():
    structured = {"twitter": {"title": "T-title", "image": "https://x.com/tw.png"}}
    fields = template_from_structured(structured)
    labels = {f["label"] for f in fields}
    assert "twitter_title" in labels
    assert "twitter_image" in labels


# ── Microdata path ───────────────────────────────────────────────────────


def test_microdata_emits_fields_with_live_selector():
    """Microdata items carry a live CSS selector — the picker can
    re-extract from the DOM (unlike OG meta tags which only have a
    sidecar value)."""
    structured = {
        "microdata": [
            {"prop": "name", "value": "iPhone 15", "tag": "h1",
             "css": "div.product > h1"},
            {"prop": "price", "value": "999.00", "tag": "span",
             "css": "span.price"},
            {"prop": "image", "value": "/img.jpg", "tag": "img",
             "css": "img.hero"},
        ],
    }
    fields = template_from_structured(structured)
    labels = {f["label"] for f in fields}
    assert "name" in labels
    assert "price" in labels
    assert "image" in labels
    # Live selectors honored
    name = next(f for f in fields if f["label"] == "name")
    assert name["selector"] == "div.product > h1"
    # image is on a <img> tag → attr="src"
    img = next(f for f in fields if f["label"] == "image")
    assert img["attr"] == "src"
    assert img["kind"] == "attr"


# ── Top-level guarantees ─────────────────────────────────────────────────


def test_empty_input_yields_empty_template():
    assert template_from_structured({}) == []
    assert template_from_structured({"json_ld": [], "og": {}, "twitter": {}, "microdata": []}) == []


def test_max_fields_respected():
    """A page with 20 fields worth of structured data should still
    cap to max_fields."""
    structured = {
        "json_ld": [{
            "@type": "Product",
            "name": "n", "description": "d", "image": "i",
            "offers": {"price": "1", "priceCurrency": "USD"},
        }],
        "og": {"title": "t", "description": "d", "image": "i", "url": "u"},
    }
    fields = template_from_structured(structured, max_fields=3)
    assert len(fields) == 3


def test_no_field_has_null_value():
    """Empty / null values must be skipped — silent-null prevention."""
    structured = {
        "json_ld": [{
            "@type": "Product",
            "name": "Real",
            "description": "",       # empty → skip
            "offers": {"price": None},  # null → skip
        }],
    }
    fields = template_from_structured(structured)
    # `product_name` makes it; `product_description` and `product_price`
    # are dropped because they're empty.
    labels = {f["label"] for f in fields}
    assert "product_name" in labels
    assert "product_description" not in labels
    assert "product_price" not in labels


# ── Multi-row microdata → list kind ─────────────────────────────────────


def test_microdata_multi_row_promotes_to_list_kind():
    """When the SAME itemprop appears N>=2 times on the page (the
    canonical "list page" shape: quotes.toscrape ships 10 quotes,
    each with itemprop="text" / "author" / "keywords"; product
    listings repeat itemprop="name" + "price" once per card), the
    field MUST be kind="list" so the extractor walks every match.

    The old behavior emitted kind="text" and silently dropped the
    remaining N-1 rows — the picker correctly identified "N similar"
    but the auto-suggester quietly degraded the field to "first match
    only", and /snapshot-and-suggest showed one canonical value
    when the user could see ten. See app/structured.py Tier-2.
    """
    structured = {
        "microdata": [
            # 10 quotes, each shipping the same triple of itemprops.
            *[
                {"prop": "text", "value": f"Quote {i}", "tag": "span",
                 "css": "div.quote > span.text"}
                for i in range(10)
            ],
            *[
                {"prop": "author", "value": f"Author {i}", "tag": "small",
                 "css": "div.quote > span > small.author"}
                for i in range(10)
            ],
            *[
                {"prop": "keywords", "value": f"k{i},l{i}", "tag": "meta",
                 "css": "div.quote > div.tags > meta.keywords"}
                for i in range(10)
            ],
        ],
    }
    fields = template_from_structured(structured, max_fields=5)
    labels = {f["label"]: f for f in fields}
    # All three multi-occurrence itemprops are present and kind="list"
    for lbl in ("text", "author", "keywords"):
        assert lbl in labels, f"missing {lbl}; got {list(labels)}"
        assert labels[lbl]["kind"] == "list", (
            f"{lbl} should be kind=list when itemprop repeats; got "
            f"kind={labels[lbl]['kind']!r}"
        )


def test_microdata_single_occurrence_stays_scalar():
    """Negative case: when each itemprop appears once, kind stays
    text / attr — single-value pages (a Product detail page, an
    Article) shouldn't be promoted to lists."""
    structured = {
        "microdata": [
            {"prop": "name", "value": "iPhone 15", "tag": "h1",
             "css": "h1.title"},
            {"prop": "price", "value": "999.00", "tag": "span",
             "css": "span.price"},
            {"prop": "image", "value": "/i.jpg", "tag": "img",
             "css": "img.hero"},
        ],
    }
    fields = template_from_structured(structured)
    by_label = {f["label"]: f for f in fields}
    assert by_label["name"]["kind"] == "text"
    assert by_label["price"]["kind"] == "text"
    assert by_label["image"]["kind"] == "attr"  # img tag → attr=src


def test_microdata_mixed_occurrence_per_prop():
    """The page may have N repeats of one prop and a single global
    of another (e.g. a list page with a per-card `name` but a
    single page-level `breadcrumb`). Each prop is judged
    independently by its own count, not the global max."""
    structured = {
        "microdata": [
            {"prop": "breadcrumb", "value": "Home > Books", "tag": "nav",
             "css": "nav.breadcrumb"},
            *[
                {"prop": "name", "value": f"Book {i}", "tag": "h3",
                 "css": "article.product > h3"}
                for i in range(4)
            ],
        ],
    }
    fields = template_from_structured(structured)
    by_label = {f["label"]: f for f in fields}
    assert by_label["breadcrumb"]["kind"] == "text"
    assert by_label["name"]["kind"] == "list"
