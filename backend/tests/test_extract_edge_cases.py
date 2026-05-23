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



# ── 7. Image alt-text fallback when kind=text on an <img> ───────────────


def test_img_alt_text_fallback_when_kind_text():
    """`<img>` has no text content. When the picker clicks an image
    and selects kind=text, _read should fall back to the `alt`
    attribute rather than returning an empty string."""
    html = (
        '<html><body><img class="hero" '
        'src="https://cdn.example.com/x.jpg" '
        'alt="Vintage leather jacket"/></body></html>'
    )
    tree = lxml_html.fromstring(html)
    field = {"label": "alt", "kind": "text", "selector": "img.hero"}
    result = _pull(tree, field)
    assert result["value"] == "Vintage leather jacket", result


def test_img_alt_text_fallback_in_list():
    """List kind on imgs should also yield alts."""
    html = """
    <html><body>
      <div class="grid">
        <img class="card" alt="Alpha" src="/a.jpg"/>
        <img class="card" alt="Beta" src="/b.jpg"/>
        <img class="card" alt="Gamma" src="/g.jpg"/>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "alts", "kind": "list", "selector": "img.card"}
    result = _pull(tree, field)
    assert result["value"] == ["Alpha", "Beta", "Gamma"], result



# ── 8. `:has()` pseudo-selector rewrite to XPath ────────────────────────


def test_has_pseudo_selector_rewritten_to_xpath():
    """lxml's cssselect does not support `:has()`. Before this fix,
    extraction silently returned a parse-error envelope. Now simple
    `A:has(B)` is rewritten to the equivalent XPath descendant query
    so users who paste a `:has()` selector get a real match."""
    html = """
    <html><body>
      <article class="card">
        <span class="price">$99</span>
      </article>
      <article class="card">
        <p>No price here</p>
      </article>
      <article class="card">
        <span class="price">$199</span>
      </article>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {
        "label": "with_price",
        "kind": "list",
        "selector": "article.card:has(span.price)",
    }
    result = _pull(tree, field)
    # Only the two cards that have a span.price descendant should match.
    # The values should be the visible card text (joined).
    assert isinstance(result["value"], list), result
    assert len(result["value"]) == 2, result


def test_has_pseudo_does_not_crash_on_complex_selector():
    """Anything more complex than `A:has(B)` (e.g. `:has(A + B)`)
    is left alone and degrades to honest null rather than crashing."""
    html = "<html><body><div></div></body></html>"
    tree = lxml_html.fromstring(html)
    field = {
        "label": "x",
        "kind": "text",
        "selector": "div:has(> span + a)",
    }
    # Should not raise — must return an envelope (may be null).
    result = _pull(tree, field)
    assert "value" in result



# ── 9. HTML-entity decoding through extraction ─────────────────────────


def test_html_entities_decoded_in_text():
    """`&amp;` `&#39;` `&lt;` should decode to `&` `'` `<` end-to-end.
    lxml does this on parse, but we pin the behavior so a future
    refactor (e.g. switching to a different text-extraction path)
    can't silently re-introduce raw entities in extracted text."""
    html = (
        "<html><body>"
        "<h1 class='t'>Ben &amp; Jerry&#39;s &lt;Cookie Dough&gt;</h1>"
        "</body></html>"
    )
    tree = lxml_html.fromstring(html)
    field = {"label": "title", "kind": "text", "selector": "h1.t"}
    result = _pull(tree, field)
    assert result["value"] == "Ben & Jerry's <Cookie Dough>", result


def test_numeric_entities_decoded():
    """`&#8364;` is the Euro sign — should come back as the actual €."""
    html = "<html><body><span class='p'>Price: &#8364;19.99</span></body></html>"
    tree = lxml_html.fromstring(html)
    field = {"label": "p", "kind": "text", "selector": "span.p"}
    assert _pull(tree, field)["value"] == "Price: €19.99"



# ── 10. Comment nodes don't leak into visible text ─────────────────────


def test_html_comment_nodes_skipped_in_visible_text():
    """`<div><!-- price below -->$19.99</div>` — the comment node
    should NOT appear in the extracted text. lxml comment nodes have
    a non-string `.tag`, so the visit guard in `_visible_text`
    skips them implicitly. Pin the behavior."""
    html = (
        '<html><body>'
        '<div class="p"><!-- price below -->$19.99</div>'
        '</body></html>'
    )
    tree = lxml_html.fromstring(html)
    field = {"label": "p", "kind": "text", "selector": "div.p"}
    result = _pull(tree, field)
    assert result["value"] == "$19.99", result
    # Make sure the comment text didn't leak in.
    assert "price below" not in (result["value"] or "")


def test_html_comment_between_siblings_does_not_glue():
    """`<p>Hello<!-- spacer -->world</p>` should yield 'Helloworld' —
    comments are NOT whitespace, they just don't appear at all."""
    html = '<html><body><p>Hello<!-- spacer -->world</p></body></html>'
    tree = lxml_html.fromstring(html)
    field = {"label": "p", "kind": "text", "selector": "p"}
    result = _pull(tree, field)
    assert result["value"] == "Helloworld", result



# ── 11. ARIA role="row" lists (Notion, Linear) ──────────────────────────


