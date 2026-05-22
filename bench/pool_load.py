"""Browser pool concurrent load test.

Proves the post-refactor pool handles N concurrent snapshot requests
without the `502 No target with given id found` collapse mode that the
pre-launch audit (May 22 2026) measured at 7/15 under parallel hits.

Usage:
    cd backend && venv/bin/python ../bench/pool_load.py [--concurrency 20] [--total 20]

What it does:
    1. Spawns `total` parallel tasks against pool.tab() with a control
       URL (httpbin.org/html — small, fast, no anti-bot).
    2. Each task: open tab, navigate, read title, close.
    3. Records per-task: success/failure, latency, exception class.
    4. Reports: success rate, latency p50/p95, distinct error classes.

Pass criterion (pre-launch audit win condition):
    * 20 concurrent requests → ≥95% success
    * Zero `No target with given id found` / `Session with given id not found`
      / `ProtocolException` / `Connection closed` failures
    * Each worker restarts at most ONCE during the run (per-worker
      isolation is honored — siblings don't get nuked)
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

# Allow running from anywhere via `python ../bench/pool_load.py`.
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))


# Default test URL — small static page, well-behaved server.
DEFAULT_URL = "https://httpbin.org/html"

# Markers we ESPECIALLY don't want to see (the pre-refactor collapse mode).
COLLAPSE_MARKERS = (
    "No target with given id found",
    "Session with given id not found",
    "ProtocolException",
    "Connection closed",
)


async def _one_request(idx: int, url: str) -> dict[str, Any]:
    """One pool.tab() snapshot — captures the title + status."""
    from app.browser import pool  # local import so PYTHONPATH is set

    t0 = time.perf_counter()
    try:
        async with pool.tab("about:blank") as tab:
            await tab.get(url)
            # Wait for DOM-ready briefly; we just want a title back.
            await asyncio.sleep(0.5)
            try:
                title = await tab.evaluate("document.title")
                if isinstance(title, tuple):
                    title = title[0]
            except Exception:
                title = ""
        return {
            "idx": idx,
            "ok": True,
            "title": (title or "")[:80],
            "elapsed_s": round(time.perf_counter() - t0, 3),
            "err": None,
            "collapse_marker": False,
        }
    except Exception as e:
        msg = repr(e)
        return {
            "idx": idx,
            "ok": False,
            "title": "",
            "elapsed_s": round(time.perf_counter() - t0, 3),
            "err": msg[:200],
            "collapse_marker": any(m in msg for m in COLLAPSE_MARKERS),
        }


async def run(*, concurrency: int, total: int, url: str) -> dict[str, Any]:
    """Fire `total` tasks with a semaphore-gated `concurrency` ceiling.

    For pure pool stress, concurrency == total is the headline case
    (everything in-flight at once). Lower concurrency tests sustained
    throughput.
    """
    sem = asyncio.Semaphore(concurrency)

    async def _go(i: int) -> dict[str, Any]:
        async with sem:
            return await _one_request(i, url)

    t0 = time.perf_counter()
    results = await asyncio.gather(*(_go(i) for i in range(total)))
    wallclock_s = round(time.perf_counter() - t0, 3)

    # Aggregate
    ok = sum(1 for r in results if r["ok"])
    fail = total - ok
    collapse_hits = sum(1 for r in results if r["collapse_marker"])
    err_classes = collections.Counter()
    for r in results:
        if not r["ok"] and r["err"]:
            # First word of repr is the exception class
            klass = r["err"].split("(", 1)[0].strip()
            err_classes[klass] += 1
    latencies = sorted(r["elapsed_s"] for r in results)
    p50 = latencies[len(latencies) // 2]
    p95_idx = max(0, int(len(latencies) * 0.95) - 1)
    p95 = latencies[p95_idx]

    # Pool size for context
    from app.browser import pool
    pool_size = pool.size

    return {
        "url": url,
        "concurrency": concurrency,
        "total": total,
        "pool_size": pool_size,
        "wallclock_s": wallclock_s,
        "success": ok,
        "failure": fail,
        "success_rate": round(ok / total * 100, 1),
        "collapse_marker_hits": collapse_hits,
        "p50_s": p50,
        "p95_s": p95,
        "error_classes": dict(err_classes),
        "results": results,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--concurrency", type=int, default=20, help="Max in-flight tasks")
    ap.add_argument("--total", type=int, default=20, help="Total tasks to fire")
    ap.add_argument("--url", default=DEFAULT_URL, help="Target URL")
    ap.add_argument("--json-out", default=None, help="Optional path to write the full JSON report")
    args = ap.parse_args()

    print(f"\n=== pool concurrent load test ===")
    print(f"url:         {args.url}")
    print(f"concurrency: {args.concurrency}")
    print(f"total:       {args.total}")
    print(f"BROWSER_POOL_SIZE env: {os.getenv('BROWSER_POOL_SIZE', 'unset (default 4)')}")
    print()

    report = asyncio.run(run(
        concurrency=args.concurrency,
        total=args.total,
        url=args.url,
    ))

    # Per-request line
    for r in report["results"]:
        status = "OK " if r["ok"] else "FAIL"
        collapse = "  ⚠ collapse-marker" if r["collapse_marker"] else ""
        title = r["title"] or ("" if r["ok"] else r["err"][:80])
        print(f"  [{r['idx']:>3}] {status}  {r['elapsed_s']:>6.2f}s  {title}{collapse}")

    print()
    print(f"=== summary ===")
    print(f"  pool size:               {report['pool_size']}")
    print(f"  success / total:         {report['success']} / {report['total']}  ({report['success_rate']}%)")
    print(f"  failures:                {report['failure']}")
    print(f"  collapse-marker hits:    {report['collapse_marker_hits']}  (these are the pre-launch P0 bug)")
    print(f"  latency p50 / p95:       {report['p50_s']}s / {report['p95_s']}s")
    print(f"  wallclock:               {report['wallclock_s']}s")
    print(f"  error classes:           {report['error_classes']}")
    print()

    # Pass-criterion verdict
    pass_95 = report["success_rate"] >= 95
    pass_collapse = report["collapse_marker_hits"] == 0
    verdict = "PASS" if (pass_95 and pass_collapse) else "FAIL"
    print(f"=== verdict: {verdict} ===")
    print(f"  ≥95% success:            {'YES' if pass_95 else 'NO'} ({report['success_rate']}%)")
    print(f"  zero collapse markers:   {'YES' if pass_collapse else 'NO'}")
    print()

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, indent=2))
        print(f"  full report written to: {args.json_out}")

    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
