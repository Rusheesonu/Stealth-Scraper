"""Anti-bot bypass rate benchmark.

Runs the production engine router (NOT raw nodriver) against
bench/lists/protected.txt and reports per-vendor success rate plus an
overall number. The router picks the best engine for each URL's vendor
tag and escalates on failure, so a measured pass rate reflects the
WHOLE pipeline, not just one engine.

Usage:
    python -m bench.antibot                       # full list
    python -m bench.antibot --filter cloudflare   # only one vendor
    python -m bench.antibot --max 5               # first N URLs

Writes bench/results/antibot-<ts>.json.

Definitions (don't argue these without bumping the schema version):
  - success = NOT blocked by detect.py AND element_count >= 5
  - blocked = detect.detect_block() returned blocked=True
  - error   = scraper raised (timeout, network, OOM, etc.)

Per-vendor success rate is calculated only against URLs tagged with that
vendor in the list — control URLs (vendor=none) feed only the overall.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from collections import defaultdict
from dataclasses import asdict

from bench.lib import (
    BenchReport,
    BenchResult,
    _utc_now_iso,
    git_sha,
    load_url_list,
    scrape_many,
    write_report,
)


def _print_progress(r: BenchResult) -> None:
    """Live log so an operator can see the run advancing instead of staring
    at a silent terminal for 5 minutes. ASCII status — emoji glyphs render
    inconsistently in CI logs."""
    if r.success:
        status = "OK"
    elif r.blocked:
        status = f"BLOCK[{r.detected_vendor or '?'}]"
    else:
        status = f"ERR[{(r.error or 'fail')[:24]}]"
    engine = r.engine_used or "-"
    print(
        f"  [{r.elapsed_s:5.1f}s] {status:24}  eng={engine:9}  "
        f"{(r.expected_vendor or '-'):18}  {r.url[:70]}",
        flush=True,
    )


def _aggregate(results: list[BenchResult]) -> dict:
    """Build the summary block: overall + per-vendor + per-engine pass rates."""
    by_vendor: dict[str, dict] = defaultdict(
        lambda: {"total": 0, "success": 0, "blocked": 0, "error": 0}
    )
    by_engine: dict[str, dict] = defaultdict(
        lambda: {"total": 0, "success": 0}
    )
    for r in results:
        v = r.expected_vendor or "unknown"
        by_vendor[v]["total"] += 1
        if r.success:
            by_vendor[v]["success"] += 1
        if r.blocked:
            by_vendor[v]["blocked"] += 1
        if r.error:
            by_vendor[v]["error"] += 1
        if r.engine_used:
            by_engine[r.engine_used]["total"] += 1
            if r.success:
                by_engine[r.engine_used]["success"] += 1

    for v, d in by_vendor.items():
        d["pass_rate"] = round(d["success"] / max(d["total"], 1), 3)
    for e, d in by_engine.items():
        d["pass_rate"] = round(d["success"] / max(d["total"], 1), 3)

    # Overall (excluding control URLs from the bypass rate)
    non_control = [r for r in results if (r.expected_vendor or "") not in ("none", "unknown", "")]
    overall_total = len(non_control)
    overall_success = sum(1 for r in non_control if r.success)
    overall_blocked = sum(1 for r in non_control if r.blocked)
    overall_error = sum(1 for r in non_control if r.error)

    # Escalation telemetry — how often did the router fall through engines?
    escalations = sum(1 for r in results if r.escalation_path)

    return {
        "overall": {
            "total": overall_total,
            "success": overall_success,
            "blocked": overall_blocked,
            "error": overall_error,
            "pass_rate": round(overall_success / max(overall_total, 1), 3),
            "comment": "excludes vendor=none control URLs",
        },
        "by_vendor": dict(by_vendor),
        "by_engine": dict(by_engine),
        "control": {
            "total": sum(1 for r in results if r.expected_vendor == "none"),
            "success": sum(1 for r in results if r.expected_vendor == "none" and r.success),
        },
        "router": {
            "scrapes_with_escalation": escalations,
            "escalation_rate": round(escalations / max(len(results), 1), 3),
        },
    }


async def run(filter_vendor: str | None, max_n: int | None) -> int:
    urls = load_url_list("protected")
    if filter_vendor:
        urls = [(u, v) for u, v in urls if v == filter_vendor]
    if max_n:
        urls = urls[:max_n]
    if not urls:
        print("No URLs matched filter — nothing to run.", file=sys.stderr)
        return 1

    print(f"Running antibot benchmark: {len(urls)} URLs (via engine router)")
    print(f"  commit:   {git_sha()}")
    print(f"  filter:   {filter_vendor or '(all vendors)'}")
    print(f"  max:      {max_n or '(no cap)'}")
    print()
    print(f"  {'time':>5}   {'status':24}  {'engine':12}  {'expected':18}  url")
    print(f"  {'----':>5}   {'------':24}  {'------':12}  {'--------':18}  ---")

    t0 = time.perf_counter()
    results = await scrape_many(urls, on_done=_print_progress)
    duration = round(time.perf_counter() - t0, 2)

    summary = _aggregate(results)
    print()
    print(f"Done in {duration}s")
    print(f"  Overall: {summary['overall']['success']}/{summary['overall']['total']} "
          f"= {summary['overall']['pass_rate']:.1%}")
    print(f"  Control: {summary['control']['success']}/{summary['control']['total']}")
    print(f"  Router : escalations on {summary['router']['scrapes_with_escalation']} of {len(results)} "
          f"({summary['router']['escalation_rate']:.1%})")
    print("  Per-vendor:")
    for v, d in sorted(summary["by_vendor"].items()):
        if v == "none":
            continue
        print(f"    {v:22} {d['success']:>2}/{d['total']:<2}  ({d['pass_rate']:.1%})")
    print("  Per-engine (which engine actually delivered the success):")
    for e, d in sorted(summary["by_engine"].items()):
        print(f"    {e:22} {d['success']:>2}/{d['total']:<2}  ({d['pass_rate']:.1%})")

    payload = BenchReport(
        name="antibot",
        iso_timestamp=_utc_now_iso(),
        commit_sha=git_sha(),
        backend_endpoint="local-router (nodriver + curl_cffi + camoufox)",
        duration_s=duration,
        config={
            "filter_vendor": filter_vendor,
            "max_n": max_n,
            "url_count": len(urls),
        },
        summary=summary,
        results=[asdict(r) for r in results],
    )
    out = write_report("antibot", payload)
    print(f"\n  Report: {out.relative_to(out.parent.parent.parent)}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--filter", help="only run URLs tagged with this vendor")
    ap.add_argument("--max", type=int, help="cap to first N URLs (after filter)")
    args = ap.parse_args()
    sys.exit(asyncio.run(run(args.filter, args.max)))


if __name__ == "__main__":
    main()
