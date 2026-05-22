"""Contract tests for the FieldResult envelope.

Schema introduced 2026-05-22 per the pre-launch audit. The invariant:
every field returns `{value, source, confidence, selector_used,
reason_if_null}`. A `null` value is ALWAYS paired with a non-null
`reason_if_null`. There is no longer a way to get a silent null.

These tests pin the contract so future "simplify the envelope"
refactors that drop the reason field would visibly fail.
"""

from __future__ import annotations

import lxml.html as lxml_html

from app.extract import _pull, _envelope, FieldResult


# ── Helpers ────────────────────────────────────────────────────────────


def _tree(html: str):
    return lxml_html.fromstring(html)


def _assert_envelope_shape(result: FieldResult) -> None:
    """Every FieldResult MUST have all five keys with the right types."""
    assert isinstance(result, dict)
    assert "value" in result
    assert "source" in result
    assert "confidence" in result
    assert "selector_used" in result
    assert "reason_if_null" in result
    assert isinstance(result["confidence"], float)
    assert 0.0 <= result["confidence"] <= 1.0
    assert result["source"] in ("selector", "xpath", "llm", "heuristic", "none")
    # Invariant: null value MUST have a reason.
    is_empty = result["value"] is None or result["value"] == "" or result["value"] == []
    if is_empty:
        assert result["reason_if_null"], (
            f"silent null detected — empty value with no reason: {result!r}"
        )
    else:
        assert result["reason_if_null"] is None, (
            f"non-null value should clear reason: {result!r}"
        )


# ── Contract tests ─────────────────────────────────────────────────────


def test_selector_hit_returns_value_with_full_provenance():
    tree = _tree("<div><h1 class='t'>Hello</h1></div>")
    r = _pull(tree, {"label": "title", "selector": ".t", "kind": "text"})
    _assert_envelope_shape(r)
    assert r["value"] == "Hello"
    assert r["source"] == "selector"
    assert r["confidence"] == 1.0
    assert r["selector_used"] == ".t"
    assert r["reason_if_null"] is None


def test_selector_misses_returns_null_with_reason():
    tree = _tree("<div><h1 class='t'>Hello</h1></div>")
    r = _pull(tree, {"label": "rating", "selector": ".no-such", "kind": "text"})
    _assert_envelope_shape(r)
    assert r["value"] is None
    assert r["source"] == "none"
    assert r["confidence"] == 0.0
    assert r["selector_used"] == ".no-such"
    assert "matched zero nodes" in r["reason_if_null"]


def test_no_selector_no_xpath_returns_null_with_reason():
    tree = _tree("<div></div>")
    r = _pull(tree, {"label": "x", "kind": "text"})
    _assert_envelope_shape(r)
    assert r["value"] is None
    assert r["source"] == "none"
    assert r["confidence"] == 0.0
    assert r["selector_used"] is None
    assert "neither selector nor xpath" in r["reason_if_null"]


def test_xpath_fallback_records_source():
    tree = _tree("<div><span class='p'>42</span></div>")
    # Selector won't match — XPath should fall through and report
    # source="xpath".
    r = _pull(tree, {
        "label": "v",
        "selector": ".no-such",
        "xpath": "//span[@class='p']",
        "kind": "text",
    })
    _assert_envelope_shape(r)
    assert r["value"] == "42"
    assert r["source"] == "xpath"
    assert r["confidence"] == 1.0
    assert r["selector_used"] == "//span[@class='p']"


def test_selector_matches_but_empty_text_returns_half_confidence():
    """The "site has an empty value" case — selector hit but text is
    blank. Returns confidence 0.5 with an explanatory reason."""
    tree = _tree("<div><span class='empty'></span></div>")
    r = _pull(tree, {"label": "v", "selector": ".empty", "kind": "text"})
    _assert_envelope_shape(r)
    assert r["value"] is None
    assert r["source"] == "selector"
    assert r["confidence"] == 0.5
    assert r["selector_used"] == ".empty"
    assert "empty" in r["reason_if_null"]


def test_list_kind_hit_returns_list_value():
    tree = _tree(
        "<ul>"
        "<li class='i'>a</li>"
        "<li class='i'>b</li>"
        "<li class='i'>c</li>"
        "</ul>"
    )
    r = _pull(tree, {"label": "items", "selector": ".i", "kind": "list"})
    _assert_envelope_shape(r)
    assert r["value"] == ["a", "b", "c"]
    assert r["source"] == "selector"
    assert r["confidence"] == 1.0
    assert r["reason_if_null"] is None


def test_list_kind_miss_returns_empty_list_with_reason():
    tree = _tree("<div></div>")
    r = _pull(tree, {"label": "items", "selector": ".no-such", "kind": "list"})
    _assert_envelope_shape(r)
    assert r["value"] == []
    assert r["source"] == "none"
    assert r["confidence"] == 0.0
    assert "matched zero nodes" in r["reason_if_null"]


def test_envelope_helper_normalises_null_with_reason():
    """`_envelope` should refuse to ship a null without a reason."""
    e = _envelope(None, source="selector", confidence=0.0, selector_used=".x")
    # Caller forgot a reason — helper backfills a default one.
    assert e["reason_if_null"], "null without reason must not ship"


def test_envelope_helper_clears_reason_for_non_null():
    e = _envelope(
        "hello",
        source="selector",
        confidence=1.0,
        selector_used=".x",
        reason_if_null="should be cleared",
    )
    assert e["reason_if_null"] is None


def test_envelope_helper_clamps_confidence():
    e1 = _envelope("x", source="selector", confidence=1.5, selector_used=".x")
    assert e1["confidence"] == 1.0
    e2 = _envelope("x", source="selector", confidence=-0.5, selector_used=".x")
    assert e2["confidence"] == 0.0


def test_amazon_duplicate_bug_with_envelope_still_clean():
    """The combined test — duplicate-text fix flowing through the
    envelope. Both bugs gone in one pull."""
    tree = _tree("""
    <span class="a-price">
      <span class="a-offscreen">$319.99</span>
      <span aria-hidden="true">
        <span class="a-price-symbol">$</span>
        <span class="a-price-whole">319</span>
        <span class="a-price-fraction">99</span>
      </span>
    </span>
    """)
    r = _pull(tree, {"label": "price", "selector": ".a-price", "kind": "text"})
    _assert_envelope_shape(r)
    # The visibility-aware extractor returns the screen-reader copy
    # (only non-aria-hidden child) — exactly $319.99, no duplication.
    assert r["value"] == "$319.99"
    assert "$319.99$319.99" not in (r["value"] or "")
    assert r["source"] == "selector"
    assert r["confidence"] == 1.0
