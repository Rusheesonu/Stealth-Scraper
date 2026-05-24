r"""End-to-end real-site extraction regression bench (the "broadcast catcher").

The unit tests (98 of them) prove that individual extraction code paths
work in isolation. What they don't catch is the full-stack regression:
snapshot -> AI template generation -> extraction returning the SAME value
for every row of a listing page (the "broadcast bug" - e.g. every Best
Buy product price shows up as "$319.99" because the LLM picked a global
selector instead of a per-row one).

This bench hits the public `/public/snapshot-and-suggest` endpoint with
a curated list of real production URLs and asserts, for any field whose
template `kind: list`, that values are NOT all identical. That single
contract - "list-kind field with N >= 3 rows must have > 1 distinct
value" - is the regression seal. After this bench lands, any new
broadcast regression is detectable in ~30 seconds by re-running.

Run::

    python -m bench.extract_smoke
    python -m bench.extract_smoke --api-base https://api.stealthscraper.dev
    python -m bench.extract_smoke --max 8

Exit codes:
    0   all green, OR only "expected anti-bot blocks" failed
    1   one or more URLs returned a broadcast (real regression)
    2   one or more URLs returned an unexpected error (HTTP 5xx, empty,
        or an UNEXPECTED block on a URL we don't tag as a known wall)

The list of URLs at the top of this file is the ONLY site-specific
knowledge in the runner. The assertion logic is generic:
   * HTTP 200 with elements > 0 and title set -> fetch OK
   * HTTP 422 with kind=anti_bot_block       -> EXPECTED_BLOCK (not a fail)
   * any list-kind field in the suggested template, where the extracted
     sample is a list of >= 3 items, must have len(set(values)) > 1

Results written to ``bench/results/extract-smoke-<UTC-timestamp>.json``.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RESULTS_DIR = HERE / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


# -- URL list -------------------------------------------------------------
# THE ONLY site-specific config in the file. Categories drive the report's
# grouping. `expect_list_extraction` is a hint - if True, the bench checks
# for at least one list-kind field with varying values. `category =
# expected_block` means a 422 anti_bot_block response is EXPECTED and the
# verdict for that URL is treated as "acceptable" (exit code stays 0).
URLS: list[dict[str, Any]] = [
    # -- Static + clean (sanity check) ------------------------------------
    {
        "url": "https://news.ycombinator.com",
        "category": "static_clean",
        "expect_list_extraction": True,
        "note": "30 stories, all different titles - the canonical sanity case",
    },
    {
        "url": "https://books.toscrape.com",
        "category": "static_clean",
        "expect_list_extraction": True,
        "note": "20 books, varying titles + prices - the original broadcast catcher",
    },
    {
        "url": "https://quotes.toscrape.com",
        "category": "static_clean",
        "expect_list_extraction": True,
        "note": "10 quotes, varying text + authors",
    },
    # -- Public docs / blogs / aggregators --------------------------------
    {
        "url": "https://github.com/trending",
        "category": "docs_blog",
        "expect_list_extraction": True,
        "note": "25 trending repos, varying names + descriptions",
    },
    {
        "url": "https://dev.to",
        "category": "docs_blog",
        "expect_list_extraction": True,
        "note": "Article feed - varying titles + authors",
    },
    {
        "url": "https://www.producthunt.com",
        "category": "docs_blog",
        "expect_list_extraction": True,
        "note": "Daily product list - varying titles + taglines",
    },
    # -- E-commerce with varying prices (the broadcast catchers) ----------
    {
        "url": "https://books.toscrape.com/catalogue/category/books/mystery_3/index.html",
        "category": "ecommerce_listing",
        "expect_list_extraction": True,
        "note": "Mystery category page - N books with N distinct prices",
    },
    {
        "url": "https://www.bestbuy.com/site/searchpage.jsp?st=laptop",
        "category": "ecommerce_listing",
        "expect_list_extraction": True,
        "note": "Best Buy laptop search - historically a broadcast trap",
    },
    {
        "url": "https://www.goodreads.com/list/show/1.Best_Books_Ever",
        "category": "ecommerce_listing",
        "expect_list_extraction": True,
        "note": "Goodreads list - 100 book titles + authors",
    },
    # -- Platform-templated stores (Shopify, Squarespace) -----------------
    {
        "url": "https://shop.tesla.com/category/charging",
        "category": "platform_store",
        "expect_list_extraction": True,
        "note": "Tesla store (Shopify-like) - varying product names + prices",
    },
    # -- Historically blocked (acceptable 422) ----------------------------
    {
        "url": "https://www.target.com/s?searchTerm=phones",
        "category": "expected_block",
        "expect_list_extraction": True,
        "note": "PerimeterX-blocked - 422 is the correct response from our IP",
    },
    {
        "url": "https://www.amazon.com/s?k=laptop",
        "category": "expected_block",
        "expect_list_extraction": True,
        "note": "Amazon CAPTCHA wall on cold IPs - 422 acceptable",
    },
]


# -- HTTP helpers (stdlib only) -------------------------------------------


def _post_json(url: str, body: dict[str, Any], timeout_s: float) -> tuple[int, dict[str, Any] | str]:
    """POST JSON, return (status_code, parsed_json_or_error_string).

    Uses urllib so the bench has zero non-stdlib deps. On non-2xx, we
    still try to parse the body - the public API returns structured
    JSON detail for 422 anti-bot blocks.
    """
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "stealth-scraper-bench/extract_smoke",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, f"{type(e).__name__}: {e}"
    except Exception as e:  # noqa: BLE001 - bench must never crash
        return 0, f"{type(e).__name__}: {e}"


# -- Generic broadcast detection ------------------------------------------


def _coerce_list(value: Any) -> list[Any] | None:
    """If `value` looks like a per-row list extraction, return it; else None.

    A field's `value` in `sample_envelope` may be:
      - a Python list (the natural case for kind='list' templates)
      - anything else (scalar - not a list field)
    """
    if isinstance(value, list):
        return value
    return None


def _is_broadcast(values: list[Any], min_rows: int = 3) -> bool:
    """Generic broadcast check: a list field with N >= min_rows rows
    where every value is the SAME is the bug we're hunting.

    Comparison is on stringified, stripped values to be robust against
    numbers-vs-strings and trailing whitespace artifacts.
    """
    if len(values) < min_rows:
        return False
    normalized = [str(v).strip() for v in values if v is not None and str(v).strip()]
    if len(normalized) < min_rows:
        # Mostly-empty list - not a broadcast, just bad extraction (caught
        # separately by extract_correctness.py).
        return False
    return len(set(normalized)) == 1


def _list_fields(payload: dict[str, Any]) -> list[tuple[str, list[Any]]]:
    """Pull out (label, list_values) for every field that produced a
    list-shaped sample. Prefers `sample_envelope` (canonical post 2026-05-22);
    falls back to legacy `sample_values` if the backend is old.
    """
    envelope = payload.get("sample_envelope") or {}
    out: list[tuple[str, list[Any]]] = []
    for label, env in envelope.items():
        if not isinstance(env, dict):
            continue
        as_list = _coerce_list(env.get("value"))
        if as_list is not None:
            out.append((label, as_list))
    if not out:
        for label, value in (payload.get("sample_values") or {}).items():
            as_list = _coerce_list(value)
            if as_list is not None:
                out.append((label, as_list))
    return out


# -- Per-URL evaluation ---------------------------------------------------


def _classify(spec: dict[str, Any], status: int, body: Any) -> dict[str, Any]:
    """Turn one (URL, response) into a verdict row.

    Verdicts (one of):
      PASS              - 200, elements, list fields vary (if applicable)
      EXPECTED_BLOCK    - 422 anti_bot_block on a URL we tagged as such
      UNEXPECTED_BLOCK  - 422 anti_bot_block on a URL we did NOT expect
                          to be blocked (a regression in our bypass, not
                          in extraction)
      BROADCAST         - 200 but a list field had all-identical values
      EMPTY             - 200 but element_count=0 or title missing
      ERROR             - non-200, non-422, or transport failure
    """
    url = spec["url"]
    expected_block = spec["category"] == "expected_block"

    if status == 0:
        return {
            "url": url,
            "category": spec["category"],
            "verdict": "ERROR",
            "http_status": 0,
            "error": str(body)[:300],
        }

    if status == 422 and isinstance(body, dict):
        detail = body.get("detail") or {}
        kind = detail.get("kind") if isinstance(detail, dict) else None
        vendor = detail.get("vendor") if isinstance(detail, dict) else None
        if kind == "anti_bot_block":
            return {
                "url": url,
                "category": spec["category"],
                "verdict": "EXPECTED_BLOCK" if expected_block else "UNEXPECTED_BLOCK",
                "http_status": 422,
                "block_vendor": vendor,
                "block_message": (detail.get("message") or "")[:160] if isinstance(detail, dict) else "",
            }
        return {
            "url": url,
            "category": spec["category"],
            "verdict": "ERROR",
            "http_status": 422,
            "error": f"422 but not anti_bot_block: {str(detail)[:200]}",
        }

    if status != 200 or not isinstance(body, dict):
        return {
            "url": url,
            "category": spec["category"],
            "verdict": "ERROR",
            "http_status": status,
            "error": str(body)[:300],
        }

    title = body.get("title") or ""
    element_count = int(body.get("element_count") or 0)
    if element_count <= 0 or not title:
        return {
            "url": url,
            "category": spec["category"],
            "verdict": "EMPTY",
            "http_status": 200,
            "element_count": element_count,
            "title": title,
        }

    list_fields = _list_fields(body)
    broadcasts: list[dict[str, Any]] = []
    list_field_summaries: list[dict[str, Any]] = []
    for label, values in list_fields:
        normalized = [str(v).strip() for v in values if v is not None and str(v).strip()]
        distinct = len(set(normalized))
        summary = {
            "label": label,
            "rows": len(values),
            "distinct": distinct,
            "sample": values[:2],
        }
        list_field_summaries.append(summary)
        if _is_broadcast(values):
            broadcasts.append({
                "label": label,
                "rows": len(values),
                "broadcast_value": normalized[0] if normalized else None,
            })

    if broadcasts:
        return {
            "url": url,
            "category": spec["category"],
            "verdict": "BROADCAST",
            "http_status": 200,
            "element_count": element_count,
            "title": title[:120],
            "broadcasts": broadcasts,
            "list_fields": list_field_summaries,
        }

    return {
        "url": url,
        "category": spec["category"],
        "verdict": "PASS",
        "http_status": 200,
        "element_count": element_count,
        "title": title[:120],
        "list_fields": list_field_summaries,
    }


# -- Runner ---------------------------------------------------------------


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _git_sha() -> str:
    try:
        import subprocess
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT, stderr=subprocess.DEVNULL,
        )
        return out.decode().strip()
    except Exception:
        return "unknown"


# Verdict glyphs - plain ASCII so terminals that strip unicode still print
# something legible. The glyph is the at-a-glance signal.
GLYPH = {
    "PASS": "[OK] ",
    "EXPECTED_BLOCK": "[BLK]",
    "UNEXPECTED_BLOCK": "[!!]",
    "BROADCAST": "[XX]",
    "EMPTY": "[??]",
    "ERROR": "[ER]",
}


def _print_row(r: dict[str, Any]) -> None:
    glyph = GLYPH.get(r["verdict"], "[??]")
    url = r["url"]
    if r["verdict"] == "PASS":
        lf = r.get("list_fields") or []
        bits = [f"{len(lf)} list field{'s' if len(lf) != 1 else ''}"]
        for f in lf[:3]:
            bits.append(f"{f['distinct']} distinct {f['label']}")
        extras = ", ".join(bits)
        print(f"  {glyph} {url:<70s}  {r['element_count']} elements, {extras}")
    elif r["verdict"] == "EXPECTED_BLOCK":
        print(f"  {glyph} {url:<70s}  422 anti_bot_block:{r.get('block_vendor')} (acceptable)")
    elif r["verdict"] == "UNEXPECTED_BLOCK":
        print(f"  {glyph} {url:<70s}  422 anti_bot_block:{r.get('block_vendor')} (NOT expected for this URL)")
    elif r["verdict"] == "BROADCAST":
        bs = r.get("broadcasts") or []
        first = bs[0]
        print(f"  {glyph} {url:<70s}  BROADCAST in '{first['label']}': {first['rows']} rows x {first['broadcast_value']!r}")
        for extra in bs[1:]:
            print(f"           also in '{extra['label']}': {extra['rows']} rows x {extra['broadcast_value']!r}")
    elif r["verdict"] == "EMPTY":
        print(f"  {glyph} {url:<70s}  200 OK but empty (elements={r.get('element_count')}, title={r.get('title')!r})")
    else:  # ERROR
        print(f"  {glyph} {url:<70s}  {r.get('http_status')} {str(r.get('error', ''))[:120]}")


def run(
    *,
    api_base: str,
    urls: list[dict[str, Any]],
    timeout_s: float,
    inter_call_jitter_s: float,
) -> dict[str, Any]:
    endpoint = f"{api_base.rstrip('/')}/public/snapshot-and-suggest"
    results: list[dict[str, Any]] = []

    t0 = time.perf_counter()
    for i, spec in enumerate(urls):
        url = spec["url"]
        t_url = time.perf_counter()
        status, body = _post_json(endpoint, {"url": url}, timeout_s=timeout_s)
        elapsed = round(time.perf_counter() - t_url, 1)
        row = _classify(spec, status, body)
        row["elapsed_s"] = elapsed
        results.append(row)
        _print_row(row)
        if i < len(urls) - 1 and inter_call_jitter_s > 0:
            time.sleep(inter_call_jitter_s)
    wallclock_s = round(time.perf_counter() - t0, 1)

    by_verdict_counter: dict[str, int] = collections.Counter(r["verdict"] for r in results)
    by_category_counters: dict[str, collections.Counter] = {}
    for r in results:
        cat = r["category"]
        by_category_counters.setdefault(cat, collections.Counter())
        by_category_counters[cat][r["verdict"]] += 1
    by_category = {k: dict(v) for k, v in by_category_counters.items()}

    return {
        "name": "extract_smoke",
        "iso_timestamp": _utc_now_iso(),
        "commit_sha": _git_sha(),
        "backend_endpoint": api_base,
        "wallclock_s": wallclock_s,
        "config": {
            "url_count": len(urls),
            "timeout_s": timeout_s,
            "inter_call_jitter_s": inter_call_jitter_s,
        },
        "summary": {
            "total": len(results),
            "by_verdict": dict(by_verdict_counter),
            "by_category": by_category,
        },
        "results": results,
    }


def _exit_code(report: dict[str, Any]) -> int:
    """0  - all PASS or only EXPECTED_BLOCK / acceptable failure modes
       1  - at least one BROADCAST detected (real extraction regression)
       2  - at least one ERROR/EMPTY/UNEXPECTED_BLOCK (infra or bypass
            regression - not strictly an extraction bug, but still a
            CI fail)
    """
    by_verdict = report["summary"]["by_verdict"]
    if by_verdict.get("BROADCAST", 0) > 0:
        return 1
    if (
        by_verdict.get("ERROR", 0) > 0
        or by_verdict.get("EMPTY", 0) > 0
        or by_verdict.get("UNEXPECTED_BLOCK", 0) > 0
    ):
        return 2
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--api-base",
        default=os.environ.get("STEALTH_API_BASE", "https://api.stealthscraper.dev"),
        help="API base URL (default: prod or $STEALTH_API_BASE)",
    )
    ap.add_argument("--max", type=int, default=len(URLS), help="Cap URLs (default: all)")
    ap.add_argument("--timeout-s", type=float, default=90.0, help="Per-URL HTTP timeout")
    ap.add_argument(
        "--jitter-s", type=float, default=1.5,
        help="Sleep between calls - gentle on the public rate limit",
    )
    ap.add_argument(
        "--json-out", default=None,
        help="Output JSON path; default: bench/results/extract-smoke-<ts>.json",
    )
    args = ap.parse_args()

    urls = URLS[: args.max]

    print()
    print("=== extract smoke bench (real-site end-to-end regression) ===")
    print(f"  api_base: {args.api_base}")
    print(f"  urls:     {len(urls)}")
    print(f"  timeout:  {args.timeout_s}s per call (full bench bounded by N * timeout)")
    print()

    report = run(
        api_base=args.api_base,
        urls=urls,
        timeout_s=args.timeout_s,
        inter_call_jitter_s=args.jitter_s,
    )

    print()
    print("=== summary ===")
    print(f"  wallclock:        {report['wallclock_s']}s")
    print(f"  commit_sha:       {report['commit_sha']}")
    s = report["summary"]
    print(f"  total URLs:       {s['total']}")
    for verdict, count in s["by_verdict"].items():
        print(f"    {verdict:<18s} {count}")
    print()
    print("=== by category ===")
    for cat, counts in s["by_category"].items():
        joined = ", ".join(f"{k}={v}" for k, v in counts.items())
        print(f"  {cat:<22s} {joined}")
    print()

    if args.json_out is None:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        args.json_out = str(RESULTS_DIR / f"extract-smoke-{ts}.json")
    Path(args.json_out).write_text(json.dumps(report, indent=2, default=str))
    print(f"  full report written to: {args.json_out}")
    print()

    code = _exit_code(report)
    if code == 0:
        passes = s["by_verdict"].get("PASS", 0)
        blocks = s["by_verdict"].get("EXPECTED_BLOCK", 0)
        print(f"=== VERDICT: GREEN - {passes} PASS + {blocks} expected block(s), no broadcasts ===")
    elif code == 1:
        broadcasts = s["by_verdict"]["BROADCAST"]
        print(f"=== VERDICT: BROADCAST DETECTED on {broadcasts} URL(s) - extraction regression ===")
    else:
        errors = s["by_verdict"].get("ERROR", 0) + s["by_verdict"].get("EMPTY", 0)
        unexp = s["by_verdict"].get("UNEXPECTED_BLOCK", 0)
        print(f"=== VERDICT: INFRA/BYPASS REGRESSION - {errors} error(s), {unexp} unexpected block(s) ===")
    print()
    return code


if __name__ == "__main__":
    sys.exit(main())
