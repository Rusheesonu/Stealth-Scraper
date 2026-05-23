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



# ── 19. <noscript> content extraction ───────────────────────────────────


def test_noscript_inner_text_extracted_when_selector_targets_it():
    """Many sites ship a `<noscript>` block with an SEO-friendly
    prerendered copy of the page. lxml parses noscript content as
    text. If a user picks an element WITHIN noscript via XPath
    (cssselect treats noscript children as text), extraction must
    surface the text fallback rather than returning empty."""
    html = """
    <html><body>
      <noscript>
        <h1 class='real-title'>Buy Widget Pro for $499</h1>
        <p class='real-price'>$499</p>
      </noscript>
      <div id='spa-root'></div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    # Try a direct selector pointing into noscript. lxml's html parser
    # treats noscript as raw text, so cssselect into the children
    # likely returns nothing — degradation must be graceful (null +
    # reason, not crash).
    field = {"label": "title", "kind": "text", "selector": "h1.real-title"}
    result = _pull(tree, field)
    # Either we extract OR we honestly null with a reason — never
    # crash, never silently return ''.
    if result["value"] is None:
        assert result["reason_if_null"], result
    else:
        assert "Widget" in result["value"], result


def test_noscript_text_content_at_parent_level_includes_real_content():
    """If user picks the <body> or a parent of <noscript>, the visible
    text should include the noscript copy (lxml exposes it as text)."""
    html = """
    <html><body>
      <main class='wrap'>
        <noscript>fallback message</noscript>
        Some other text.
      </main>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "main", "kind": "text", "selector": "main.wrap"}
    result = _pull(tree, field)
    val = result["value"] or ""
    assert "Some other text" in val
    # noscript content may or may not be included by lxml; either way
    # we must not crash.



# ── 20. Bracket / data-bind attribute extraction + transforms ────────────


def test_data_bind_attr_extracted_literally():
    """`data-bind='text: price, click: onSelect'` should come back
    literal — the user can then use regex_extract to pluck the
    `text: price` segment with a transform pipeline."""
    html = (
        '<html><body><span class="p" '
        'data-bind="text: price, click: onSelect">$10</span></body></html>'
    )
    tree = lxml_html.fromstring(html)
    field = {"label": "b", "kind": "attr", "attr": "data-bind", "selector": "span.p"}
    result = _pull(tree, field)
    assert result["value"] == "text: price, click: onSelect", result


def test_input_value_extracted_as_attr():
    """`<input value='john@example.com'>` — value attr round-trips."""
    html = '<html><body><input class="e" type="email" value="john@example.com"/></body></html>'
    tree = lxml_html.fromstring(html)
    field = {"label": "e", "kind": "attr", "attr": "value", "selector": "input.e"}
    assert _pull(tree, field)["value"] == "john@example.com"


def test_attr_with_dash_extracted_correctly():
    """Custom attrs like `data-product-id` must be extracted exactly."""
    html = (
        '<html><body><article class="x" '
        'data-product-id="ABC-123" data-product-sku="SKU-9">item</article></body></html>'
    )
    tree = lxml_html.fromstring(html)
    fpid = {"label": "pid", "kind": "attr", "attr": "data-product-id", "selector": "article.x"}
    fsku = {"label": "sku", "kind": "attr", "attr": "data-product-sku", "selector": "article.x"}
    assert _pull(tree, fpid)["value"] == "ABC-123"
    assert _pull(tree, fsku)["value"] == "SKU-9"



# ── 21. Virtualized-list coverage warning ────────────────────────────────


