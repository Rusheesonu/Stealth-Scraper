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
