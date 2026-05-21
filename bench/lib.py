"""Shared benchmark utilities.

The bench/ runners need three things from this module:
  1. `scrape_one(url)` — actually drive the production stealth stack against a URL
     and return a normalized result (block-detected? what vendor? how long?).
  2. `BenchResult` / `BenchReport` dataclasses — the JSON shape we commit to
     bench/results/. Stable so we can diff across iterations.
  3. `write_report(name, payload)` — atomic JSON write with timestamp.

We deliberately use the SAME stealth/snapshot/detect modules the production
backend uses (via `from app import ...`). Benchmarking a separate copy would
defeat the point. Run this module from within the backend's Python venv so
the import path resolves.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


# ── Path setup ────────────────────────────────────────────────────────────
# Allow `python -m bench.antibot` from repo root by adding backend/ to path
# so `from app import ...` resolves to the production code.
REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

RESULTS_DIR = Path(__file__).resolve().parent / "results"
LISTS_DIR = Path(__file__).resolve().parent / "lists"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


# ── Result schema ─────────────────────────────────────────────────────────


@dataclass
class BenchResult:
    """One row of a benchmark run."""
    url: str
    expected_vendor: Optional[str] = None    # what we EXPECT to be there
    success: bool = False                     # got a usable page (not a wall)
    blocked: bool = False                     # block-detector fired
    detected_vendor: Optional[str] = None     # what we ACTUALLY hit
    page_type: Optional[str] = None           # ecommerce_listing / generic / etc
    element_count: int = 0
    title: str = ""
    elapsed_s: float = 0.0
    error: Optional[str] = None               # exception message if scrape died
    notes: str = ""


@dataclass
class BenchReport:
    """Whole-run payload that lands in bench/results/."""
    name: str                                 # "antibot" | "fingerprint" | "throughput"
    iso_timestamp: str
    commit_sha: str
    backend_endpoint: str                     # where we ran against
    duration_s: float
    config: dict[str, Any]                    # mode, concurrency, proxy on/off, etc.
    summary: dict[str, Any]                   # aggregate stats (overall + per-vendor)
    results: list[dict[str, Any]] = field(default_factory=list)


def write_report(name: str, payload: BenchReport) -> Path:
    """Atomic-ish JSON write with timestamped filename so we never overwrite
    prior runs. Returns the path written."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = RESULTS_DIR / f"{name}-{ts}.json"
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(asdict(payload), indent=2, default=str, sort_keys=False))
    tmp.replace(out)
    return out


def git_sha() -> str:
    """Short HEAD sha for the report. Falls back to 'unknown' if outside a
    git repo or `git` isn't available."""
    import subprocess
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT, stderr=subprocess.DEVNULL,
        )
        return out.decode().strip()
    except Exception:
        return "unknown"


# ── URL list loader ───────────────────────────────────────────────────────


def load_url_list(name: str) -> list[tuple[str, str]]:
    """Read bench/lists/<name>.txt. Each line:
        <url> <vendor>            # comments allowed
        <url>                     # vendor defaults to "unknown"
    Returns list of (url, vendor) tuples. Comment lines (#) and blanks skipped.
    """
    path = LISTS_DIR / f"{name}.txt"
    if not path.exists():
        raise FileNotFoundError(f"URL list not found: {path}")
    out: list[tuple[str, str]] = []
    for line in path.read_text().splitlines():
        stripped = line.split("#", 1)[0].strip()
        if not stripped:
            continue
        parts = stripped.split(maxsplit=1)
        url = parts[0]
        vendor = parts[1].strip() if len(parts) > 1 else "unknown"
        out.append((url, vendor))
    return out


# ── The actual scrape call ────────────────────────────────────────────────
#
# Imports app.snapshot and app.detect from the production backend code so
# benchmarks measure the EXACT stealth stack production uses. Don't change
# this to spawn a separate scraper — defeats the point.


async def scrape_one(url: str, *, timeout_s: float = 45.0) -> BenchResult:
    """Drive one scrape through production stealth + post-snapshot detect.
    Returns a BenchResult with timing + block-detection verdict.

    Catches every exception so a broken proxy or a 500 doesn't kill the
    whole batch run."""
    from app.snapshot import take_snapshot
    from app.detect import detect_block

    result = BenchResult(url=url)
    t0 = time.perf_counter()
    try:
        snap = await asyncio.wait_for(
            take_snapshot(url, viewport_width=1280, viewport_height=900),
            timeout=timeout_s,
        )
    except asyncio.TimeoutError:
        result.elapsed_s = round(time.perf_counter() - t0, 2)
        result.error = f"timeout after {timeout_s}s"
        return result
    except Exception as e:
        result.elapsed_s = round(time.perf_counter() - t0, 2)
        result.error = f"{type(e).__name__}: {e}"
        return result

    result.elapsed_s = round(time.perf_counter() - t0, 2)
    result.title = (snap.title or "")[:120]
    result.element_count = len(snap.elements or [])

    # Run detect against element-text haystack (same as production endpoint).
    block = detect_block(
        title=snap.title or "",
        html=" ".join((el.get("text") or "")[:200] for el in (snap.elements or [])[:40]),
        url=snap.url,
    )
    result.blocked = block.blocked
    result.detected_vendor = block.vendor if block.blocked else None
    # "success" = not blocked AND we got at least some elements
    result.success = (not block.blocked) and result.element_count >= 5
    if block.blocked and not result.error:
        result.notes = f"{block.title}: {block.message[:120]}"
    return result


async def scrape_many(
    urls: list[tuple[str, str]],
    *,
    concurrency: int = 1,
    on_done=None,
) -> list[BenchResult]:
    """Run scrape_one across a list with bounded concurrency. Yields results
    via the optional `on_done(result)` callback for progress logging.

    Concurrency=1 by default — the production BrowserPool serializes via
    asyncio.Lock anyway, so higher values won't help on a single backend.
    Throughput benchmarks should run multiple processes for real parallelism.
    """
    sem = asyncio.Semaphore(concurrency)
    results: list[BenchResult] = []

    async def _one(url: str, vendor: str) -> BenchResult:
        async with sem:
            r = await scrape_one(url)
            r.expected_vendor = vendor
            results.append(r)
            if on_done:
                on_done(r)
            return r

    await asyncio.gather(*[_one(u, v) for u, v in urls])
    return results