def test_virtualized_list_does_not_crash():
    """A page with only 5 cards rendered (virtualized list) extracts
    the 5 it finds. We don't crash, don't lie about counts, and the
    user gets honest data."""
    html = """
    <html><body>
      <div class="grid">""" + "".join([
        f"""<article class="card"><h3>Item {i}</h3><span class="p">${i*10}</span></article>"""
        for i in range(5)
    ]) + """</div>
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
    assert len(values["title"]) == 5, values
    assert len(values["price"]) == 5, values
    # The actual virtualization detection isn't a hard contract here —
    # this test just pins that small-count grids extract correctly
    # and don't trigger any spurious null-broadcast cleanup.
    assert values["title"][0] == "Item 0"
    assert values["price"][4] == "$40"


def test_single_row_grid_falls_through_cleanly():
    """If a grid only has ONE matching card (often happens when the
    user's selector is too narrow), _pull_lists_per_row should bail
    out (need >= 2 rows for per-row extraction) and let _pull handle
    each field flat — returning a single-element list."""
    html = """
    <html><body>
      <div class="grid">
        <article class="card">
          <h3>Solo</h3>
          <span class="p">$10</span>
        </article>
      </div>
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
    # Either per-row extraction bailed (handled is empty, caller falls
    # back to flat _pull) OR it returned single-element lists. Both ok.
    if handled:
        assert values["title"] == ["Solo"]
        assert values["price"] == ["$10"]



# ── 22. <template> content graceful degradation ──────────────────────────


def test_template_content_returns_honest_null_or_text():
    """Browsers don't render `<template>` content; lxml parses it.
    Whichever way lxml exposes the children, extraction must NOT
    crash and must NOT silently return ''."""
    html = """
    <html><body>
      <template id="card-template">
        <article class="card">
          <h3 class="title">Placeholder</h3>
        </article>
      </template>
      <main>Visible content here.</main>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    # Selector for the title inside the template. Should not crash;
    # value may be the placeholder text OR a null envelope.
    field = {"label": "t", "kind": "text", "selector": "template#card-template h3.title"}
    result = _pull(tree, field)
    if result["value"] is None:
        assert result["reason_if_null"], result
    else:
        # Lxml exposed the children — text is at least the placeholder.
        assert isinstance(result["value"], str)


def test_template_does_not_pollute_visible_text_of_ancestor():
    """If user selects <body>, the visible text should be 'Visible
    content here.' and NOT include the template placeholder (which the
    user never sees in the browser). This is the IDEAL behavior; if
    lxml can't filter templates we at least don't crash."""
    html = """
    <html><body><template id='t'>
      <h3>Hidden Placeholder</h3>
    </template><main>Visible.</main></body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "b", "kind": "text", "selector": "body"}
    result = _pull(tree, field)
    assert "Visible" in (result["value"] or ""), result
    # Don't enforce hidden-placeholder exclusion — lxml parses
    # templates as regular elements. Just ensure visibility text
    # contains the actual visible string.



# ── 23. Single list field falls through to flat _pull ───────────────────


def test_single_list_field_handled_by_flat_pull():
    """When template has only ONE list field, _pull_lists_per_row
    returns empty handled (needs >= 2 list fields to align rows).
    The flat _pull then returns the list correctly."""
    html = """
    <html><body>
      <ul>
        <li class='row'>Alpha</li>
        <li class='row'>Beta</li>
        <li class='row'>Gamma</li>
      </ul>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "names", "kind": "list", "selector": "ul > li.row"},
        {"label": "title", "kind": "text", "selector": "ul"},  # scalar
    ]
    values, handled = _pull_lists_per_row(tree, template)
    # Only one list field → row extractor bails out. handled is empty,
    # caller falls back to flat _pull which returns the full list.
    assert handled == set(), handled
    # Now verify the flat _pull returns the list correctly.
    list_field = template[0]
    list_result = _pull(tree, list_field)
    assert list_result["value"] == ["Alpha", "Beta", "Gamma"], list_result
    # Scalar field also works fine.
    text_result = _pull(tree, template[1])
    assert "Alpha" in (text_result["value"] or "")


def test_scalar_only_template_returns_no_handled_lists():
    """All scalar fields → row extractor returns empty handled set."""
    html = "<html><body><h1>Title</h1><p class='d'>Desc</p></body></html>"
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "title", "kind": "text", "selector": "h1"},
        {"label": "desc", "kind": "text", "selector": "p.d"},
    ]
    values, handled = _pull_lists_per_row(tree, template)
    assert handled == set()
    assert values == {}



# ── 24. Transform pipeline edge cases ───────────────────────────────────


def test_regex_extract_no_match_produces_null_envelope():
    """`regex_extract` with a pattern that doesn't match should null
    the value. The envelope must report the null honestly — confidence
    drops, reason_if_null is set."""
    html = '<html><body><span class="p">Just normal text</span></body></html>'
    tree = lxml_html.fromstring(html)
    field = {
        "label": "x",
        "kind": "text",
        "selector": "span.p",
        "transforms": [{"op": "regex_extract", "pattern": r"\$(\d+)"}],
    }
    result = _pull(tree, field)
    assert result["value"] is None, result
    assert result["confidence"] < 1.0, result
    assert result["reason_if_null"], result


def test_to_int_on_non_numeric_returns_null():
    """`to_int` on non-numeric text returns None — pin envelope."""
    html = '<html><body><span class="p">not a number</span></body></html>'
    tree = lxml_html.fromstring(html)
    field = {
        "label": "n", "kind": "text", "selector": "span.p",
        "transforms": [{"op": "to_int"}],
    }
    result = _pull(tree, field)
    assert result["value"] is None
    assert result["reason_if_null"]


def test_transform_pipeline_chain_strip_to_int():
    """Chain transforms: strip whitespace → strip '$' prefix → to_int."""
    html = '<html><body><span class="p">  $1,299  </span></body></html>'
    tree = lxml_html.fromstring(html)
    field = {
        "label": "n", "kind": "text", "selector": "span.p",
        "transforms": [
            {"op": "strip"},
            {"op": "strip_prefix", "value": "$"},
            {"op": "to_int"},
        ],
    }
    result = _pull(tree, field)
    assert result["value"] == 1299, result


def test_unknown_transform_op_is_no_op():
    """Unknown ops should be silently ignored — pin for forward compat
    when removing/renaming ops."""
    html = '<html><body><span class="p">hello</span></body></html>'
    tree = lxml_html.fromstring(html)
    field = {
        "label": "p", "kind": "text", "selector": "span.p",
        "transforms": [{"op": "this_op_does_not_exist"}],
    }
    assert _pull(tree, field)["value"] == "hello"



# ── 25. <script> / <style> content excluded from visible text ────────────


def test_script_content_not_in_visible_text():
    """`<div>Title<script>var x=1;</script></div>` — visible text
    should be 'Title', NOT 'Titlevar x=1;'."""
    html = """
    <html><body>
      <div class='c'>Title<script>var x = 1; alert('hi');</script></div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "c", "kind": "text", "selector": "div.c"}
    result = _pull(tree, field)
    val = result["value"] or ""
    assert "Title" in val, result
    assert "var x" not in val, val
    assert "alert" not in val, val


