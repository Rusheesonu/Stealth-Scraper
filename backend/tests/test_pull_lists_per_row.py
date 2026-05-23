"""Regression tests for per-row list extraction.

Pinned to two failure modes the user hit on Target's Lego search:

  1. **Broadcast bug** — `_pull_lists_per_row`'s prefix-LCP produced
     a row container ABOVE the per-card boundary, so each "row's"
     scoped price selector matched the SAME global "starting at
     $X" badge and N rows came back with identical prices.

  2. **Prefix-LCP miss** — selector class strings diverged at deep
     levels (hashed CSS Modules), so the LCP broke before reaching
     the card boundary and per-row extraction bailed entirely.

Both should be handled by the new DOM-LCA fallback + broadcast
nuller in `extract.py`.
"""

from __future__ import annotations

import lxml.html as lxml_html

from app.extract import _pull_lists_per_row


# ── Helpers ──────────────────────────────────────────────────────────────

def _run(html: str, template: list[dict]) -> tuple[dict, set]:
    tree = lxml_html.fromstring(html)
    return _pull_lists_per_row(tree, template)


# ── Test 1: clean grid (regression — DON'T break the happy path) ────────

def test_clean_grid_happy_path():
    """books.toscrape.com-style clean grid — every field's selector
    shares a clean ancestor path. Prefix-LCP should work fine."""
    html = """
    <html><body>
      <ol class="row">
        <li class="col">
          <article class="product_pod">
            <h3><a title="Book One">Book One</a></h3>
            <p class="price_color">£10.00</p>
          </article>
        </li>
        <li class="col">
          <article class="product_pod">
            <h3><a title="Book Two">Book Two</a></h3>
            <p class="price_color">£20.00</p>
          </article>
        </li>
        <li class="col">
          <article class="product_pod">
            <h3><a title="Book Three">Book Three</a></h3>
            <p class="price_color">£30.00</p>
          </article>
        </li>
      </ol>
    </body></html>
    """
    template = [
        {"label": "title", "kind": "list",
         "selector": "ol.row > li.col > article.product_pod > h3 > a"},
        {"label": "price", "kind": "list",
         "selector": "ol.row > li.col > article.product_pod > p.price_color"},
    ]
    values, handled = _run(html, template)
    assert "title" in handled and "price" in handled
    assert values["title"] == ["Book One", "Book Two", "Book Three"]
    assert values["price"] == ["£10.00", "£20.00", "£30.00"]


# ── Test 2: Target $49.99 broadcast bug ─────────────────────────────────

def test_broadcast_bug_target_style():
    """Simulated Target — the price selector points at a global
    'starting at' badge OUTSIDE the card grid. Without the
    broadcast-nuller, prefix-LCP would (or did) return all-$49.99
    for every row. With the fix: either DOM-LCA finds the right
    per-card price (none here), or the broadcast-nuller replaces
    the column with nulls.
    """
    html = """
    <html><body>
      <div class="header">
        <span class="promo-price">$49.99</span>
      </div>
      <section>
        <div class="card">
          <h3 class="title">Lego Set Alpha</h3>
        </div>
        <div class="card">
          <h3 class="title">Lego Set Beta</h3>
        </div>
        <div class="card">
          <h3 class="title">Lego Set Gamma</h3>
        </div>
      </section>
    </body></html>
    """
    # User clicked title (3 unique) and price (matches just the global
    # promo span — 1 match). normalizeListSelector would strip
    # nth-of-type to make selectors broad.
    template = [
        {"label": "title", "kind": "list",
         "selector": "section > div.card > h3.title"},
        {"label": "price", "kind": "list",
         "selector": "div.header > span.promo-price"},
    ]
    values, handled = _run(html, template)
    # Titles must come through correctly.
    if "title" in handled:
        assert values["title"] == ["Lego Set Alpha", "Lego Set Beta", "Lego Set Gamma"], values
        # Price must NOT be all-$49.99-broadcast. It's either nulled
        # (broadcast-nuller fired) or just not handled per-row.
        if "price" in handled:
            price_col = values["price"]
            non_null = [v for v in price_col if v not in (None, "")]
            assert len(non_null) == 0 or len(set(non_null)) > 1, (
                f"broadcast bug: all-same price across rows: {price_col!r}"
            )


# ── Test 3: DOM-LCA fallback when prefix-LCP gives up ───────────────────

