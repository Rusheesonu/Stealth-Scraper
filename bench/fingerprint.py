"""Fingerprint test-page benchmark.

Drives the production stealth stack against public detection sites
(bot.sannysoft.com, creepjs, browserleaks, etc.) and asks an LLM to
read the rendered verdict.

The OLD version of this file had a per-site DOM parser dict
(SITE_PARSERS). That was brittle — detection sites change their DOM
constantly and we'd have to maintain N parsers as N sites evolve. The
intelligent fix: dump visible text to a JSON-mode LLM call. The LLM
reads the verdict the way a human would, works on ANY detection site
without per-site code, and self-adapts when sites change layout.

Tradeoff: each scrape now costs one LLM call (~300-800ms, free on
Groq). For a benchmark that runs ~10x/day this is negligible.

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
from dataclasses import asdict, dataclass, field

from bench.lib import (
    BenchReport,
    git_sha,
    load_url_list,
    write_report,
)
from bench.llm_judge import Verdict, is_configured, judge_page


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


async def _grab_page_text(url: str) -> tuple[str, str, int, str | None]:
    """Open the URL in our stealth pool, wait for it to compute, return
    (title, visible_text, char_count, error). Bounded to 35s total."""
    from app.browser import pool

    tab = None
    try:
        tab = await pool.open_tab(url)
        # Wait for the detection script to run. 5s is the sweet spot —
        # fast pages render in <2s; creepjs needs ~4s to compute trust.
        await asyncio.sleep(5.0)
        title_raw = await tab.evaluate("document.title")
        # nodriver result-shape varies; normalize to scalar string.
        if isinstance(title_raw, (tuple, list)) and title_raw:
            title_raw = title_raw[0]
        title = (title_raw or "")[:200] if isinstance(title_raw, str) else ""

        text_raw = await tab.evaluate(
            "(document.body && document.body.innerText) || ''"
        )
        if isinstance(text_raw, (tuple, list)) and text_raw:
            text_raw = text_raw[0]
        text = text_raw if isinstance(text_raw, str) else ""
        return title, text, len(text), None
    except Exception as e:
        return "", "", 0, f"{type(e).__name__}: {e}"
    finally:
        if tab is not None:
            try:
                await tab.close()
            except Exception:
                pass


async def test_one(url: str, site_id: str) -> SiteResult:
    """Load page → grab text → LLM judges. One scrape, one LLM call."""
    r = SiteResult(site_id=site_id, url=url, elapsed_s=0.0)
    t0 = time.perf_counter()

    title, text, chars, scrape_err = await _grab_page_text(url)
    r.raw_title = title
    r.raw_text_sample = text[:800]
    r.visible_text_chars = chars

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

    Headline metric for win condition #2 fidelity check: the fraction of
    sites that returned verdict='pass'. Sites where the LLM couldn't tell
    (unknown / error) don't count for or against — they're noise we'll
    investigate later."""
    by_verdict: dict[str, int] = {"pass": 0, "partial": 0, "fail": 0, "unknown": 0, "error": 0}
    for r in results:
        by_verdict[r.verdict] = by_verdict.get(r.verdict, 0) + 1

    judged = by_verdict["pass"] + by_verdict["partial"] + by_verdict["fail"]
    pass_rate = round(by_verdict["pass"] / max(judged, 1), 3) if judged else None

    return {
        "total_sites": len(results),
        "by_verdict": by_verdict,
        "judgeable": judged,
        "pass_rate_of_judgeable": pass_rate,
        # Convenience: pull out the sannysoft numbers if present (most
        # concrete signal we have).
        "sannysoft": next(
            (
                {
                    "verdict": r.verdict,
                    "passed": r.tests_passed,
                    "total": r.tests_total,
                    "evidence": r.evidence,
                }
                for r in results if r.site_id == "sannysoft"
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

    print(f"Running fingerprint benchmark: {len(urls)} sites")
    print(f"  commit: {git_sha()}")
    print(f"  judge:  {'Groq LLM' if is_configured() else 'NONE (LLM_API_KEY unset — verdicts will be unknown)'}")
    print()

    t0 = time.perf_counter()
    results: list[SiteResult] = []
    for url, site_id in urls:
        print(f"  → {site_id}: {url}")
        r = await test_one(url, site_id)
        marker = {
            "pass": "✅",
            "partial": "🟡",
            "fail": "❌",
            "unknown": "❔",
            "error": "💥",
        }.get(r.verdict, "❔")
        print(
            f"    [{r.elapsed_s:5.1f}s] {marker} verdict={r.verdict} "
            f"chars={r.visible_text_chars}"
            + (f"  score={r.score}" if r.score is not None else "")
            + (f"  tests={r.tests_passed}/{r.tests_total}"
               if r.tests_passed is not None else "")
        )
        if r.evidence:
            print(f"      evidence: \"{r.evidence[:120]}\"")
        if r.error:
            print(f"      error:    {r.error[:160]}")
        results.append(r)
    duration = round(time.perf_counter() - t0, 2)

    summary = _summarize(results)
    print()
    print(f"Done in {duration}s")
    print(f"  verdicts: " + ", ".join(f"{v}={n}" for v, n in summary["by_verdict"].items()))
    if summary["pass_rate_of_judgeable"] is not None:
        print(f"  pass rate (of judgeable): {summary['pass_rate_of_judgeable']:.1%}")
    if summary["sannysoft"]:
        s = summary["sannysoft"]
        print(f"  sannysoft: verdict={s['verdict']} "
              f"passed={s['passed']}/{s['total']}")

    payload = BenchReport(
        name="fingerprint",
        iso_timestamp=__import__("datetime").datetime.utcnow().isoformat() + "Z",
        commit_sha=git_sha(),
        backend_endpoint="local-nodriver + Groq judge (bench.llm_judge)",
        duration_s=duration,
        config={
            "site_filter": site_filter,
            "wait_after_load_s": 5.0,
            "judge_model": __import__("bench.llm_judge", fromlist=["LLM_MODEL"]).LLM_MODEL,
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