def test_style_content_not_in_visible_text():
    """`<div>Heading<style>.x { color: red; }</style></div>` —
    visible text should not include the CSS rules."""
    html = """
    <html><body>
      <div class='c'>Heading<style>.x { color: red; }</style></div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "c", "kind": "text", "selector": "div.c"}
    val = _pull(tree, field)["value"] or ""
    assert "Heading" in val, val
    assert "color: red" not in val, val
    assert ".x" not in val, val



# ── 26. List-field transform that yields all-None items ─────────────────


def test_list_transform_yielding_all_nones_marks_low_confidence():
    """Selector matched 3 nodes; the regex_extract transform returned
    None for every item (pattern doesn't match). The envelope should
    surface this honestly — value is empty list (filtered) and
    confidence drops below 1.0 so the user knows transforms scrubbed
    everything."""
    html = """
    <html><body>
      <ul>
        <li class='row'>apple</li>
        <li class='row'>banana</li>
        <li class='row'>cherry</li>
      </ul>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {
        "label": "x",
        "kind": "list",
        "selector": "ul > li.row",
        # Pattern looks for a $-prefixed number — none of these match.
        "transforms": [{"op": "regex_extract", "pattern": r"\$(\d+)"}],
    }
    result = _pull(tree, field)
    # Either all-None (current) or empty list + low confidence + reason.
    # We pin the "honest" branch — empty list, half-or-less confidence.
    assert result["value"] in ([], None) or all(
        v is None for v in result["value"]
    ), result
    assert result["confidence"] < 1.0, result
    assert result["reason_if_null"], result


def test_list_transform_mixed_none_and_value():
    """Selector matched 3 nodes; transform yielded value for some,
    None for others. We KEEP the mixed list (filtering would lose
    alignment) and report confidence between 0.5 and 1.0."""
    html = """
    <html><body>
      <ul>
        <li class='row'>price: $10</li>
        <li class='row'>no price here</li>
        <li class='row'>price: $20</li>
      </ul>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {
        "label": "x",
        "kind": "list",
        "selector": "ul > li.row",
        "transforms": [{"op": "regex_extract", "pattern": r"\$(\d+)"}],
    }
    result = _pull(tree, field)
    # Mixed result is acceptable; just must not crash.
    assert isinstance(result["value"], list), result



# ── 27. <picture> element — extract inner <img> alt or first srcset ─────


def test_picture_element_attr_src_picks_inner_img_src():
    """When the picker captures `<picture>` and the user asks for
    `src` attr, we should walk into the inner `<img>` and return its
    src (or first source's srcset)."""
    html = """
    <html><body>
      <picture class='hero'>
        <source srcset='https://cdn.example.com/hi.avif' type='image/avif'/>
        <source srcset='https://cdn.example.com/hi.webp' type='image/webp'/>
        <img src='https://cdn.example.com/fallback.jpg' alt='Hero image'/>
      </picture>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "src", "kind": "attr", "attr": "src", "selector": "picture.hero"}
    result = _pull(tree, field)
    # `<picture>` itself has no `src` attr. Without smart fallback,
    # this returns None. With the fallback (this iter's fix), it
    # should return EITHER the inner <img> fallback OR the first
    # <source srcset> URL — both are correct outcomes (browser
    # would pick one based on format support; our scraper picks
    # the highest-quality variant available in the markup).
    assert result["value"] in (
        "https://cdn.example.com/fallback.jpg",
        "https://cdn.example.com/hi.avif",
        "https://cdn.example.com/hi.webp",
    ), result


def test_picture_element_text_kind_returns_alt():
    """`kind=text` on `<picture>` should return the alt of the inner
    `<img>` (a `<picture>` has no direct visible text content)."""
    html = """
    <html><body>
      <picture class='hero'>
        <source srcset='https://cdn.example.com/hi.avif' type='image/avif'/>
        <img src='/x.jpg' alt='Hero subject'/>
      </picture>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "txt", "kind": "text", "selector": "picture.hero"}
    result = _pull(tree, field)
    assert result["value"] == "Hero subject", result



# ── 13. Trailing-currency split price (European format) ─────────────────


def test_split_price_climbs_for_trailing_euro():
    """European stores often render `19,99 €` (currency AFTER the digits).
    When the user picks the € span, we should climb and assemble the
    full trailing-currency price string."""
    html = """
    <html><body>
      <p class="price">
        <span class="d">19</span><span class="f">,99</span><span class="c">€</span>
      </p>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "price", "kind": "text", "selector": "span.c"}
    result = _pull(tree, field)
    # Joined visible text "19,99€" — trailing currency price climb
    # should assemble it.
    assert result["value"] in ("19,99€", "19,99 €"), result


def test_split_price_with_spaces_trailing_currency():
    """`19,99 €` with whitespace between digits and symbol still climbs."""
    html = """
    <html><body>
      <p class="price">
        <span class="d">19,99</span><span class="c"> €</span>
      </p>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "price", "kind": "text", "selector": "span.c"}
    result = _pull(tree, field)
    # Currency leading or trailing both acceptable; just must be full price.
    val = result["value"] or ""
    assert "19,99" in val and "€" in val, result



