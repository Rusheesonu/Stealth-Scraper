# `normalizeListSelector` — behavior reference

Living reference of expected input → output. **Update this file whenever
you change `normalizeListSelector` or `computeListSelector` in
`frontend/lib/utils.ts`.** Future devs read this to know what's safe to
add and what's a regression. Until we add a real test runner (vitest /
jest), this doc is the spec.

The function's purpose: turn a single-element CSS selector (as emitted
by the picker's `buildCssSelector` walker) into a CANONICAL pattern
that other DOM elements with the same structural shape will normalize
to. Used by `findSiblings()` to detect when the user clicked something
that's part of a repeating pattern (product grid, search results,
table rows).

## Design principle — narrow heuristics, safe failure

| Failure mode | Severity | What it looks like |
|---|---|---|
| Over-strip (false positive) | Bad UX — user sees null | User picks a price; we strip `.product-card-2024` thinking it's a hash; resulting selector matches NOTHING; extraction returns empty |
| Under-strip (false negative) | Mild UX — user sees duplicates or no auto-list | Picker doesn't find siblings; user manually toggles list mode; data still extractable |

We chose **safer failure mode**: under-strip. Only the deterministic
documented emit patterns of named CSS-in-JS libraries are stripped.

## Stripped patterns (library-deterministic)

| Pattern | Source | Example input → output |
|---|---|---|
| `:nth-of-type(N)` | Spec | `div.card:nth-of-type(3)` → `div.card` |
| `:nth-child(N)` | Spec | `li:nth-child(2)` → `li` |
| `:nth-last-of-type(N)` | Spec | `tr:nth-last-of-type(1)` → `tr` |
| `#uuid` | RFC 4122 UUID format | `#a1b2c3d4-1234-5678-90ab-cdef12345678 > div` → `> div` |
| `#long-hex` | 16+ contiguous hex | `#0123456789abcdef > div` → `> div` |
| `#word-digits` | Per-instance numeric-suffix ID (≥6 digits) | `#product-card-price-90581936 > div` → `> div` |
| `.css-XXXX` | emotion | `div.css-1abc23d > h3` → `div > h3` |
| `.sc-XXXX` | styled-components base | `div.sc-bcXkLm > h3` → `div > h3` |
| `.jsx-NNNN` | Next.js styled-jsx | `div.jsx-1234567890 > h3` → `div > h3` |
| `.Component__XXXX` | CSS Modules double-underscore | `div.Card__wrapper-3xK9j > h3` → `div > h3` |
| `[data-test*="42"]` | attr selector with digit value | `div[data-testid="card-42"] > h3` → `div > h3` |

## KEPT (real semantic classes — never stripped)

These look hash-ish but ARE semantic class names in real codebases.
Stripping them would break extraction on those sites.

| Pattern | Why kept | Real example |
|---|---|---|
| `.product-card` | Single-word semantic | Most e-commerce sites |
| `.bg-gray-500`, `.text-blue-500` | Tailwind utility | Every Tailwind site |
| `.h-12`, `.w-1/2` | Tailwind sizing | Every Tailwind site |
| `.grid`, `.flex` | Single-word layout | Bootstrap, Tailwind, vanilla |
| `.hidden`, `.d-none`, `.lg:hidden` | Could be visibility utility OR semantic | "Visibility filtering is the BACKEND's job, not normalize's" |
| `.menu_item`, `.post_2024` | Single underscore semantic | Many older codebases |
| `.product-card-2024` | Year-tag suffix (could be semantic) | Versioned components |
| `#main`, `#header`, `#footer` | Semantic id without hex/digit run | Any site |
| `[data-test="product-card"]` | attr selector with NO digits | Most testid conventions |

## Concrete cases (run mentally; update doc when behavior shifts)

