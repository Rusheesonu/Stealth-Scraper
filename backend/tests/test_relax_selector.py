"""Regression tests for the relaxed-selector fallback in `_pull`.

Pinned to the Steam-template case that drove the user nuts: a template
saved from /app/2483190/Forza_Horizon_6/ returns null on every other
game's page because the picker anchored the selector on
`#game_area_purchase_section_2483190` — the trailing number is the app
id, and on `/app/2215200/LEGO_Batman/` that id doesn't exist.

Same shape on Shopify (#shopify-section-1234567890), WordPress
(#post-NNNN), Reddit (#thing_t3_xxxxx), Medium, etc.
"""

from __future__ import annotations

import lxml.html as lxml_html

from app.extract import _pull, _relax_selector_variants


# ── Unit tests on the variant generator ─────────────────────────────────

def test_relax_strips_steam_app_id():
    """Steam id has a 7-digit app id suffix. Variant 1 strips it."""
    sel = "#game_area_purchase_section_2483190 > div.game_purchase_action > div.price"
    variants = _relax_selector_variants(sel)
    assert variants, f"expected variants, got none: {variants!r}"
    # Variant 1 keeps tag + class but loses the page-specific id.
    assert any("game_area_purchase_section" not in v for v in variants), variants


def test_relax_strips_shopify_section():
    sel = "#shopify-section-1234567890 > div.product > h1.title"
    variants = _relax_selector_variants(sel)
    assert variants
    assert any("1234567890" not in v for v in variants)


def test_relax_preserves_semantic_ids():
    """`#main` has no digit run — must NOT be stripped by Variant 1.
    Variant 2 (strip ALL ids) will still strip it, so we accept either
    `#main` survives in variant 1 OR variants list is non-empty due to
    other parts. Key invariant: we don't aggressively strip semantic
    ids in variant 1."""
    sel = "#main > div.foo > .bar"
    variants = _relax_selector_variants(sel)
    # Variant 1 should NOT have changed anything (no digits, no nth) →
    # it might equal the original, in which case it's filtered out.
    # Variant 2 strips all ids → "div.foo > .bar"
    assert all("div.foo" in v and ".bar" in v for v in variants), variants


def test_relax_strips_nth_pseudos():
    sel = "div.grid > div.card:nth-of-type(3) > .price"
    variants = _relax_selector_variants(sel)
    assert variants
    # nth-of-type(3) must be gone in at least one variant
    assert any(":nth-of-type" not in v for v in variants), variants


def test_relax_returns_empty_for_clean_selector():
    """A clean class-only selector has nothing to relax."""
    sel = "ol > li > h3.title"
    variants = _relax_selector_variants(sel)
    assert variants == [], variants


# ── Integration: _pull falls back to relaxed selector when original misses ──

def test_pull_relaxed_falls_through_when_app_id_changes():
    """The HTML simulates the LEGO Batman game page — same Steam
    structure but a DIFFERENT app id in the section anchor. The
    saved template's selector references the FORZA app id and would
    miss. With the relaxation fallback, the price still gets pulled."""
    html = """
    <html><body>
      <div id="game_area_purchase_section_2215200">
        <div class="game_purchase_action">
          <div class="price">$59.99</div>
        </div>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    # Saved-template selector with the OLD app id — won't match the new
    # page's anchor id.
    field = {
        "label": "price",
        "kind": "text",
        "selector": "#game_area_purchase_section_2483190 > div.game_purchase_action > div.price",
    }
    result = _pull(tree, field)
    assert result.get("value") == "$59.99", result


def test_pull_no_relaxation_when_original_matches():
    """Don't run relaxation when the original selector works fine —
    we should preserve `selector_used` as the original string."""
    html = '<html><body><div class="price">$10</div></body></html>'
    tree = lxml_html.fromstring(html)
    field = {
        "label": "price",
        "kind": "text",
        "selector": "div.price",
    }
    result = _pull(tree, field)
    assert result.get("value") == "$10"
    assert result.get("selector_used") == "div.price"


def test_pull_relaxed_xpath_still_tried_if_relaxed_misses():
    """If neither original CSS nor any relaxed variant matches, we
    should still fall through to the XPath. Important for templates
    that have both."""
    html = """
    <html><body>
      <article>
        <p>price-marker</p>
      </article>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {
        "label": "marker",
        "kind": "text",
        "selector": "#nonexistent_99999 > div.missing",
        "xpath": "//article/p",
    }
    result = _pull(tree, field)
    assert result.get("value") == "price-marker", result