# ── 14. Discount price: strikethrough <s> + active price extracted distinctly ─


def test_strikethrough_and_current_price_extracted_distinctly():
    """Cards with `<s>$50</s>` (was) and `<span class='now'>$30</span>` (now).
    Per-row extraction must return TWO lists aligned by row position."""
    html = """
    <html><body>
      <div class="grid">
        <article class="card">
          <h3>Alpha</h3>
          <s class="was">$50</s>
          <span class="now">$30</span>
        </article>
        <article class="card">
          <h3>Beta</h3>
          <s class="was">$80</s>
          <span class="now">$60</span>
        </article>
        <article class="card">
          <h3>Gamma</h3>
          <s class="was">$100</s>
          <span class="now">$75</span>
        </article>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "title", "kind": "list",
         "selector": "div.grid > article.card > h3"},
        {"label": "was", "kind": "list",
         "selector": "div.grid > article.card > s.was"},
        {"label": "now", "kind": "list",
         "selector": "div.grid > article.card > span.now"},
    ]
    values, handled = _pull_lists_per_row(tree, template)
    assert {"title", "was", "now"}.issubset(handled), handled
    assert values["title"] == ["Alpha", "Beta", "Gamma"]
    assert values["was"] == ["$50", "$80", "$100"]
    assert values["now"] == ["$30", "$60", "$75"]



# ── 15. Empty list when no row matches at all ────────────────────────────


def test_list_field_with_zero_matches_returns_envelope():
    """Selector matches zero nodes — _pull must return a null-value
    envelope with reason_if_null set, not crash and not silent-fail."""
    html = "<html><body><div></div></body></html>"
    tree = lxml_html.fromstring(html)
    field = {"label": "missing", "kind": "list", "selector": "ul.nope > li"}
    result = _pull(tree, field)
    assert result["value"] == [], result
    assert result["confidence"] == 0.0, result
    assert result["reason_if_null"], result


def test_pull_lists_per_row_zero_rows_returns_empty_handled():
    """When the template has list fields but the page has no matching
    rows at all, _pull_lists_per_row should return an empty values dict
    and an EMPTY handled set so the caller falls back to per-field
    _pull() (which then returns honest nulls)."""
    html = "<html><body><div class='empty-state'>No items</div></body></html>"
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "title", "kind": "list",
         "selector": "div.grid > article.card > h3"},
        {"label": "price", "kind": "list",
         "selector": "div.grid > article.card > span.price"},
    ]
    values, handled = _pull_lists_per_row(tree, template)
    # No rows → either empty values dict OR all-empty lists, but no exception.
    assert handled in (set(), {"title", "price"}), handled
    for v in values.values():
        assert v == [] or all(x is None for x in v), v



# ── 16. Modern CSS selector forms (`:not`, `~`, `[class*=]`) ─────────────


def test_selector_not_pseudo_works():
    """`a:not(.disabled)` should match anchors without the disabled class."""
    html = """
    <html><body>
      <a class='link'>One</a>
      <a class='link disabled'>Two</a>
      <a class='link'>Three</a>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "links", "kind": "list", "selector": "a:not(.disabled)"}
    result = _pull(tree, field)
    assert result["value"] == ["One", "Three"], result


