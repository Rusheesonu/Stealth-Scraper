"""Throughput benchmark — pages/$ on a fixed list with a fixed proxy budget.

Headline metric: pages successfully scraped per US dollar spent on
infrastructure. Tracked every iteration per win-condition #3.

Runs through the engine router (NOT raw nodriver) so the throughput
number reflects the full multi-engine pipeline: curl_cffi at near-zero
cost when it works, browser engines when JS is required, escalation
when the cheap engine gets blocked.

Usage:
    python -m bench.throughput
    python -m bench.throughput --max 10

Cost model (configurable via env vars — defaults match the Lightsail +
Webshare datacenter setup we ship today):

    BENCH_HOURLY_COMPUTE_USD   default 0.055   (AWS Lightsail $40/mo / 730h)
    BENCH_PROXY_PER_REQ_USD    default 0.00001 (Webshare DC unlimited)
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
    _utc_now_iso,
    git_sha,
    load_url_list,
    scrape_many,
    write_report,
)


# Headline target for win-condition #3. Module-level so a reader can find
# it without parsing the summary block.
PHASE3_TARGET_PAGES_PER_DOLLAR = 2000


def _cost_estimate(
    elapsed_s_total: float,
    request_count: int,
    response_bytes: int,
) -> dict:
    """Compute cost using env-var-driven rates so users can plug their real
    pricing in. Returns a small dict that goes into the report so reviewers
    can audit the math.

    `response_bytes` is real HTML+JSON+image bytes — only the curl_cffi
    engine reports this accurately (Content-Length); browser engines
    can't easily attribute network bytes per scrape without instrumenting
    the CDP Network domain. We approximate by `len(html_text)` where
    available and 0 otherwise; the report exposes the bytes used so
    reviewers can sanity-check.
    """
    hourly_compute = float(os.getenv("BENCH_HOURLY_COMPUTE_USD", "0.055"))
    proxy_per_req = float(os.getenv("BENCH_PROXY_PER_REQ_USD", "0.00001"))
    proxy_per_gb = float(os.getenv("BENCH_PROXY_PER_GB_USD", "0"))

    compute_usd = (elapsed_s_total / 3600.0) * hourly_compute
    proxy_req_usd = proxy_per_req * request_count
    proxy_gb_usd = proxy_per_gb * (response_bytes / (1024 ** 3))
    total = compute_usd + proxy_req_usd + proxy_gb_usd

    return {
        "compute_usd": round(compute_usd, 6),
        "proxy_req_usd": round(proxy_req_usd, 6),
        "proxy_gb_usd": round(proxy_gb_usd, 6),
        "total_usd": round(total, 6),
        "response_bytes_used": response_bytes,
        "rates_used": {
            "hourly_compute_usd": hourly_compute,
            "proxy_per_req_usd": proxy_per_req,
            "proxy_per_gb_usd": proxy_per_gb,
        },
    }


def _print_progress(r: BenchResult) -> None:
    status = "OK" if r.success else ("BLOCK" if r.blocked else "ERR")
    eng = r.engine_used or "-"
    print(
        f"  {status:5} [{r.elapsed_s:5.1f}s]  eng={eng:9}  el={r.element_count:>4}  {r.url[:80]}",
        flush=True,
    )


def _estimate_response_bytes(r: BenchResult) -> int:
    """Per-result bytes proxy. We don't have a real network counter wired
    through the engine result yet, so we use element_count*256 as a
    floor estimate (real pages average ~256B/element after gzip). It's
    a rough approximation explicitly surfaced in `cost.response_bytes_used`
    so readers know not to trust it as a precise figure."""
    if r.element_count <= 0:
        return 0
    return r.element_count * 256


async def run(max_n: int | None) -> int:
    urls = load_url_list("throughput")
    if max_n:
        urls = urls[:max_n]
    if not urls:
        print("No URLs to run.", file=sys.stderr)
        return 1

    print(f"Running throughput benchmark: {len(urls)} URLs (via engine router)")
    print(f"  commit: {git_sha()}")
    print()

    t0 = time.perf_counter()
    results = await scrape_many(urls, on_done=_print_progress)
    duration = round(time.perf_counter() - t0, 2)

    success = sum(1 for r in results if r.success)
    blocked = sum(1 for r in results if r.blocked)
    error = sum(1 for r in results if r.error)
    total = len(results)
    response_bytes = sum(_estimate_response_bytes(r) for r in results)

    cost = _cost_estimate(duration, total, response_bytes)
    pages_per_dollar = round(success / cost["total_usd"], 1) if cost["total_usd"] > 0 else None
    pass_rate = round(success / max(total, 1), 3)

    # Engine mix — which engine carried the load?
    engine_counts: dict[str, int] = {}
    for r in results:
        if r.engine_used:
            engine_counts[r.engine_used] = engine_counts.get(r.engine_used, 0) + 1

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
        "engine_mix": engine_counts,
        "phase3_target_pages_per_dollar": PHASE3_TARGET_PAGES_PER_DOLLAR,
        "phase3_target_met": (
            (pages_per_dollar or 0) >= PHASE3_TARGET_PAGES_PER_DOLLAR
            and pass_rate >= 0.95
        ),
    }

    print()
    print(f"Done in {duration}s")
    print(f"  Success: {success}/{total} = {pass_rate:.1%}")
    print(f"  Latency: avg {summary['avg_latency_s']}s  · throughput {summary['throughput_pages_per_min']}/min")
    print(f"  Cost:    ${cost['total_usd']} (compute ${cost['compute_usd']} + proxy ${cost['proxy_req_usd']})")
    print(f"  pages/$: {pages_per_dollar}  (target >={PHASE3_TARGET_PAGES_PER_DOLLAR})")
    if engine_counts:
        print(f"  engine mix: " + ", ".join(f"{e}={n}" for e, n in sorted(engine_counts.items())))

    payload = BenchReport(
        name="throughput",
        iso_timestamp=_utc_now_iso(),
        commit_sha=git_sha(),
        backend_endpoint="local-router (nodriver + curl_cffi + camoufox)",
        duration_s=duration,
        config={"max_n": max_n, "url_count": len(urls)},
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
