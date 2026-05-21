"""Throughput benchmark — pages/$ on a fixed list with a fixed proxy budget.

Headline metric: pages successfully scraped per US dollar spent on
infrastructure. Tracked every iteration per win-condition #3.

Usage:
    python -m bench.throughput
    python -m bench.throughput --max 10

Cost model (configurable via env vars — defaults match the Lightsail +
Webshare datacenter setup we ship today):

    BENCH_HOURLY_COMPUTE_USD   default 0.055  (AWS Lightsail $40/mo / 730h)
    BENCH_PROXY_PER_REQ_USD    default 0.00001  (Webshare DC unlimited)
    BENCH_PROXY_PER_GB_USD     default 0       (DC bundled bandwidth)

Adjust these if you switch to BrightData residential, etc., to get an
honest pages/$ number that reflects your actual stack.

Writes bench/results/throughput-<ts>.json.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import time
from dataclasses import asdict

from bench.lib import (
    BenchReport,
    BenchResult,
    git_sha,
    load_url_list,
    scrape_many,
    write_report,
)


def _cost_estimate(elapsed_s_total: float, request_count: int, bytes_count: int) -> dict:
    """Compute cost using env-var-driven rates so users can plug their real
    pricing in. Returns a small dict that goes into the report so reviewers
    can audit the math."""
    hourly_compute = float(os.getenv("BENCH_HOURLY_COMPUTE_USD", "0.055"))
    proxy_per_req = float(os.getenv("BENCH_PROXY_PER_REQ_USD", "0.00001"))
    proxy_per_gb = float(os.getenv("BENCH_PROXY_PER_GB_USD", "0"))

    compute_usd = (elapsed_s_total / 3600.0) * hourly_compute
    proxy_req_usd = proxy_per_req * request_count
    proxy_gb_usd = proxy_per_gb * (bytes_count / (1024 ** 3))
    total = compute_usd + proxy_req_usd + proxy_gb_usd

    return {
        "compute_usd": round(compute_usd, 6),
        "proxy_req_usd": round(proxy_req_usd, 6),
        "proxy_gb_usd": round(proxy_gb_usd, 6),
        "total_usd": round(total, 6),
        "rates_used": {
            "hourly_compute_usd": hourly_compute,
            "proxy_per_req_usd": proxy_per_req,
            "proxy_per_gb_usd": proxy_per_gb,
        },
    }


def _print_progress(r: BenchResult) -> None:
    status = "✅" if r.success else ("🛑" if r.blocked else "💥")
    print(
        f"  {status} [{r.elapsed_s:5.1f}s]  el={r.element_count:>4}  {r.url[:90]}",
        flush=True,
    )


async def run(max_n: int | None) -> int:
    urls = load_url_list("throughput")
    if max_n:
        urls = urls[:max_n]
    if not urls:
        print("No URLs to run.", file=sys.stderr)
        return 1

    print(f"Running throughput benchmark: {len(urls)} URLs")
    print(f"  commit: {git_sha()}")
    print()

    t0 = time.perf_counter()
    results = await scrape_many(urls, concurrency=1, on_done=_print_progress)
    duration = round(time.perf_counter() - t0, 2)

    success = sum(1 for r in results if r.success)
    blocked = sum(1 for r in results if r.blocked)
    error = sum(1 for r in results if r.error)
    total = len(results)
    # Rough proxy for bytes — element_count × 1KB-ish; not exact but order-of-magnitude.
    bytes_count = sum(max(r.element_count, 1) * 1024 for r in results)

    cost = _cost_estimate(duration, total, bytes_count)
    pages_per_dollar = round(success / cost["total_usd"], 1) if cost["total_usd"] > 0 else None
    pass_rate = round(success / max(total, 1), 3)

    summary = {
        "total": total,
        "success": success,
        "blocked": blocked,
        "error": error,
        "pass_rate": pass_rate,
        "duration_s": duration,
        "avg_latency_s": round(duration / max(total, 1), 2),
        "throughput_pages_per_min": round(total / max(duration / 60, 0.001), 1),
        "cost_usd": cost,
        "pages_per_dollar": pages_per_dollar,
        "phase3_target_pages_per_dollar": 2000,
        "phase3_target_met": (pages_per_dollar or 0) >= 2000 and pass_rate >= 0.95,
    }

    print()
    print(f"Done in {duration}s")
    print(f"  Success: {success}/{total} = {pass_rate:.1%}")
    print(f"  Latency: avg {summary['avg_latency_s']}s  · throughput {summary['throughput_pages_per_min']}/min")
    print(f"  Cost:    ${cost['total_usd']} (compute ${cost['compute_usd']} + proxy ${cost['proxy_req_usd']})")
    print(f"  pages/$: {pages_per_dollar}  (target ≥2,000)")

    payload = BenchReport(
        name="throughput",
        iso_timestamp=__import__("datetime").datetime.utcnow().isoformat() + "Z",
        commit_sha=git_sha(),
        backend_endpoint="local-nodriver-via-app.snapshot",
        duration_s=duration,
        config={"max_n": max_n, "url_count": len(urls), "concurrency": 1},
        summary=summary,
        results=[asdict(r) for r in results],
    )
    out = write_report("throughput", payload)
    print(f"\n  Report: {out.relative_to(out.parent.parent.parent)}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--max", type=int, help="cap to first N URLs")
    args = ap.parse_args()
    sys.exit(asyncio.run(run(args.max)))


if __name__ == "__main__":
    main()