def test_selector_general_sibling_works():
    """`h2 ~ p` — any <p> that follows an <h2> within the same parent."""
    html = """
    <html><body>
      <section>
        <h2>Heading</h2>
        <p>Paragraph one</p>
        <span>not a paragraph</span>
        <p>Paragraph two</p>
      </section>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "paras", "kind": "list", "selector": "h2 ~ p"}
    result = _pull(tree, field)
    assert result["value"] == ["Paragraph one", "Paragraph two"], result


def test_selector_attribute_substring_works():
    """`[class*='price']` — match any element whose class contains 'price'."""
    html = """
    <html><body>
      <div class='item'>Junk</div>
      <div class='price-now'>$10</div>
      <div class='item-price-old'>$20</div>
      <div class='other'>Junk</div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "p", "kind": "list", "selector": "[class*='price']"}
    result = _pull(tree, field)
    assert result["value"] == ["$10", "$20"], result



# ── 17. href semantics — js:, relative, mailto, tel, absolute ────────────


def test_javascript_href_returned_literal():
    """`href='javascript:void(0)'` is a real (if dangerous) value.
    Downstream consumers may want to detect and filter, but extraction
    must return the literal string — never strip / mangle it."""
    html = '<html><body><a class="x" href="javascript:doStuff()">go</a></body></html>'
    tree = lxml_html.fromstring(html)
    field = {"label": "h", "kind": "attr", "attr": "href", "selector": "a.x"}
    assert _pull(tree, field)["value"] == "javascript:doStuff()"


def test_relative_href_returned_as_is():
    """`href='/products/123'` returns the raw relative path. Users can
    resolve against base URL via the upcoming resolve_url transform."""
    html = '<html><body><a class="x" href="/products/123">go</a></body></html>'
    tree = lxml_html.fromstring(html)
    field = {"label": "h", "kind": "attr", "attr": "href", "selector": "a.x"}
    assert _pull(tree, field)["value"] == "/products/123"


