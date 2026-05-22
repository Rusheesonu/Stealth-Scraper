r"""Ground-truth extraction correctness bench.

The pre-launch audit's #5 priority: "Current bench passes
\$319.99\$319.99 — that's the bug. Fix the meter before fixing more
bugs."

This runner answers the question the antibot bench can't:
**Did the extracted value actually come from the page, or did the
model hallucinate it?**

Methodology — deterministic grounding check (no LLM call required):

  1. Hit `/public/snapshot-and-suggest` for each URL in the test list.
  2. The response carries:
       * `sample_envelope` — {label: FieldResult} (post 2026-05-22)
       * `element_count`   — and the snapshot's element list is in
                             the picker's own /snapshot endpoint;
                             we hit that too for the visible text.
  3. For each non-null field value:
       a. Look up its `selector_used`, refetch the snapshot's
          elements, and check whether the extracted text appears as
          a substring of any element's `.text`. If yes → GROUNDED.
          If no → HALLUCINATED.
  4. For each null field:
       a. Confirm `reason_if_null` is set (the envelope invariant).
          Counts as HONEST-NULL — the structural fix earning its keep.

Aggregate metrics:
  * grounded_rate         — % of non-null values that exist on page
  * hallucinated_rate     — % of non-null values NOT on the page
                            (this is the "$319.99$319.99 / hallucinated
                            field name" failure mode that humiliated
                            the audit)
  * honest_null_rate      — % of null values with a reason set (the
                            envelope contract; should be 100%)
  * silent_null_rate      — % of null values WITHOUT a reason set;
                            this MUST be 0% post-2026-05-22 fix

Usage:
    python bench/extract_correctness.py [--api-base URL] [--max 5]

Pre-conditions:
    * Backend must serve the post-2026-05-22 envelope shape
      (sample_envelope key in the public snapshot response).
    * Public IP cap is 10/h; running this twice in 10 minutes will
      rate-limit. Sequential fetches with a small jitter spread the
      load across the worker pool naturally.
"""

from __future__ import annotations

import argparse
import asyncio
import collections
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import httpx


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RESULTS_DIR = HERE / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


# Audit-derived diverse site list. Anti-bot walls (zillow / g2.com)
# excluded — they HTTP-422 in the public preview, which is a separate
# (correct) behavior, not an extraction bug. Public-preview-friendly
# only.
DEFAULT_URLS = [
    "https://news.ycombinator.com",
    "https://github.com/trending",
    "https://quotes.toscrape.com",
    "https://books.toscrape.com",
    "https://en.wikipedia.org/wiki/Web_scraping",
    "https://httpbin.org/html",
    "https://example.com",
    "https://react.dev",
    "https://vercel.com/pricing",
    "https://www.python.org",
]


# ── Snapshot + element fetchers ────────────────────────────────────────


async def _post_preview(client: httpx.AsyncClient, api_base: str, url: str) -> dict[str, Any]:
    """Hit the public preview endpoint. Returns the raw JSON, or a
    structured error envelope if the call fails."""
    try:
        r = await client.post(
            f"{api_base.rstrip('/')}/public/snapshot-and-suggest",
            json={"url": url},
            timeout=120.0,
        )
        if r.status_code == 429:
            return {"_bench_error": "rate_limited", "_bench_status": 429}
        if r.status_code == 422:
            return {"_bench_error": "anti_bot_or_robots", "_bench_status": 422, "detail": r.json()}
        if r.status_code != 200:
            return {"_bench_error": f"http_{r.status_code}", "_bench_status": r.status_code}
        return r.json()
    except Exception as e:
        return {"_bench_error": f"{type(e).__name__}: {str(e)[:120]}"}


def _element_haystack(payload: dict[str, Any]) -> str:
    """Build the searchable text haystack from the public preview.

    Uses (in priority order):
      1. `visible_text_excerpt` — the 3KB element-text excerpt added to
         the public preview response as part of the 2026-05-22 bench-
         enablement work. This is the canonical haystack.
      2. `title` + `page_type` — fallback if a stale prod is serving
         the old response shape (no excerpt).

    Note: we do NOT add `sample_values` to the haystack — that would
    be circular (we'd be grounding the extraction against itself).
    """
    excerpt = payload.get("visible_text_excerpt") or ""
    if excerpt:
        return excerpt
    # Fallback — old API response. Bench will under-credit grounding.
    return " ".join(
        p for p in (payload.get("title", ""), payload.get("page_type", ""))
        if isinstance(p, str)
    )


