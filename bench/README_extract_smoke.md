# bench/extract_smoke.py — the broadcast catcher

End-to-end regression bench for the FULL extraction stack:
`snapshot -> LLM template generation -> per-row extraction`. Hits the
public `POST /public/snapshot-and-suggest` endpoint with a curated list
of real production URLs and asserts the response shape on each.

This is the "the bug is actually dead" contract. Unit tests prove
individual extraction code paths work in isolation; this bench proves
they work together on real pages. If a regression slips past the unit
suite (e.g. a new "every row shows the same price" broadcast bug), this
catches it in ~30 seconds.

## What it tests

For each URL the bench POSTs to `/public/snapshot-and-suggest` and
classifies the response:

| Verdict | Meaning | Counts as fail? |
|---|---|---|
| `PASS` | 200, elements > 0, title set, all list-kind fields have > 1 distinct value | no |
| `EXPECTED_BLOCK` | 422 `anti_bot_block` on a URL we explicitly tagged `category: expected_block` (Amazon, Target, etc.) — site blocked us, not our bug | no |
| `UNEXPECTED_BLOCK` | 422 `anti_bot_block` on a URL we expected to scrape — bypass regression, not extraction | yes (exit 2) |
| `BROADCAST` | 200 but at least one list-kind field had >= 3 rows of the SAME value — **the regression we're hunting** | yes (exit 1) |
| `EMPTY` | 200 but element_count = 0 or title missing — page loaded but is junk | yes (exit 2) |
| `ERROR` | non-200, non-422, or transport failure | yes (exit 2) |

Exit codes:
- `0` — all `PASS` or only `EXPECTED_BLOCK`
- `1` — at least one `BROADCAST` (real extraction regression)
- `2` — at least one `ERROR`, `EMPTY`, or `UNEXPECTED_BLOCK`

## How to run

```bash
# Against prod (default)
python -m bench.extract_smoke

# Cap to first 8 URLs (faster smoke during development)
python -m bench.extract_smoke --max 8

# Against a local backend
python -m bench.extract_smoke --api-base http://localhost:8000

# Or via env var
STEALTH_API_BASE=http://localhost:8000 python -m bench.extract_smoke
```

Each run writes `bench/results/extract-smoke-<UTC-timestamp>.json` so
we have history. Diff two runs to see what changed:

```bash
python -c "
import json
old = json.load(open('bench/results/extract-smoke-20260524T120000Z.json'))
new = json.load(open('bench/results/extract-smoke-20260524T160000Z.json'))
print('verdicts:', old['summary']['by_verdict'], '->', new['summary']['by_verdict'])
"
```

Total runtime: < 5 minutes for the full list (~12 URLs × ~15-25s each
+ inter-call jitter).

## How to add a new URL

Edit the `URLS` list at the top of `bench/extract_smoke.py`. Each entry:

```python
{
    "url": "https://example-store.com/category/widgets",
    "category": "ecommerce_listing",       # one of: static_clean,
                                            # docs_blog, ecommerce_listing,
                                            # platform_store, expected_block
    "expect_list_extraction": True,         # True if the page is a listing
                                            # with N rows; False for
                                            # single-entity pages
    "note": "What this URL guards against / why it's in the list",
},
```

Categories drive the per-category summary in the report but don't change
assertion logic — that's intentional. The bench is generic on purpose.

When to tag `category: expected_block`: if a site CONSISTENTLY returns
422 from your IP (Amazon, Target's PerimeterX wall, etc.). That stops
the bench treating it as a regression. If the bypass later improves and
the site starts succeeding, the bench will still pass (an unexpected
PASS is just a PASS).

## Interpreting failures

**`BROADCAST` (exit 1)** — the regression this bench exists to catch.
A `kind: list` template field returned >= 3 rows of identical values.
That means the LLM picked a global selector instead of a per-row one,
OR extract.py is broadcasting a single matched element across all rows.
This is a bug in the FULL stack, not site-specific — fix it in
`backend/app/extract.py` or `backend/app/assist.py`, not by removing
the URL.

**`UNEXPECTED_BLOCK` (exit 2)** — a site we used to scrape is now
walling us. Not an extraction bug. Two responses:
1. The site genuinely toughened up — move it to `category: expected_block`
2. Our bypass regressed — fix the stealth stack (`bench/antibot.py`
   should catch this independently)

**`EMPTY` (exit 2)** — page loaded (200) but element_count is 0 OR
title is empty. Means snapshot succeeded but rendered a blank page,
usually a heavy SPA that needs more wait time. Investigate in
`backend/app/snapshot.py`.

**`ERROR` (exit 2)** — HTTP 5xx, timeout, or transport failure. Check
the backend logs. If reproducible, it's a backend regression. If once,
re-run.

**Genuine page change** — a site redesigns, the LLM picks new selectors,
distinct counts change but no broadcast. Bench stays GREEN. The
`list_fields` summary in the JSON shows you the new shape so you can
sanity-check.

## The contract

This bench staying GREEN against prod is what makes us call extraction
"production-ready." Specifically:

1. After any change to `backend/app/extract.py`, `backend/app/assist.py`,
   or `backend/app/snapshot.py`, re-run against prod (or a staging
   deploy) before shipping.
2. CI should run this nightly against prod. Exit code 1 (BROADCAST) =
   page the on-call. Exit code 2 = lower-severity warn.
3. Adding a new URL is cheap (one dict in the list). Removing one
   without a replacement should require a comment explaining why the
   coverage gap is acceptable.

The bench does NOT contain site-specific assertion logic — no
`if url.contains("amazon")` branches anywhere. The assertion is the
universal one: "a list of N >= 3 identical values is the broadcast bug."
That's what makes it a stable contract over time.

## Relationship to the other extract bench

| Bench | Asks | When it fires |
|---|---|---|
| `extract_correctness.py` | Did the value come FROM the page (vs hallucinated by the LLM)? | per-field check via visible-text substring grounding |
| `extract_smoke.py` (this) | Does the FULL stack produce VARYING values on real listing pages? | per-list-field broadcast check |

They overlap on intent but check different failure modes. Both should
be green before declaring extraction stable.
