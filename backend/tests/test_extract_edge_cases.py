"""Regression tests for extraction edge cases.

Pins the failure modes that drove the user's "extraction always breaks"
frustration. Each test is structural — no site-specific code anywhere
in the codebase. If a test here ever fails after a refactor, that's a
real regression of the bug class, not a false alarm.

Edge cases covered:
  1. Split-price climb — `<span>$</span><span>199</span><span>.99</span>`
  2. Lazy `data-src` / `srcset` fallback for empty/placeholder src
  3. Comma-fanout list selector — `_pull_lists_per_row` no longer skips
  4. All-empty list values produce honest null (already shipped — pinned)
  5. Aria-hidden duplicate (Amazon's a-offscreen mirror) — pinned
  6. Two `data-testid` siblings on the same row don't collapse to one
"""

from __future__ import annotations

import lxml.html as lxml_html

from app.extract import (
    _is_placeholder_src,
    _maybe_join_split_price,
    _pull,
    _pull_lists_per_row,
    _read,
)


# ── 1. Split-price climb ─────────────────────────────────────────────────


def test_split_price_climbs_when_only_currency_extracted():
    """Picker clicked the dollar sign of a split price layout. The
    extracted text is just '$'. We should climb to the parent and
    return the joined '$199.99'."""
    html = """
    <html><body>
      <div class="card">
        <span class="price-wrap">
          <span class="sym">$</span><span class="whole">199</span><span class="frac">.99</span>
        </span>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {
        "label": "price",
        "kind": "text",
        "selector": "span.sym",
    }
    result = _pull(tree, field)
    # Without climb: "$"; with climb: "$199.99".
    assert result["value"] == "$199.99", result


def test_split_price_climbs_for_euro():
    """Same climb logic works for any of $ € £ ¥ ₹ ₽."""
    html = """
    <html><body>
      <p class="price">
        <span class="c">€</span><span class="d">19</span><span class="f">,99</span>
      </p>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "price", "kind": "text", "selector": "span.c"}
    assert _pull(tree, field)["value"] == "€19,99"