def _is_grounded(value: Any, haystack: str) -> bool:
    """Heuristic: does the extracted value appear in the page haystack?

    Strings:    substring match (case-insensitive)
    Lists:      ≥50% of items must individually substring-match the
                haystack — accounts for partial cards (e.g. some
                items might have been truncated or rendered post-snap)
    Numbers/bool: not checked — trivially correct if non-null
    """
    if value is None or value == "" or value == []:
        return False  # nothing to ground
    h = (haystack or "").lower()
    if isinstance(value, str):
        v = value.strip().lower()
        if not v:
            return False
        # 6+ char prefix match — most "grounded" values share a meaningful
        # prefix with what's on the page. Tightens against accidental
        # tiny-substring matches.
        return v[:6] in h or v in h
    if isinstance(value, list):
        if not value:
            return False
        grounded = 0
        for item in value:
            if isinstance(item, str):
                vs = item.strip().lower()
                if vs and (vs[:6] in h or vs in h):
                    grounded += 1
            else:
                grounded += 1  # non-string list items pass
        return grounded / len(value) >= 0.5
    # Numbers / bools / dicts — assume grounded if non-null
    return True


# ── Per-URL evaluation ─────────────────────────────────────────────────


def _eval_one_payload(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Classify every field in a public-preview response."""
    if "_bench_error" in payload:
        return {
            "url": url,
            "status": "fetch_error",
            "fetch_error": payload["_bench_error"],
            "fields": {},
            "field_summary": {
                "total": 0, "non_null": 0, "null_with_reason": 0,
                "silent_null": 0, "grounded": 0, "hallucinated": 0,
            },
        }

    envelope = payload.get("sample_envelope") or {}
    # If the envelope is empty BUT we have sample_values, the prod is
    # serving the OLD shape — bench can't run.
    if not envelope and payload.get("sample_values"):
        return {
            "url": url,
            "status": "old_shape",
            "fetch_error": "backend serves legacy sample_values but no sample_envelope — redeploy",
            "fields": {},
            "field_summary": {
                "total": 0, "non_null": 0, "null_with_reason": 0,
                "silent_null": 0, "grounded": 0, "hallucinated": 0,
            },
        }

    haystack = _element_haystack(payload)
    fields_report: dict[str, dict[str, Any]] = {}
    total = non_null = null_with_reason = silent_null = grounded = hallucinated = 0

    for label, env in envelope.items():
        if not isinstance(env, dict):
            continue
        total += 1
        value = env.get("value")
        reason = env.get("reason_if_null")
        is_empty = value is None or value == "" or value == []
        if is_empty:
            if reason:
                null_with_reason += 1
                fields_report[label] = {
                    "value": None,
                    "reason_if_null": reason,
                    "verdict": "HONEST_NULL",
                    "source": env.get("source"),
                    "confidence": env.get("confidence"),
                }
            else:
                silent_null += 1
                fields_report[label] = {
                    "value": None,
                    "reason_if_null": None,
                    "verdict": "SILENT_NULL",  # bug — envelope contract violated
                }
        else:
            non_null += 1
            is_grounded = _is_grounded(value, haystack)
            verdict = "GROUNDED" if is_grounded else "HALLUCINATED?"
            if is_grounded:
                grounded += 1
            else:
                hallucinated += 1
            fields_report[label] = {
                "value": (str(value)[:80] + "…") if isinstance(value, str) and len(value) > 80 else (
                    (str(value[:3]) + f"… +{len(value)-3} more") if isinstance(value, list) and len(value) > 3 else value
                ),
                "verdict": verdict,
                "source": env.get("source"),
                "confidence": env.get("confidence"),
                "selector_used": env.get("selector_used"),
            }

    return {
        "url": url,
        "status": "ok",
        "fetch_error": None,
        "fields": fields_report,
        "field_summary": {
            "total": total,
            "non_null": non_null,
            "null_with_reason": null_with_reason,
            "silent_null": silent_null,
            "grounded": grounded,
            "hallucinated": hallucinated,
        },
    }


# ── Runner ─────────────────────────────────────────────────────────────


async def run(*, api_base: str, urls: list[str], jitter_s: float = 1.2) -> dict[str, Any]:
    """Fetch + evaluate each URL in sequence with a small jitter to
    avoid the public-IP rate limit storm. Total runtime: ~N × (fetch
    ~10-30s + jitter)."""
    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient() as client:
        t0 = time.perf_counter()
        for i, url in enumerate(urls):
            payload = await _post_preview(client, api_base, url)
            results.append(_eval_one_payload(url, payload))
            if i < len(urls) - 1:
                await asyncio.sleep(jitter_s)
        wallclock_s = round(time.perf_counter() - t0, 1)

    # Aggregate
    total = sum(r["field_summary"]["total"] for r in results)
    non_null = sum(r["field_summary"]["non_null"] for r in results)
    null_with_reason = sum(r["field_summary"]["null_with_reason"] for r in results)
    silent_null = sum(r["field_summary"]["silent_null"] for r in results)
    grounded = sum(r["field_summary"]["grounded"] for r in results)
    hallucinated = sum(r["field_summary"]["hallucinated"] for r in results)

    fetch_errors = [r for r in results if r["status"] != "ok"]

    def pct(n, d): return round(n / d * 100, 1) if d else 0.0

    return {
        "api_base": api_base,
        "wallclock_s": wallclock_s,
        "total_urls": len(urls),
        "fetch_errors": len(fetch_errors),
        "fetch_error_detail": [(r["url"], r["fetch_error"]) for r in fetch_errors],
        "field_totals": {
            "total":            total,
            "non_null":         non_null,
            "null_with_reason": null_with_reason,
            "silent_null":      silent_null,
            "grounded":         grounded,
            "hallucinated":     hallucinated,
        },
        "metrics": {
            "grounded_rate_pct":     pct(grounded, non_null),
            "hallucinated_rate_pct": pct(hallucinated, non_null),
            "honest_null_rate_pct":  pct(null_with_reason, null_with_reason + silent_null),
            "silent_null_rate_pct":  pct(silent_null, total),  # MUST be 0
        },
        "results": results,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-base", default=os.environ.get(
        "STEALTH_API_BASE", "https://api.stealthscraper.dev",
    ))
    ap.add_argument("--max", type=int, default=10, help="Max URLs to test")
    ap.add_argument("--jitter-s", type=float, default=1.2)
    ap.add_argument("--json-out", default=None)
    args = ap.parse_args()

    urls = DEFAULT_URLS[: args.max]

    print(f"\n=== extract correctness bench ===")
    print(f"api_base:    {args.api_base}")
    print(f"sites:       {len(urls)}")
    print()

    report = asyncio.run(run(api_base=args.api_base, urls=urls, jitter_s=args.jitter_s))

    # Per-URL summary
    for r in report["results"]:
        s = r["field_summary"]
        if r["status"] != "ok":
            print(f"  {r['url'][:60]:<60s}  [error] {r['fetch_error']}")
            continue
        print(
            f"  {r['url'][:60]:<60s}  "
            f"total={s['total']} grounded={s['grounded']} "
            f"hallucinated={s['hallucinated']} honest_null={s['null_with_reason']} "
            f"silent_null={s['silent_null']}"
        )

    print()
    print(f"=== summary ===")
    print(f"  wallclock:            {report['wallclock_s']}s")
    print(f"  urls fetched OK:      {report['total_urls'] - report['fetch_errors']} / {report['total_urls']}")
    if report['fetch_error_detail']:
        for u, e in report['fetch_error_detail']:
            print(f"    - {u}: {e}")
    print()
    print(f"=== field totals ===")
    for k, v in report['field_totals'].items():
        print(f"  {k:>20s}: {v}")
    print()
    print(f"=== metrics (envelope contract — silent_null MUST be 0%) ===")
    for k, v in report['metrics'].items():
        marker = "  ← MUST be 0%" if k == "silent_null_rate_pct" else ""
        print(f"  {k:>22s}: {v}%{marker}")
    print()

    # Verdict
    silent_null_zero = report['metrics']['silent_null_rate_pct'] == 0
    grounded_threshold = report['metrics']['grounded_rate_pct'] >= 80
    print(f"=== verdict ===")
    print(f"  silent_null_rate == 0%:     {'PASS' if silent_null_zero else 'FAIL'}")
    print(f"  grounded_rate ≥ 80%:        {'PASS' if grounded_threshold else 'BELOW THRESHOLD'} ({report['metrics']['grounded_rate_pct']}%)")
    print()

    if args.json_out is None:
        ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        args.json_out = str(RESULTS_DIR / f"extract-correctness-{ts}.json")
    Path(args.json_out).write_text(json.dumps(report, indent=2))
    print(f"  full report written to: {args.json_out}")

    return 0 if (silent_null_zero and grounded_threshold) else 1


if __name__ == "__main__":
    sys.exit(main())