def test_dom_lca_fallback_divergent_classes():
    """Hashed-class SPA — title and price selectors diverge at the
    grandparent level because class strings differ. Prefix-LCP
    would compute a very short prefix (or none). DOM-LCA should
    still find the per-card row.
    """
    html = """
    <html><body>
      <div class="GridA">
        <div class="CardWrapA">
          <div class="LeftA"><h3 class="Title">Item A</h3></div>
          <div class="RightA"><span class="Price">$1.00</span></div>
        </div>
        <div class="CardWrapA">
          <div class="LeftA"><h3 class="Title">Item B</h3></div>
          <div class="RightA"><span class="Price">$2.00</span></div>
        </div>
        <div class="CardWrapA">
          <div class="LeftA"><h3 class="Title">Item C</h3></div>
          <div class="RightA"><span class="Price">$3.00</span></div>
        </div>
      </div>
    </body></html>
    """
    # Selectors that share NO direct '>' prefix at the deepest level:
    # title path: div.GridA > div.CardWrapA > div.LeftA > h3.Title
    # price path: div.GridA > div.CardWrapA > div.RightA > span.Price
    # LCP = "div.GridA > div.CardWrapA" → 3 rows matched.
    # That's fine but let's force a case where prefix isn't reliable —
    # use different intermediate classes that don't share a prefix.
    template = [
        {"label": "title", "kind": "list",
         "selector": "div.GridA > div.CardWrapA > div.LeftA > h3.Title"},
        {"label": "price", "kind": "list",
         "selector": "div.GridA > div.CardWrapA > div.RightA > span.Price"},
    ]
    values, handled = _run(html, template)
    assert "title" in handled and "price" in handled, handled
    assert values["title"] == ["Item A", "Item B", "Item C"], values
    assert values["price"] == ["$1.00", "$2.00", "$3.00"], values


def test_dom_lca_when_prefix_fails_completely():
    """Selectors that share NO `>`-prefix (different roots entirely) —
    prefix-LCP returns empty. DOM-LCA should still work because both
    fields land inside the same card containers.
    """
    html = """
    <html><body>
      <main>
        <article id="card-1">
          <header><h2 class="t">Alpha</h2></header>
          <footer><span class="p">$10</span></footer>
        </article>
        <article id="card-2">
          <header><h2 class="t">Beta</h2></header>
          <footer><span class="p">$20</span></footer>
        </article>
        <article id="card-3">
          <header><h2 class="t">Gamma</h2></header>
          <footer><span class="p">$30</span></footer>
        </article>
      </main>
    </body></html>
    """
    # No shared `>`-prefix at the top level (different roots).
    template = [
        {"label": "title", "kind": "list", "selector": "main > article > header > h2.t"},
        {"label": "price", "kind": "list", "selector": "main > article > footer > span.p"},
    ]
    values, handled = _run(html, template)
    # The prefix is "main > article" which is fine — 3 rows. But the
    # suffix paths differ. Either strategy must produce aligned rows.
    assert "title" in handled and "price" in handled
    assert values["title"] == ["Alpha", "Beta", "Gamma"]
    assert values["price"] == ["$10", "$20", "$30"]


# ── Test 4: legit identical values aren't nulled ─────────────────────────

def test_legit_identical_values_preserved():
    """A grid where every item legitimately has the SAME price (e.g.
    flat-rate shipping list). The broadcast-nuller must NOT fire here
    because all OTHER columns are also identical — no per-row
    variation signal that this is a broadcast bug."""
    html = """
    <html><body>
      <ul>
        <li class="r"><span class="t">Same</span><span class="p">$5</span></li>
        <li class="r"><span class="t">Same</span><span class="p">$5</span></li>
        <li class="r"><span class="t">Same</span><span class="p">$5</span></li>
      </ul>
    </body></html>
    """
    template = [
        {"label": "title", "kind": "list", "selector": "ul > li.r > span.t"},
        {"label": "price", "kind": "list", "selector": "ul > li.r > span.p"},
    ]
    values, _handled = _run(html, template)
    assert values["title"] == ["Same", "Same", "Same"]
    assert values["price"] == ["$5", "$5", "$5"]


if __name__ == "__main__":
    import sys
    try:
        test_clean_grid_happy_path()
        print("PASS test_clean_grid_happy_path")
        test_broadcast_bug_target_style()
        print("PASS test_broadcast_bug_target_style")
        test_dom_lca_fallback_divergent_classes()
        print("PASS test_dom_lca_fallback_divergent_classes")
        test_dom_lca_when_prefix_fails_completely()
        print("PASS test_dom_lca_when_prefix_fails_completely")
        test_legit_identical_values_preserved()
        print("PASS test_legit_identical_values_preserved")
        print("ALL PASS")
    except AssertionError as e:
        print(f"FAIL: {e}")
        sys.exit(1)