def test_split_price_does_not_climb_when_parent_is_unrelated():
    """If the parent's joined text isn't a price pattern (e.g. it
    includes 'Tax included' alongside the currency symbol), do NOT
    climb. Returning the unrelated parent text would be a regression."""
    html = """
    <html><body>
      <div class="info">
        <span class="sym">$</span><span class="note">Tax included</span>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "currency", "kind": "text", "selector": "span.sym"}
    # Joined text "$Tax included" doesn't match the price pattern → no
    # climb → returns just the symbol.
    assert _pull(tree, field)["value"] == "$"


def test_split_price_unit_helper_returns_none_for_normal_text():
    """The helper must be a no-op for any element whose text isn't a
    stranded currency symbol — guards against perf overhead + false
    climbs on normal pages."""
    html = '<html><body><span>Normal title text</span></body></html>'
    tree = lxml_html.fromstring(html)
    span = tree.cssselect("span")[0]
    assert _maybe_join_split_price(span, "Normal title text") is None


# ── 2. Lazy data-src / srcset fallback ───────────────────────────────────


def test_lazy_data_src_used_when_src_empty():
    html = '<html><body><img src="" data-src="https://cdn.example.com/x.jpg"/></body></html>'
    tree = lxml_html.fromstring(html)
    img = tree.cssselect("img")[0]
    assert _read(img, "attr", "src") == "https://cdn.example.com/x.jpg"


def test_lazy_data_src_used_when_src_is_tiny_data_uri():
    """A 1x1 placeholder gif data URI counts as a placeholder. Real
    CDN URL in data-src should win."""
    html = (
        '<html><body><img '
        'src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" '
        'data-src="https://cdn.example.com/real.jpg"/></body></html>'
    )
    tree = lxml_html.fromstring(html)
    img = tree.cssselect("img")[0]
    assert _read(img, "attr", "src") == "https://cdn.example.com/real.jpg"


def test_real_src_wins_over_data_src():
    """When BOTH a real src and a data-src are present, real src wins
    (the placeholder check correctly rejects only placeholders)."""
    html = (
        '<html><body><img '
        'src="https://cdn.example.com/loaded.jpg" '
        'data-src="https://cdn.example.com/placeholder.jpg"/></body></html>'
    )
    tree = lxml_html.fromstring(html)
    img = tree.cssselect("img")[0]
    assert _read(img, "attr", "src") == "https://cdn.example.com/loaded.jpg"


def test_srcset_first_url_used_when_no_other_fallback():
    """If src is empty AND data-src isn't present, take the first URL
    from srcset (the responsive picker's default)."""
    html = (
        '<html><body><img src="" '
        'srcset="https://cdn.example.com/sm.jpg 200w, https://cdn.example.com/md.jpg 800w"/>'
        '</body></html>'
    )
    tree = lxml_html.fromstring(html)
    img = tree.cssselect("img")[0]
    assert _read(img, "attr", "src") == "https://cdn.example.com/sm.jpg"


def test_is_placeholder_src_unit():
    """The placeholder detector handles known patterns."""
    assert _is_placeholder_src("") is True
    assert _is_placeholder_src("#") is True
    assert _is_placeholder_src("about:blank") is True
    # Tiny 1x1 gif → placeholder
    assert _is_placeholder_src(
        "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
    ) is True
    # Real CDN URL → not a placeholder
    assert _is_placeholder_src("https://images.unsplash.com/photo-1.jpg") is False


# ── 3. Comma-fanout list selector ────────────────────────────────────────


def test_pull_lists_per_row_admits_comma_selectors():
    """Previously _pull_lists_per_row silently skipped any field whose
    selector contained a comma. Now we admit them and rely on DOM-LCA
    (cssselect handles unions natively)."""
    html = """
    <html><body>
      <div class="grid">
        <article class="card">
          <h3>Item A</h3>
          <span class="now-price">$10</span>
        </article>
        <article class="card">
          <h3>Item B</h3>
          <span class="now-price">$20</span>
        </article>
        <article class="card">
          <h3>Item C</h3>
          <span class="now-price">$30</span>
        </article>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    # The price selector uses a comma to match either of two class names
    # (a real pattern when sites A/B-test class names).
    template = [
        {"label": "title", "kind": "list", "selector": "div.grid > article.card > h3"},
        {
            "label": "price",
            "kind": "list",
            "selector": (
                "div.grid > article.card > span.now-price, "
                "div.grid > article.card > span.was-price"
            ),
        },
    ]
    values, handled = _pull_lists_per_row(tree, template)
    # Title and price BOTH handled (the old code would skip price).
    assert "title" in handled and "price" in handled, handled
    assert values["title"] == ["Item A", "Item B", "Item C"], values
    assert values["price"] == ["$10", "$20", "$30"], values


# ── 4. All-empty list values produce honest null (pinned) ────────────────


def test_all_empty_list_returns_half_confidence_with_reason():
    """`_pull` for kind=list: if selector matched N nodes but every
    extracted value was empty after filtering, the envelope must
    report it honestly — confidence 0.5 (selector hit) + null value +
    a reason_if_null saying nodes were matched but empty."""
    html = """
    <html><body>
      <ul>
        <li class="row"><span class="name"></span></li>
        <li class="row"><span class="name"></span></li>
        <li class="row"><span class="name"></span></li>
      </ul>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {
        "label": "name",
        "kind": "list",
        "selector": "ul > li.row > span.name",
    }
    result = _pull(tree, field)
    # Selector hit (3 nodes) but all empty → null + 0.5 confidence +
    # informative reason.
    assert result["value"] == [], result
    assert result["confidence"] == 0.5, result
    assert "empty" in (result.get("reason_if_null") or "").lower(), result


# ── 5. Aria-hidden duplicate (Amazon a-offscreen) (pinned) ──────────────


def test_aria_hidden_duplicate_not_concatenated():
    """Amazon renders price twice — once visible, once screen-reader
    only (`<span class="a-offscreen" aria-hidden="false">$199.99`).
    Clicking the visible span and extracting text must NOT return
    `$199.99$199.99`. The `_visible_text` 3-pass strategy filters
    the duplicate copy."""
    html = """
    <html><body>
      <span class="a-price">
        <span aria-hidden="true">$</span>
        <span aria-hidden="true">199</span>
        <span aria-hidden="true">.</span>
        <span aria-hidden="true">99</span>
        <span class="a-offscreen">$199.99</span>
      </span>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "price", "kind": "text", "selector": "span.a-price"}
    result = _pull(tree, field)
    # The visible-text extractor either returns the joined visible
    # ($199.99 from the aria-hidden=true spans is filtered, but
    # a-offscreen still has the text) OR the screen-reader fallback
    # ($199.99). Either way, NO doubled value.
    val = result["value"] or ""
    assert val.count("$") <= 1, f"price doubled: {val!r}"
    assert "$199" in val or val == "", val


# ── 6. Two data-testid siblings on the same row don't collapse ──────────


def test_two_data_testid_siblings_extract_distinctly():
    """Cards with both `data-testid='price-current'` and
    `data-testid='price-was'` — picker should be able to capture
    them as two separate fields with distinct selectors, and
    per-row extraction should return both lists correctly aligned."""
    html = """
    <html><body>
      <div class="grid">
        <article class="card">
          <h3>Alpha</h3>
          <span data-testid="price-was">$50</span>
          <span data-testid="price-current">$30</span>
        </article>
        <article class="card">
          <h3>Beta</h3>
          <span data-testid="price-was">$80</span>
          <span data-testid="price-current">$60</span>
        </article>
        <article class="card">
          <h3>Gamma</h3>
          <span data-testid="price-was">$100</span>
          <span data-testid="price-current">$75</span>
        </article>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "title", "kind": "list",
         "selector": "div.grid > article.card > h3"},
        {"label": "was", "kind": "list",
         "selector": 'div.grid > article.card > span[data-testid="price-was"]'},
        {"label": "current", "kind": "list",
         "selector": 'div.grid > article.card > span[data-testid="price-current"]'},
    ]
    values, handled = _pull_lists_per_row(tree, template)
    assert {"title", "was", "current"}.issubset(handled), handled
    assert values["title"] == ["Alpha", "Beta", "Gamma"]
    assert values["was"] == ["$50", "$80", "$100"]
    assert values["current"] == ["$30", "$60", "$75"]


if __name__ == "__main__":
    import sys
    tests = [
        test_split_price_climbs_when_only_currency_extracted,
        test_split_price_climbs_for_euro,
        test_split_price_does_not_climb_when_parent_is_unrelated,
        test_split_price_unit_helper_returns_none_for_normal_text,
        test_lazy_data_src_used_when_src_empty,
        test_lazy_data_src_used_when_src_is_tiny_data_uri,
        test_real_src_wins_over_data_src,
        test_srcset_first_url_used_when_no_other_fallback,
        test_is_placeholder_src_unit,
        test_pull_lists_per_row_admits_comma_selectors,
        test_all_empty_list_returns_half_confidence_with_reason,
        test_aria_hidden_duplicate_not_concatenated,
        test_two_data_testid_siblings_extract_distinctly,
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
        sys.exit(1)
    print("\nALL PASS")