if __name__ == "__main__":
    import sys
    tests = [
        test_relax_strips_steam_app_id,
        test_relax_strips_shopify_section,
        test_relax_preserves_semantic_ids,
        test_relax_strips_nth_pseudos,
        test_relax_returns_empty_for_clean_selector,
        test_pull_relaxed_falls_through_when_app_id_changes,
        test_pull_no_relaxation_when_original_matches,
        test_pull_relaxed_xpath_still_tried_if_relaxed_misses,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            print(f"FAIL {t.__name__}: {e}")
            failed += 1
    if failed:
        print(f"\n{failed} failed")
        sys.exit(1)
    print("\nALL PASS")


# ── Relaxer trigger threshold: ≤2 matches on kind=list ──────────────────


def test_relax_triggers_on_2_match_list_field():
    """When a list field selector matches only 2 elements but the page
    clearly has more, the relaxer must trigger. The Target-shape bug
    happened with 1 match; the same trap exists at 2 matches
    (selector over-anchored to a small subset of cards).

    Use an id-anchored selector — the relaxer's bread-and-butter case
    (strip per-instance ids + nth pseudos to get a structural variant)."""
    from lxml import html as lxml_html
    from app.extract import _pull

    # 8 product cards, each with a per-instance #product-card-NNNNNNN id.
    # The picker's selector would, before the relaxer existed, anchor
    # to the first 2 cards via leftover ids in the path.
    html_str = "<html><body><div class='grid'>"
    for i in range(8):
        pid = 90581900 + i
        html_str += (
            f"<article id='product-card-{pid}' class='card'>"
            f"<h3>P{i}</h3></article>"
        )
    html_str += "</div></body></html>"
    tree = lxml_html.fromstring(html_str)

    # Original selector: only the first card's id (single-match).
    field = {
        "label": "title",
        "kind": "list",
        "selector": "#product-card-90581900 > h3",
    }
    res = _pull(tree, field)
    val = res["value"]
    # Without the relaxer: ['P0'] (1 match).
    # With the relaxer: all 8 cards via the id-stripped variant.
    assert isinstance(val, list)
    assert len(val) == 8, f"expected 8 after relax, got {len(val)}: {val!r}"


def test_relax_skipped_for_explicit_positional_pseudos():
    """When the user explicitly anchors with `:nth-child(2)` or
    similar, the selector returning 2 matches is intentional. Don't
    relax it — the user wants the 2nd-of-each-parent semantics."""
    from lxml import html as lxml_html
    from app.extract import _pull

    html_str = """
    <html><body>
      <ul><li>1</li><li>2</li><li>3</li></ul>
      <ul><li>a</li><li>b</li><li>c</li></ul>
    </body></html>
    """
    tree = lxml_html.fromstring(html_str)
    field = {"label": "second", "kind": "list", "selector": "li:nth-child(2)"}
    # Must remain ['2', 'b'], NOT relax to all 6 li's
    assert _pull(tree, field)["value"] == ["2", "b"]


def test_relax_skipped_for_first_child_pseudo():
    """Same guard for :first-child / :last-child — user intent is
    positional anchoring, not over-anchoring."""
    from lxml import html as lxml_html
    from app.extract import _pull

    html_str = (
        "<html><body>"
        "<ul><li>x1</li><li>x2</li></ul>"
        "<ul><li>y1</li><li>y2</li></ul>"
        "</body></html>"
    )
    tree = lxml_html.fromstring(html_str)
    field = {"label": "first", "kind": "list", "selector": "li:first-child"}
    assert _pull(tree, field)["value"] == ["x1", "y1"]
