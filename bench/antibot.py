"""Anti-bot bypass rate benchmark.

Runs the production stealth stack against bench/lists/protected.txt and
reports per-vendor success rate plus an overall number.

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

from bench.lib import (
    BenchReport,
    BenchResult,
    git_sha,
    load_url_list,
    scrape_many,
    write_report,
)


def _print_progress(r: BenchResult) -> None:
    """Live log so an operator can see the run advancing instead of staring
    at a silent terminal for 5 minutes."""
    status = (
        "✅ ok"
        if r.success
        else (f"🛑 {r.detected_vendor}" if r.blocked else f"💥 {r.error or 'fail'}")
    )
    print(
        f"  [{r.elapsed_s:5.1f}s] {status:14}  "
        f"{r.expected_vendor:18}  {r.url[:80]}",
        flush=True,
    )


def _aggregate(results: list[BenchResult]) -> dict:
    """Build the summary block: overall + per-vendor pass rates."""
    by_vendor: dict[str, dict] = defaultdict(lambda: {"total": 0, "success": 0, "blocked": 0, "error": 0})
    for r in results:
        v = r.expected_vendor or "unknown"
        by_vendor[v]["total"] += 1
        if r.success:
            by_vendor[v]["success"] += 1
        if r.blocked:
            by_vendor[v]["blocked"] += 1
        if r.error:
            by_vendor[v]["error"] += 1

    # Compute pass-rate per vendor
    for v, d in by_vendor.items():
        d["pass_rate"] = round(d["success"] / max(d["total"], 1), 3)

    # Overall (excluding control URLs from the bypass rate — controls are sanity)
    non_control = [r for r in results if (r.expected_vendor or "") not in ("none", "unknown", "")]
    overall_total = len(non_control)
    overall_success = sum(1 for r in non_control if r.success)
    overall_blocked = sum(1 for r in non_control if r.blocked)
    overall_error = sum(1 for r in non_control if r.error)

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
        # Control results — separately tracked so a regression on easy URLs
        # gets caught even when "overall" looks fine.
        "control": {
            "total": sum(1 for r in results if r.expected_vendor == "none"),
            "success": sum(1 for r in results if r.expected_vendor == "none" and r.success),
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

    print(f"Running antibot benchmark: {len(urls)} URLs")
    print(f"  commit:   {git_sha()}")
    print(f"  filter:   {filter_vendor or '(all vendors)'}")
    print(f"  max:      {max_n or '(no cap)'}")
    print()
    print(f"  {'time':>5}   {'status':14}  {'expected':18}  url")
    print(f"  {'----':>5}   {'------':14}  {'--------':18}  ---")

    t0 = time.perf_counter()
    results = await scrape_many(urls, concurrency=1, on_done=_print_progress)
    duration = round(time.perf_counter() - t0, 2)

    summary = _aggregate(results)
    print()
    print(f"Done in {duration}s")
    print(f"  Overall: {summary['overall']['success']}/{summary['overall']['total']} "
          f"= {summary['overall']['pass_rate']:.1%}")
    print(f"  Control: {summary['control']['success']}/{summary['control']['total']}")
    print("  Per-vendor:")
    for v, d in sorted(summary["by_vendor"].items()):
        if v == "none":
            continue
        print(f"    {v:22} {d['success']:>2}/{d['total']:<2}  ({d['pass_rate']:.1%})")

    payload = BenchReport(
        name="antibot",
        iso_timestamp=__import__("datetime").datetime.utcnow().isoformat() + "Z",
        commit_sha=git_sha(),
        backend_endpoint="local-nodriver-via-app.snapshot",
        duration_s=duration,
        config={
            "concurrency": 1,
            "filter_vendor": filter_vendor,
            "max_n": max_n,
            "url_count": len(urls),
        },
        summary=summary,
        results=[__import__("dataclasses").asdict(r) for r in results],
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
