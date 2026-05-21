"""Fingerprint test-page benchmark.

Drives the production engine router against public detection sites
(bot.sannysoft.com, creepjs, browserleaks, etc.) and asks an LLM to
read the rendered verdict.

Key design choices:

  1. Routes through `engines.router.snapshot()` with
     `vendor_hint="fingerprint-test"`. That hint maps to camoufox-first
     in VENDOR_AFFINITY because creepjs/fingerprint.com specifically
     punish Chromium-based stacks — Firefox via camoufox scores clean
     where nodriver scores "headless 31%".

  2. LLM-judged verdicts instead of per-site DOM parsers. The OLD
     version had a SITE_PARSERS dict that broke every time a detection
     site shipped a new DOM. The LLM reads the verdict the way a human
     would; works on ANY detection site without per-site code; self-
     adapts when sites change layout.

Tradeoff: each scrape costs one LLM call (~300-800ms, free on Groq).
Negligible for a bench that runs ~10x/day.

Usage:
    python -m bench.fingerprint            # all sites in lists/fingerprint.txt
    python -m bench.fingerprint --site sannysoft

Writes bench/results/fingerprint-<ts>.json with raw text dumps + LLM
verdicts so a reviewer can audit the LLM's call.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from dataclasses import asdict, dataclass

from bench.lib import (
    BenchReport,
    _utc_now_iso,
    git_sha,
    load_url_list,
    write_report,
)
from bench.llm_judge import LLM_MODEL, Verdict, is_configured, judge_page


@dataclass
class SiteResult:
    """One detection-site test row. Stable schema for cross-iter diffing."""
    site_id: str
    url: str
    elapsed_s: float
    raw_title: str = ""
    raw_text_sample: str = ""           # first 800 chars of visible text (debug)
    visible_text_chars: int = 0          # full length for context
    verdict: str = "unknown"
    score: float | None = None
    tests_passed: int | None = None
    tests_total: int | None = None
    evidence: str = ""
    notes: str = ""
    error: str | None = None
    engine_used: str | None = None       # which engine the router picked
    escalation_path: list[str] | None = None


async def _grab_page(url: str) -> tuple[str, str, int, str | None, str | None, list[str]]:
    """Drive one router call. Returns:
        (title, visible_text, char_count, error, engine_used, escalation_path)

    All fingerprint sites get vendor_hint='fingerprint-test', which maps
    to camoufox-first in router.VENDOR_AFFINITY. Bounded to 35s total
    via Requirements.max_latency_s.
    """
    from app.engines import router, Requirements
    from app.engines.base import EngineFailedError

    req = Requirements(
        needs_js=True,
        needs_screenshot=False,         # we only need text for the LLM judge
        needs_dom=True,
        vendor_hint="fingerprint-test",
        max_latency_s=35.0,
    )

    try:
        snap, decision = await router.snapshot(url, requirements=req)
    except EngineFailedError as e:
        return "", "", 0, f"router gave up: {e}", None, []
    except Exception as e:
        return "", "", 0, f"{type(e).__name__}: {e}", None, []

    title = (snap.title or "")[:200]
    # The 'text' field on each element is the per-node innerText. For
    # camoufox + nodriver, elements is a list of real DOM nodes; for
    # curl_cffi (shouldn't be picked here — needs_js=True filters it out)
    # elements[0] is the whole HTML body. Join all element texts to give
    # the LLM the full rendered verdict.
    visible_text = "\n".join(
        (el.get("text") or "") for el in (snap.elements or []) if el.get("text")
    )
    return (
        title,
        visible_text,
        len(visible_text),
        None,
        snap.engine_name,
        list(decision.escalation_path),
    )


async def test_one(url: str, site_id: str) -> SiteResult:
    """Load page via router → judge text with LLM. One scrape, one LLM call."""
    r = SiteResult(site_id=site_id, url=url, elapsed_s=0.0)
    t0 = time.perf_counter()

    title, text, chars, scrape_err, engine_used, esc_path = await _grab_page(url)
    r.raw_title = title
    r.raw_text_sample = text[:800]
    r.visible_text_chars = chars
    r.engine_used = engine_used
    r.escalation_path = esc_path

    if scrape_err:
        r.elapsed_s = round(time.perf_counter() - t0, 2)
        r.error = scrape_err
        r.verdict = "error"
        return r

    verdict: Verdict = await judge_page(url=url, title=title, visible_text=text)
    r.elapsed_s = round(time.perf_counter() - t0, 2)
    r.verdict = verdict.verdict
    r.score = verdict.score
    r.tests_passed = verdict.tests_passed
    r.tests_total = verdict.tests_total
    r.evidence = verdict.evidence
    r.notes = verdict.notes
    if verdict.error:
        r.error = verdict.error
    return r


def _summarize(results: list[SiteResult]) -> dict:
    """Aggregate: count of each verdict + best-effort headline metric.

    Headline metric for win condition #2 fidelity check: fraction of
    sites that returned verdict='pass'. Sites where the LLM couldn't tell
    (unknown / error) don't count for or against — they're noise we'll
    investigate later.

    Also adds `by_engine` so reviewers see which engine delivered the
    pass on each fingerprint site (the whole point of the multi-engine
    refactor)."""
    by_verdict: dict[str, int] = {"pass": 0, "partial": 0, "fail": 0, "unknown": 0, "error": 0}
    by_engine: dict[str, dict[str, int]] = {}
    for r in results:
        by_verdict[r.verdict] = by_verdict.get(r.verdict, 0) + 1
        if r.engine_used:
            e = by_engine.setdefault(r.engine_used, {"total": 0, "pass": 0, "partial": 0, "fail": 0})
            e["total"] += 1
            if r.verdict in e:
                e[r.verdict] += 1

    judged = by_verdict["pass"] + by_verdict["partial"] + by_verdict["fail"]
    pass_rate = round(by_verdict["pass"] / max(judged, 1), 3) if judged else None

    return {
        "total_sites": len(results),
        "by_verdict": by_verdict,
        "by_engine": by_engine,
        "judgeable": judged,
        "pass_rate_of_judgeable": pass_rate,
        # Convenience: pull out the sannysoft + creepjs numbers — the
        # two most concrete fingerprint signals we have.
        "sannysoft": next(
            (
                {
                    "verdict": r.verdict,
                    "passed": r.tests_passed,
                    "total": r.tests_total,
                    "engine": r.engine_used,
                    "evidence": r.evidence,
                }
                for r in results if r.site_id == "sannysoft"
            ),
            None,
        ),
        "creepjs": next(
            (
                {
                    "verdict": r.verdict,
                    "engine": r.engine_used,
                    "evidence": r.evidence,
                }
                for r in results if r.site_id == "creepjs"
            ),
            None,
        ),
    }


async def run(site_filter: str | None) -> int:
    urls = load_url_list("fingerprint")
    if site_filter:
        urls = [(u, v) for u, v in urls if v == site_filter]
    if not urls:
        print("No fingerprint sites matched filter.", file=sys.stderr)
        return 1

    print(f"Running fingerprint benchmark: {len(urls)} sites (via engine router)")
    print(f"  commit: {git_sha()}")
    print(f"  judge:  {'Groq LLM' if is_configured() else 'NONE (LLM_API_KEY unset — verdicts will be unknown)'}")
    print(f"  hint:   vendor_hint='fingerprint-test' → camoufox first")
    print()

    t0 = time.perf_counter()
    results: list[SiteResult] = []
    for url, site_id in urls:
        print(f"  -> {site_id}: {url}")
        r = await test_one(url, site_id)
        # ASCII glyphs — render reliably in CI logs.
        marker = {
            "pass":    "PASS",
            "partial": "PART",
            "fail":    "FAIL",
            "unknown": "UNK ",
            "error":   "ERR ",
        }.get(r.verdict, "????")
        print(
            f"    [{r.elapsed_s:5.1f}s] {marker}  eng={r.engine_used or '-':10}  "
            f"chars={r.visible_text_chars}"
            + (f"  score={r.score}" if r.score is not None else "")
            + (f"  tests={r.tests_passed}/{r.tests_total}" if r.tests_passed is not None else "")
        )
        if r.escalation_path:
            print(f"      escalation: {' -> '.join(r.escalation_path)}")
        if r.evidence:
            print(f"      evidence:   \"{r.evidence[:120]}\"")
        if r.error:
            print(f"      error:      {r.error[:160]}")
        results.append(r)
    duration = round(time.perf_counter() - t0, 2)

    summary = _summarize(results)
    print()
    print(f"Done in {duration}s")
    print("  verdicts: " + ", ".join(f"{v}={n}" for v, n in summary["by_verdict"].items()))
    if summary["pass_rate_of_judgeable"] is not None:
        print(f"  pass rate (of judgeable): {summary['pass_rate_of_judgeable']:.1%}")
    if summary["sannysoft"]:
        s = summary["sannysoft"]
        print(f"  sannysoft: verdict={s['verdict']}  engine={s.get('engine') or '-'}  "
              f"passed={s['passed']}/{s['total']}")
    if summary["creepjs"]:
        c = summary["creepjs"]
        print(f"  creepjs:   verdict={c['verdict']}  engine={c.get('engine') or '-'}")
    if summary["by_engine"]:
        print("  per-engine verdicts:")
        for e, d in sorted(summary["by_engine"].items()):
            print(f"    {e:12} total={d['total']:>2}  pass={d['pass']}  partial={d['partial']}  fail={d['fail']}")

    payload = BenchReport(
        name="fingerprint",
        iso_timestamp=_utc_now_iso(),
        commit_sha=git_sha(),
        backend_endpoint="local-router + Groq judge (bench.llm_judge)",
        duration_s=duration,
        config={
            "site_filter": site_filter,
            "vendor_hint": "fingerprint-test",
            "judge_model": LLM_MODEL,
            "judge_configured": is_configured(),
        },
        summary=summary,
        results=[asdict(r) for r in results],
    )
    out = write_report("fingerprint", payload)
    print(f"\n  Report: {out.relative_to(out.parent.parent.parent)}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--site", help="only run one site_id")
    args = ap.parse_args()
    sys.exit(asyncio.run(run(args.site)))


if __name__ == "__main__":
    main()