def test_aria_role_row_list_extraction():
    """Sites using ARIA roles instead of <tr>/<article>. The picker
    yields selectors against role attributes; per-row extraction must
    discover the row container by DOM-LCA over the role matches."""
    html = """
    <html><body>
      <div role="grid" class="board">
        <div role="row" class="rr">
          <div role="gridcell" class="name">Task Alpha</div>
          <div role="gridcell" class="status">Done</div>
        </div>
        <div role="row" class="rr">
          <div role="gridcell" class="name">Task Beta</div>
          <div role="gridcell" class="status">Open</div>
        </div>
        <div role="row" class="rr">
          <div role="gridcell" class="name">Task Gamma</div>
          <div role="gridcell" class="status">Blocked</div>
        </div>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "name", "kind": "list",
         "selector": 'div[role="grid"] div[role="row"] div.name'},
        {"label": "status", "kind": "list",
         "selector": 'div[role="grid"] div[role="row"] div.status'},
    ]
    values, handled = _pull_lists_per_row(tree, template)
    assert "name" in handled and "status" in handled, handled
    assert values["name"] == ["Task Alpha", "Task Beta", "Task Gamma"], values
    assert values["status"] == ["Done", "Open", "Blocked"], values



# ── 12. All-whitespace text becomes empty, not preserved ─────────────────


def test_all_whitespace_text_becomes_empty_string():
    """`<span>   \\n\\t   </span>` should normalize to '' so the
    envelope reports the field as empty rather than carrying useless
    whitespace as a 'value'. The whitespace-collapse logic in
    `_visible_text` handles this — pin it."""
    html = "<html><body><span class='w'>   \n\t   </span></body></html>"
    tree = lxml_html.fromstring(html)
    field = {"label": "w", "kind": "text", "selector": "span.w"}
    result = _pull(tree, field)
    # Empty selector match should produce empty-value envelope with
    # confidence 0.5 (selector hit but value empty).
    assert result["value"] in (None, ""), result
    assert result["confidence"] == 0.5, result


def test_mixed_text_with_inner_elements_preserves_spaces():
    """`<p>Hello <strong>world</strong> from earth</p>` should yield
    'Hello world from earth' — internal whitespace between text runs
    is preserved (only collapsed)."""
    html = "<html><body><p class='m'>Hello <strong>world</strong> from earth</p></body></html>"
    tree = lxml_html.fromstring(html)
    field = {"label": "m", "kind": "text", "selector": "p.m"}
    result = _pull(tree, field)
    assert result["value"] == "Hello world from earth", result


def test_deeply_nested_text_joined_correctly():
    """`<div><span><strong>inner</strong></span></div>` clicked at outer
    div should return the joined inner text."""
    html = '<html><body><div class="o"><span><strong>inner</strong></span></div></body></html>'
    tree = lxml_html.fromstring(html)
    field = {"label": "o", "kind": "text", "selector": "div.o"}
    assert _pull(tree, field)["value"] == "inner"


# ── <template> content is inert in browsers; must not leak into scrapes ─


def test_template_descendants_excluded_from_scalar_extraction():
    """`<template>` contents are an inert document-fragment in real
    browsers — invisible to users, not part of the live DOM. lxml's
    cssselect doesn't know this and would happily return divs inside
    `<template>`. We filter them out at the selector layer."""
    html = """
    <html><body>
      <div class="card">visible content</div>
      <template>
        <div class="card">SHOULD NOT BE SCRAPED</div>
      </template>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "card", "kind": "text", "selector": "div.card"}
    # Only the visible card's content should be returned.
    result = _pull(tree, field)
    assert result["value"] == "visible content", result
    assert "SHOULD NOT BE SCRAPED" not in str(result["value"])


def test_template_descendants_excluded_from_list_extraction():
    """Same rule for list extraction — the row in the <template> must
    not appear in the per-row output."""
    html = """
    <html><body>
      <div class="grid">
        <article class="card">
          <h3>Real A</h3><span class="p">$10</span>
        </article>
        <article class="card">
          <h3>Real B</h3><span class="p">$20</span>
        </article>
      </div>
      <template>
        <div class="grid">
          <article class="card">
            <h3>Template Ghost</h3><span class="p">$99</span>
          </article>
        </div>
      </template>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "title", "kind": "list",
         "selector": "div.grid > article.card > h3"},
        {"label": "price", "kind": "list",
         "selector": "div.grid > article.card > span.p"},
    ]
    values, handled = _pull_lists_per_row(tree, template)
    assert {"title", "price"}.issubset(handled), handled
    assert values["title"] == ["Real A", "Real B"], values
    assert values["price"] == ["$10", "$20"], values
    assert "Template Ghost" not in values["title"]
    assert "$99" not in values["price"]


def test_template_ancestor_helper_unit():
    """Direct unit test on the helper itself."""
    from app.extract import _has_template_ancestor
    html = """
    <html><body>
      <div class="outside"><span>A</span></div>
      <template>
        <div class="inside"><span>B</span></div>
      </template>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    outside_span = tree.cssselect("div.outside > span")[0]
    inside_span = tree.cssselect("div.inside > span")[0]
    assert _has_template_ancestor(outside_span) is False
    assert _has_template_ancestor(inside_span) is True


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