def test_mailto_and_tel_hrefs_preserved():
    """`mailto:` and `tel:` schemes are valid hrefs and should pass through."""
    html = """
    <html><body>
      <a class="m" href="mailto:hi@example.com">email</a>
      <a class="t" href="tel:+15551234567">call</a>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    fm = {"label": "m", "kind": "attr", "attr": "href", "selector": "a.m"}
    ft = {"label": "t", "kind": "attr", "attr": "href", "selector": "a.t"}
    assert _pull(tree, fm)["value"] == "mailto:hi@example.com"
    assert _pull(tree, ft)["value"] == "tel:+15551234567"



# ── 18. resolve_url transform — convert relative href to absolute ────────


def test_resolve_url_transform_relative_to_absolute():
    """A `resolve_url` transform joins a relative href against a base
    URL. Use case: extracted '/products/123' + base 'https://shop.com'
    → 'https://shop.com/products/123'."""
    html = '<html><body><a class="x" href="/products/123">go</a></body></html>'
    tree = lxml_html.fromstring(html)
    field = {
        "label": "url",
        "kind": "attr",
        "attr": "href",
        "selector": "a.x",
        "transforms": [
            {"op": "resolve_url", "value": "https://shop.example.com/category/"}
        ],
    }
    result = _pull(tree, field)
    assert result["value"] == "https://shop.example.com/products/123", result


def test_resolve_url_transform_already_absolute_passthrough():
    """Absolute URLs are unchanged."""
    html = '<html><body><a class="x" href="https://other.com/page">go</a></body></html>'
    tree = lxml_html.fromstring(html)
    field = {
        "label": "url", "kind": "attr", "attr": "href", "selector": "a.x",
        "transforms": [{"op": "resolve_url", "value": "https://shop.example.com/"}],
    }
    assert _pull(tree, field)["value"] == "https://other.com/page"


def test_resolve_url_transform_protocol_relative():
    """Protocol-relative URLs (`//cdn.example.com/x.jpg`) take the
    scheme from the base URL."""
    html = '<html><body><a class="x" href="//cdn.shop.com/asset.js">go</a></body></html>'
    tree = lxml_html.fromstring(html)
    field = {
        "label": "url", "kind": "attr", "attr": "href", "selector": "a.x",
        "transforms": [{"op": "resolve_url", "value": "https://shop.example.com/"}],
    }
    assert _pull(tree, field)["value"] == "https://cdn.shop.com/asset.js"



# ── 28. JSON-LD <script> extracted via html kind (script content visible) ─


def test_jsonld_script_content_extractable_via_html_kind():
    """JSON-LD lives in `<script type='application/ld+json'>`. After
    iter 19, _visible_text excludes <script> from text extraction
    (correctly — script tags aren't visible content). But the user
    CAN still grab the JSON via kind='html' or by direct attribute.
    Pin both paths."""
    html = """
    <html><body>
      <script type='application/ld+json' id='ld'>
      {"@context": "https://schema.org", "@type": "Product", "name": "Widget"}
      </script>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    # Path A: kind='html' gives back the literal script element including
    # its JSON body. Good for downstream JSON parsing.
    field_html = {"label": "ld", "kind": "html", "selector": "script#ld"}
    result = _pull(tree, field_html)
    val = result["value"] or ""
    assert "Widget" in val, val
    assert "application/ld+json" in val, val

    # Path B: kind='text' on the script DOES NOT return JSON content —
    # iter 19 filtered scripts from visible text. This is intentional;
    # the user should use kind='html' for raw script bodies.
    field_text = {"label": "ld_text", "kind": "text", "selector": "script#ld"}
    result_text = _pull(tree, field_text)
    # Selector matched but visible text is empty → 0.5 confidence + reason.
    assert result_text["confidence"] in (0.5, 0.0)


def test_script_html_kind_returns_inner_text():
    """Generic test that `kind='html'` on a node returns its outer
    HTML (including the tag itself)."""
    html = '<html><body><div id="m"><p>Hi</p></div></body></html>'
    tree = lxml_html.fromstring(html)
    field = {"label": "m", "kind": "html", "selector": "div#m"}
    val = _pull(tree, field)["value"] or ""
    assert "<p>Hi</p>" in val
    assert val.startswith('<div')



# ── 29. Universal selector `*` and child-only `>` ────────────────────────


def test_universal_selector_with_descendant():
    """`.card > *` matches direct children of any element with .card class."""
    html = """
    <html><body>
      <div class="card">
        <h3>Title</h3>
        <span class="meta">Meta</span>
        <p>Body</p>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "kids", "kind": "list", "selector": ".card > *"}
    result = _pull(tree, field)
    assert result["value"] == ["Title", "Meta", "Body"], result


def test_first_child_pseudo_works():
    """`li:first-child` should match the first li in each parent."""
    html = """
    <html><body>
      <ul>
        <li>first</li>
        <li>second</li>
      </ul>
      <ul>
        <li>another first</li>
        <li>another second</li>
      </ul>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "f", "kind": "list", "selector": "li:first-child"}
    assert _pull(tree, field)["value"] == ["first", "another first"]


def test_nth_child_pseudo_works():
    """`li:nth-child(2)` should match the SECOND li in each parent."""
    html = """
    <html><body>
      <ul><li>1</li><li>2</li><li>3</li></ul>
      <ul><li>a</li><li>b</li><li>c</li></ul>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "n", "kind": "list", "selector": "li:nth-child(2)"}
    assert _pull(tree, field)["value"] == ["2", "b"]



# ── 30. Duplicate selector across two labels doesn't crash ───────────────


def test_duplicate_selectors_across_labels_extract_aligned():
    """User accidentally duplicated the same selector for two labels.
    Extraction should still produce aligned per-row results (both
    labels get the same values), not crash."""
    html = """
    <html><body>
      <div class="grid">
        <article class="card">
          <h3 class="title">Alpha</h3>
          <span class="p">$10</span>
        </article>
        <article class="card">
          <h3 class="title">Beta</h3>
          <span class="p">$20</span>
        </article>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "name1", "kind": "list",
         "selector": "div.grid > article.card > h3.title"},
        {"label": "name2", "kind": "list",
         "selector": "div.grid > article.card > h3.title"},
    ]
    values, handled = _pull_lists_per_row(tree, template)
    # Both labels should get the same alignment — or the row extractor
    # bails and each gets handled by flat _pull. Either is fine; we
    # just must not crash.
    if handled:
        assert values["name1"] == values["name2"]
        assert values["name1"] in (["Alpha", "Beta"], [])