```
INPUT:  div.grid > article.card:nth-of-type(3) > h3.title
OUTPUT: div.grid > article.card > h3.title
WHY:    Only :nth-of-type(3) stripped — everything else is semantic.

INPUT:  div.wrapper > div.css-1abc23d > span.text
OUTPUT: div.wrapper > div > span.text
WHY:    .css-1abc23d is emotion library output, stripped. The empty
        div that remains keeps the structural step.

INPUT:  div[data-testid="card-42"] > h3
OUTPUT: div > h3
WHY:    data-testid value contains digits → instance-specific marker,
        the whole attribute selector dropped.

INPUT:  body > main > article.product-card > .price
OUTPUT: body > main > article.product-card > .price
WHY:    Nothing matches a hash pattern. All class names are semantic.
        Identity result.

INPUT:  div.product-card-2024 > h3
OUTPUT: div.product-card-2024 > h3
WHY:    Could be a year-tag (semantic). We don't strip digit-suffixes
        anymore — too risky. Kept as-is.

INPUT:  div.menu_item > a.link
OUTPUT: div.menu_item > a.link
WHY:    Single underscore is common in semantic naming. We don't strip
        unless we see the double-underscore CSS-Modules canonical emit.

INPUT:  div.Card__wrapper-3xK9j > div.Card__body-aPq2 > h3
OUTPUT: div > div > h3
WHY:    Both Card__... are CSS-Modules double-underscore emit format,
        stripped.

INPUT:  div.sc-aBcD > div.sc-eFgH > h3
OUTPUT: div > div > h3
WHY:    Both styled-components base classes stripped.

INPUT:  div.jsx-1234567890 > h3
OUTPUT: div > h3
WHY:    Next.js styled-jsx hash stripped.

INPUT:  div.jsx-foo > h3
OUTPUT: div.jsx-foo > h3
WHY:    `jsx-` followed by NON-digits is not the Next.js pattern.
        Kept (could be a semantic ".jsx-foo" class name).

INPUT:  div.lg:hidden > h3
OUTPUT: div.lg:hidden > h3
WHY:    Tailwind responsive visibility. We don't strip — could be
        semantic. Backend filters HIDDEN elements via inline style /
        aria-hidden / HTML5 hidden attribute (spec-universal), not
        via class name.

INPUT:  #fc2efb3a-7e8c-4d5d-9a6b-1234567890ab > article > h3
OUTPUT: > article > h3
WHY:    UUID anchor stripped (per-instance random).

INPUT:  #product-card-price-90581936 > div[data-test="current-price"]
OUTPUT: > div[data-test="current-price"]
WHY:    Per-instance numeric-suffix ID stripped. Target's product cards
        use this exact pattern (each card gets `#product-card-price-NNNNN`
        anchored to the product ID). Without this strip the picker's
        list selector matches only the clicked card, leading to the
        broadcast-or-null shape across the rest of the products.

INPUT:  #post-1234567 > .title
OUTPUT: > .title
WHY:    Same family — WordPress posts, eBay listings, Steam app IDs,
        Shopify section IDs all follow `<word>-<digits>` per-instance.

INPUT:  #section-2024 > div
OUTPUT: #section-2024 > div
WHY:    Year tag (≤5 digits). Kept — not stripped because the digit
        suffix is too short to be confidently a per-row instance ID.
```

## The leading-orphan-combinator invariant (computeListSelector)

After ANY anchor strip, the output MUST NOT start with `>`. Leading
combinators are invalid CSS and match zero elements. Both
`normalizeListSelector` and `computeListSelector` must strip
leading `>` after their replacements.

Symptom when this breaks: picker says "Found N similar" at click time
(using `normalizeListSelector` for sibling detection — that function
has the cleanup) but extraction returns `list · 0` (using the stored
selector from `computeListSelector` — used to be missing the cleanup
until 2026-05-24).

```
INPUT (after INSTANCE_ID strip): > div[data-test="X"] > span
OUTPUT:                          div[data-test="X"] > span
WHY:    Leading orphan combinator removed.

INPUT:  div.product-card > div.product-card > h3
OUTPUT: div.product-card > div.product-card > h3
WHY:    Same identifier twice — both kept; not a hash.
```

## How to add a new pattern

1. Confirm the pattern is **documented public output** of a named CSS-in-JS
   library (not a guess about general structure).
2. Find an existing strip rule that's analogous and copy its structure.
3. Add a `KEPT` test case showing a similar-looking SEMANTIC class
   name is preserved (e.g. if you add a new strip rule, prove it
   doesn't false-positive on real names).
4. Update this doc with the new pattern in both tables + 1-2 cases.
5. Cross-reference the rule in JSDoc on `normalizeListSelector`.

## How to remove a pattern

Same as the rollback in commit `6eba699`:
- Update JSDoc on `normalizeListSelector` to reflect removal
- Update this doc's tables
- Add a "KEPT" case showing the previously-stripped pattern is now
  retained (so anyone re-adding it has to fight an explicit test)
