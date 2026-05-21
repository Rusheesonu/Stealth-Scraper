"""Shared benchmark utilities.

The bench/ runners need three things from this module:
  1. `scrape_one(url, vendor)` — drive ONE scrape through the production
     engine router (not raw take_snapshot) so benchmarks measure the
     full multi-engine pipeline.
  2. `BenchResult` / `BenchReport` dataclasses — the JSON shape we commit
     to bench/results/. Stable so we can diff across iterations.
  3. `write_report(name, payload)` — atomic JSON write with timestamp.

Why through the router (the historic bug this fixes): earlier bench
versions called `app.snapshot.take_snapshot` directly, which means every
benchmark only ever measured nodriver. The router/curl_cffi/camoufox
existed but were never tested by any bench — they were dead code. Now
every bench scrape runs through `engines.router.snapshot()`, which:
  - filters engines by capability,
  - picks the best one for the vendor (vendor_hint → VENDOR_AFFINITY),
  - escalates on EngineFailedError up to MAX_ESCALATIONS engines,
  - records per-host success rates for future runs to learn from.

Each BenchResult now carries `engine_used` + `escalation_path` so the
report shows which engine actually won on which URL.

We deliberately use the SAME stealth/snapshot/detect modules the
production backend uses (via `from app import ...`). Benchmarking a
separate copy would defeat the point. Run from repo root — the path
setup below adds backend/ to sys.path so `from app import ...` resolves.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
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
    """One row of a benchmark run.

    Fields added since the multi-engine refactor:
      engine_used       — which engine the router actually selected
      escalation_path   — chain if the router had to fall through engines
      router_reason     — human-readable reason from EngineDecision
    """
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
    engine_used: Optional[str] = None         # router's pick
    escalation_path: list[str] = field(default_factory=list)
    router_reason: str = ""


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


def _utc_now_iso() -> str:
    """Timezone-aware ISO timestamp. utcnow() is deprecated 3.12+."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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


async def scrape_one(
    url: str,
    *,
    vendor_hint: Optional[str] = None,
    timeout_s: float = 90.0,
    needs_js: bool = True,
    needs_screenshot: bool = True,
) -> BenchResult:
    """Drive one scrape through the engine router + post-snapshot detect.

    The router picks the best engine for (vendor_hint, capabilities) and
    escalates on EngineFailedError. Per-host history accumulates in
    /tmp/stealth-scraper-router-history.json so repeated bench runs learn.

    Catches every exception so a broken proxy or a 500 doesn't kill the
    whole batch run.

    Also gates each call through the safety rate-limiter (1 req/sec/host
    default) so a bench run doesn't accidentally hammer the same domain
    when multiple URLs share a host.
    """
    from app.engines import router, Requirements
    from app.engines.base import EngineFailedError
    from app.detect import detect_block
    from app.safety import limiter

    result = BenchResult(url=url, expected_vendor=vendor_hint)

    # Per-host rate limit — safe default 1 rps/host so bench doesn't DDoS.
    await limiter.acquire(url)

    # Map our URL-list vendor tag to a router vendor_hint when meaningful.
    # "unknown" and "none" (control) leave vendor_hint at None so the
    # router falls back to cost-ordered candidate ranking.
    rt_hint: Optional[str] = vendor_hint if vendor_hint and vendor_hint not in ("unknown", "none") else None

    req = Requirements(
        needs_js=needs_js,
        needs_screenshot=needs_screenshot,
        vendor_hint=rt_hint,
        max_latency_s=timeout_s,
    )

    t0 = time.perf_counter()
    try:
        snap_result, decision = await asyncio.wait_for(
            router.snapshot(url, requirements=req),
            timeout=timeout_s,
        )
    except asyncio.TimeoutError:
        result.elapsed_s = round(time.perf_counter() - t0, 2)
        result.error = f"timeout after {timeout_s}s"
        return result
    except EngineFailedError as e:
        result.elapsed_s = round(time.perf_counter() - t0, 2)
        result.error = f"router gave up: {e}"
        return result
    except Exception as e:
        result.elapsed_s = round(time.perf_counter() - t0, 2)
        result.error = f"{type(e).__name__}: {e}"
        return result

    result.elapsed_s = round(time.perf_counter() - t0, 2)
    result.title = (snap_result.title or "")[:120]
    result.element_count = len(snap_result.elements or [])
    result.engine_used = snap_result.engine_name
    result.escalation_path = list(decision.escalation_path)
    result.router_reason = decision.reason

    # Run detect against element-text haystack (same as production endpoint).
    block = detect_block(
        title=snap_result.title or "",
        html=" ".join(
            (el.get("text") or "")[:200]
            for el in (snap_result.elements or [])[:40]
        ),
        url=snap_result.url,
    )
    result.blocked = block.blocked
    result.detected_vendor = block.vendor if block.blocked else None
    # "success" = block-detector didn't fire AND we got page content.
    #
    # Old threshold was `element_count >= 5` to distinguish a real page
    # from a 1-3-element challenge widget. That false-failed on genuinely
    # minimal pages: example.com (3 elements: h1+p+a), httpbin.org/ip
    # (JSON endpoint with 1 wrapper element). New heuristic:
    #
    #   PASS if  (not blocked) AND (title present) AND elements >= 1
    #   FAIL on the typical anti-bot challenge wall which has:
    #     - empty/generic title ("Please wait", "Just a moment...")
    #     - very few elements (the challenge widget alone)
    #
    # detect_block() already catches the named-vendor walls; this is
    # a backstop for unbranded blocks (e.g. raw 403 HTML pages).
    has_real_content = (
        result.element_count >= 5
        or (result.element_count >= 1 and bool(snap_result.title))
    )
    result.success = (not block.blocked) and has_real_content
    if block.blocked and not result.error:
        result.notes = f"{block.title}: {block.message[:120]}"
    return result


async def scrape_many(
    urls: list[tuple[str, str]],
    *,
    on_done=None,
) -> list[BenchResult]:
    """Run scrape_one across a list, serially.

    Concurrency removed because production BrowserPool serializes via
    asyncio.Lock anyway — running >1 coroutine just queues them on the
    lock without speedup. Throughput benchmarks should run multiple
    PROCESSES for real parallelism (see bench/throughput.py docs).

    Each URL's vendor tag is passed as the router's vendor_hint so the
    right engine wins per vendor.
    """
    results: list[BenchResult] = []
    for url, vendor in urls:
        r = await scrape_one(url, vendor_hint=vendor)
        results.append(r)
        if on_done:
            on_done(r)
    return results