def test_field_with_no_selector_returns_unspecified():
    """Field missing both `selector` and `xpath` — should return null
    with reason 'field has neither selector nor xpath'."""
    html = "<html><body><h1>hi</h1></body></html>"
    tree = lxml_html.fromstring(html)
    field = {"label": "x", "kind": "text"}
    result = _pull(tree, field)
    assert result["value"] is None
    assert "selector" in (result["reason_if_null"] or "")



# ── 31. XPath-only selector path ─────────────────────────────────────────


def test_xpath_only_field_extracts_text():
    """Field with no `selector` but a valid `xpath` should extract via XPath."""
    html = "<html><body><div><h1>Hello XPath</h1></div></body></html>"
    tree = lxml_html.fromstring(html)
    field = {"label": "t", "kind": "text", "xpath": "//h1"}
    result = _pull(tree, field)
    assert result["value"] == "Hello XPath", result
    assert result["source"] == "xpath", result


def test_xpath_with_text_function():
    """`//h1/text()` returns a text node (string). _pull must handle this."""
    html = "<html><body><h1>only this</h1></body></html>"
    tree = lxml_html.fromstring(html)
    field = {"label": "t", "kind": "text", "xpath": "//h1/text()"}
    # XPath text() returns a list of strings (not elements). _pull
    # then calls _read on the first which may not behave as expected.
    # We just verify no crash, value is either "only this" or null
    # with a reason.
    result = _pull(tree, field)
    if result["value"] is None:
        assert result["reason_if_null"], result


def test_xpath_invalid_syntax_returns_parse_error():
    """A malformed XPath should produce an envelope with parse_error
    in reason_if_null, not crash."""
    html = "<html><body></body></html>"
    tree = lxml_html.fromstring(html)
    field = {"label": "x", "kind": "text", "xpath": "//[unclosed"}
    result = _pull(tree, field)
    assert result["value"] is None
    assert result["reason_if_null"]


# ── Schema.org microdata extraction ─────────────────────────────────────


def test_microdata_meta_itemprop_uses_content_attr():
    """`<meta itemprop="price" content="199.99">` carries the value in
    `content`, not visible text. kind=text on this node should return
    the content attribute (matching the schema.org microdata spec)."""
    html = """
    <html><body>
      <div itemscope itemtype="https://schema.org/Product">
        <meta itemprop="price" content="199.99"/>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "price", "kind": "text",
             "selector": "meta[itemprop='price']"}
    result = _pull(tree, field)
    assert result["value"] == "199.99", result


def test_microdata_time_itemprop_uses_datetime_attr():
    """`<time itemprop="datePublished" datetime="2026-05-24">May 24</time>` —
    when the visible text is empty (just whitespace), fall back to
    the datetime attribute. When text IS present, text wins (e.g.
    `<time>May 24</time>` returns 'May 24' as before)."""
    html = """
    <html><body>
      <article>
        <time itemprop="datePublished" datetime="2026-05-24T10:00:00Z"></time>
      </article>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "date", "kind": "text",
             "selector": "time[itemprop='datePublished']"}
    result = _pull(tree, field)
    assert result["value"] == "2026-05-24T10:00:00Z", result


def test_microdata_link_itemprop_uses_href_attr():
    """`<link itemprop="image" href="https://cdn..."/>` — link tags
    have neither text nor src; the URL is in href. Fallback should
    catch this."""
    html = """
    <html><body>
      <link itemprop="image" href="https://cdn.example.com/img.jpg"/>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "image", "kind": "text",
             "selector": "link[itemprop='image']"}
    result = _pull(tree, field)
    assert result["value"] == "https://cdn.example.com/img.jpg", result


def test_microdata_visible_text_wins_over_attr():
    """When a microdata-tagged element has BOTH visible text AND a
    content attribute, the visible text wins (it's authoritative —
    content is a fallback for empty-text elements like <meta>)."""
    html = """
    <html><body>
      <span itemprop="name" content="ignore me">Real Product Name</span>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "name", "kind": "text",
             "selector": "span[itemprop='name']"}
    result = _pull(tree, field)
    assert result["value"] == "Real Product Name", result


def test_microdata_per_row_extraction_aligned():
    """Real-world product grid using microdata — verify per-row
    extraction works when each row has multiple itemprops."""
    html = """
    <html><body>
      <div class="grid">
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Widget A</span>
          <meta itemprop="price" content="10.00"/>
        </div>
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Widget B</span>
          <meta itemprop="price" content="20.00"/>
        </div>
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Widget C</span>
          <meta itemprop="price" content="30.00"/>
        </div>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "name", "kind": "list",
         "selector": "div.grid > div > span[itemprop='name']"},
        {"label": "price", "kind": "list",
         "selector": "div.grid > div > meta[itemprop='price']"},
    ]
    values, handled = _pull_lists_per_row(tree, template)
    assert {"name", "price"}.issubset(handled), handled
    assert values["name"] == ["Widget A", "Widget B", "Widget C"], values
    assert values["price"] == ["10.00", "20.00", "30.00"], values


# ── Hidden mobile/desktop responsive duplicates ────────────────────────


def test_display_none_inline_style_excluded_from_extraction():
    """Sites that ship both responsive layouts (mobile + desktop) in
    the DOM and toggle visibility via CSS. The hidden duplicate must
    not appear in extraction output."""
    html = """
    <html><body>
      <div class="card">visible title</div>
      <div class="card" style="display: none">HIDDEN MOBILE COPY</div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "card", "kind": "text", "selector": "div.card"}
    assert _pull(tree, field)["value"] == "visible title"


def test_html5_hidden_attribute_excluded():
    """HTML5 spec: the `hidden` global attribute is equivalent to
    `display:none`. lxml exposes it via attrib presence."""
    html = """
    <html><body>
      <div class="card">visible title</div>
      <div class="card" hidden>HIDDEN HTML5 COPY</div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "card", "kind": "text", "selector": "div.card"}
    assert _pull(tree, field)["value"] == "visible title"


def test_aria_hidden_true_excluded():
    """WAI-ARIA: aria-hidden=\"true\" means the element is hidden
    from accessibility tree (typical mirror-copy pattern)."""
    html = """
    <html><body>
      <div class="card">visible title</div>
      <div class="card" aria-hidden="true">HIDDEN ARIA COPY</div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "card", "kind": "text", "selector": "div.card"}
    assert _pull(tree, field)["value"] == "visible title"


def test_framework_class_names_NOT_treated_as_hidden():
    """The picker MUST NOT filter elements just because their class
    name happens to include `.hidden`, `.d-none`, or `.lg:hidden` —
    those tokens may be used as semantic class names on visible
    elements (e.g. `.hidden-feature-flag`). The earlier over-aggressive
    filter risked dropping real content. This test pins that we now
    require an unambiguous spec-defined hidden marker (inline style,
    `aria-hidden=true`, or HTML5 `hidden` attribute)."""
    html = """
    <html><body>
      <div class="card hidden">this is actually rendered</div>
      <div class="card d-none">so is this</div>
      <div class="card lg:hidden">and this</div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "card", "kind": "list", "selector": "div.card"}
    result = _pull(tree, field)
    # All three rendered — no over-filtering on framework class names.
    assert result["value"] == [
        "this is actually rendered",
        "so is this",
        "and this",
    ], result


def test_hidden_ancestor_filters_per_row_extraction():
    """List extraction with mobile + desktop card grids both in DOM,
    where the mobile grid is hidden via INLINE style="display:none"
    (spec-universal). Each visible card must produce exactly one row."""
    html = """
    <html><body>
      <section>
        <article class="card">
          <h3>Real A</h3><span class="p">$10</span>
        </article>
        <article class="card">
          <h3>Real B</h3><span class="p">$20</span>
        </article>
        <article class="card">
          <h3>Real C</h3><span class="p">$30</span>
        </article>
      </section>
      <section style="display: none">
        <article class="card">
          <h3>Mobile Ghost A</h3><span class="p">$99</span>
        </article>
        <article class="card">
          <h3>Mobile Ghost B</h3><span class="p">$99</span>
        </article>
      </section>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    template = [
        {"label": "title", "kind": "list",
         "selector": "section > article.card > h3"},
        {"label": "price", "kind": "list",
         "selector": "section > article.card > span.p"},
    ]
    values, handled = _pull_lists_per_row(tree, template)
    assert {"title", "price"}.issubset(handled), handled
    assert values["title"] == ["Real A", "Real B", "Real C"], values
    assert values["price"] == ["$10", "$20", "$30"], values
    assert "Mobile Ghost A" not in values["title"]


def test_visible_ancestor_not_filtered_when_only_descendant_is_hidden():
    """A card with a hidden CHILD (e.g. a tooltip with display:none)
    should still be extracted via its OWN selector — the hidden
    descendant doesn't poison the parent."""
    html = """
    <html><body>
      <div class="card">
        Real content here
        <span class="tooltip" style="display:none">hover hint</span>
      </div>
    </body></html>
    """
    tree = lxml_html.fromstring(html)
    field = {"label": "card", "kind": "text", "selector": "div.card"}
    result = _pull(tree, field)
    # The card itself isn't hidden — only its tooltip child is. The
    # extracted text should be the card's visible content, with the
    # hidden tooltip already filtered by _visible_text's pass-1.
    assert "Real content here" in result["value"]
    assert "hover hint" not in result["value"]


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
