"""Fingerprint test-page benchmark.

Drives the production stealth stack against public detection sites
(bot.sannysoft.com, creepjs, browserleaks, etc.) and extracts the
verdict each site renders.

Usage:
    python -m bench.fingerprint            # all sites in lists/fingerprint.txt
    python -m bench.fingerprint --site sannysoft

Writes bench/results/fingerprint-<ts>.json with raw + parsed verdicts.

Each site has a tiny parser in SITE_PARSERS — sites render results
totally differently (sannysoft = a giant <table>, creepjs = nested DOM,
browserleaks = key/value boxes), so generic NLP would hallucinate.
The parsers extract a small structured verdict (`{tests_total, tests_passed,
fields: {...}}`) so we can diff across runs.

For sites where parsing is too brittle to be worth the maintenance
(creepjs in particular — minified, frequently changing), we save the
raw page title + visible text + a screenshot reference, and let a human
eyeball them when the benchmark output looks off.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
import time
from dataclasses import asdict, dataclass, field

from bench.lib import (
    BenchReport,
    git_sha,
    load_url_list,
    write_report,
)


@dataclass
class FingerprintVerdict:
    """Per-site result. `verdict` is the headline pass/fail/partial label
    rendered by the test site (or computed by our parser); `details` is
    the structured data we extracted for diffing across runs."""
    site_id: str
    url: str
    elapsed_s: float
    error: str | None = None
    verdict: str = "unknown"                       # "pass" | "fail" | "partial" | "unknown"
    tests_passed: int = 0
    tests_total: int = 0
    details: dict = field(default_factory=dict)
    raw_title: str = ""


# ── Per-site parsers ──────────────────────────────────────────────────────


async def _parse_sannysoft(tab) -> dict:
    """bot.sannysoft.com renders a table where each <tr> has a test name in
    column 1 and either "passed" (green) or a fail message in column 2.
    Easy to parse — just count cells with class="result passed" vs "result failed"."""
    js = r"""
    (() => {
        const rows = Array.from(document.querySelectorAll('table tr'));
        const results = {};
        let passed = 0, total = 0;
        for (const tr of rows) {
            const cells = tr.querySelectorAll('td');
            if (cells.length < 2) continue;
            const name = (cells[0].textContent || '').trim();
            const cell = cells[1];
            const txt = (cell.textContent || '').trim().toLowerCase();
            const cls = (cell.className || '').toLowerCase();
            let r = 'unknown';
            if (cls.includes('passed') || txt === 'passed' || txt === 'ok') r = 'pass';
            else if (cls.includes('failed') || txt.includes('failed') || txt === 'present') r = 'fail';
            else if (txt && txt !== 'missing') r = 'fail';
            if (r !== 'unknown') {
                results[name] = r;
                total++;
                if (r === 'pass') passed++;
            }
        }
        return { passed, total, results };
    })()
    """
    out = await tab.evaluate(js)
    # nodriver 0.50.x sometimes returns (value, exception_details), sometimes
    # a bare value, sometimes wraps in a list. Normalize to value-or-None.
    if isinstance(out, (tuple, list)) and out:
        out = out[0]
    if not isinstance(out, dict):
        out = {}
    return out or {"passed": 0, "total": 0, "results": {}}


async def _parse_browserleaks(tab) -> dict:
    """browserleaks.com pages render key/value pairs in <dl> / <table>.
    We do best-effort: grab visible text of common verdict containers."""
    js = r"""
    (() => {
        const out = {};
        // Common pattern: <div class="result"> or <td class="value">
        document.querySelectorAll('table tr').forEach(tr => {
            const cells = tr.querySelectorAll('th, td');
            if (cells.length === 2) {
                const k = (cells[0].textContent || '').trim();
                const v = (cells[1].textContent || '').trim();
                if (k && v && k.length < 60 && v.length < 240) {
                    out[k] = v;
                }
            }
        });
        return { fields: out, fields_count: Object.keys(out).length };
    })()
    """
    out = await tab.evaluate(js)
    # nodriver 0.50.x sometimes returns (value, exception_details), sometimes
    # a bare value, sometimes wraps in a list. Normalize to value-or-None.
    if isinstance(out, (tuple, list)) and out:
        out = out[0]
    if not isinstance(out, dict):
        out = {}
    return out or {"fields": {}, "fields_count": 0}


async def _parse_creepjs(tab) -> dict:
    """creepjs is minified + frequently changing. Just grab the trust-score
    if it's exposed, else fall back to a coarse 'is the page calling us a bot'
    heuristic on the visible text."""
    js = r"""
    (() => {
        const txt = (document.body.innerText || '').toLowerCase();
        // creepjs renders a percentage trust score like "Trust: 78%"
        const m = txt.match(/trust[^\d]{0,12}(\d{1,3})\s*%/i);
        const trust = m ? parseInt(m[1], 10) : null;
        const flags = {
            saysBot: /\bbot\b/i.test(txt) && !/not a bot/i.test(txt),
            saysHeadless: /headless/i.test(txt),
            highEntropy: /high entropy/i.test(txt) || /unique/i.test(txt),
        };
        return { trust_score: trust, flags };
    })()
    """
    out = await tab.evaluate(js)
    # nodriver 0.50.x sometimes returns (value, exception_details), sometimes
    # a bare value, sometimes wraps in a list. Normalize to value-or-None.
    if isinstance(out, (tuple, list)) and out:
        out = out[0]
    if not isinstance(out, dict):
        out = {}
    return out or {"trust_score": None, "flags": {}}


async def _parse_amiunique(tab) -> dict:
    """amiunique.org reports browser uniqueness percentage."""
    js = r"""
    (() => {
        const txt = document.body.innerText || '';
        const m = txt.match(/Your fingerprint is(?: \w+ to be)?\s+(unique|seen [\d,]+ time)/i);
        const u = txt.match(/(\d[\d.]*)%\s+of\s+observed/i);
        return {
            verdict_text: m ? m[0].slice(0, 200) : null,
            similar_pct: u ? parseFloat(u[1]) : null,
        };
    })()
    """
    out = await tab.evaluate(js)
    # nodriver 0.50.x sometimes returns (value, exception_details), sometimes
    # a bare value, sometimes wraps in a list. Normalize to value-or-None.
    if isinstance(out, (tuple, list)) and out:
        out = out[0]
    if not isinstance(out, dict):
        out = {}
    return out or {}


async def _parse_generic(tab) -> dict:
    """Fallback: just grab page title + first 500 chars of visible text."""
    js = r"""
    (() => ({
        title: document.title,
        bodyText: (document.body && document.body.innerText || '').slice(0, 500),
    }))()
    """
    out = await tab.evaluate(js)
    # nodriver 0.50.x sometimes returns (value, exception_details), sometimes
    # a bare value, sometimes wraps in a list. Normalize to value-or-None.
    if isinstance(out, (tuple, list)) and out:
        out = out[0]
    if not isinstance(out, dict):
        out = {}
    return out or {}


SITE_PARSERS = {
    "sannysoft": _parse_sannysoft,
    "creepjs": _parse_creepjs,
    "amiunique": _parse_amiunique,
    "browserleaks-js": _parse_browserleaks,
    "browserleaks-canvas": _parse_browserleaks,
    "browserleaks-webgl": _parse_browserleaks,
    "browserleaks-tls": _parse_browserleaks,
    "browserleaks-webrtc": _parse_browserleaks,
    "fingerprint-bot": _parse_generic,
}


# ── Runner ────────────────────────────────────────────────────────────────


async def test_one(url: str, site_id: str) -> FingerprintVerdict:
    """Open the test page, give it 4s to compute, extract verdict."""
    from app.browser import pool

    v = FingerprintVerdict(site_id=site_id, url=url, elapsed_s=0.0)
    t0 = time.perf_counter()
    tab = None
    try:
        tab = await pool.open_tab(url)
        # Wait for the page's JS to do its detection — most test pages
        # are heavy on async probes. 4s is the sweet spot per maintainers.
        await asyncio.sleep(4.0)
        v.raw_title = (await tab.evaluate("document.title") or "")[:200]
        parser = SITE_PARSERS.get(site_id, _parse_generic)
        data = await parser(tab)
        v.details = data
        # Compute simple verdict from parsed data
        if site_id == "sannysoft":
            v.tests_passed = data.get("passed", 0)
            v.tests_total = data.get("total", 0)
            v.verdict = (
                "pass" if v.tests_total and v.tests_passed >= v.tests_total - 1
                else "partial" if v.tests_passed >= max(1, v.tests_total // 2)
                else "fail"
            )
        elif site_id == "creepjs":
            score = data.get("trust_score")
            if score is not None:
                v.verdict = "pass" if score >= 80 else "partial" if score >= 60 else "fail"
        else:
            # browserleaks / amiunique — verdict is "we got the page" pass
            v.verdict = "pass" if data else "fail"
    except Exception as e:
        v.error = f"{type(e).__name__}: {e}"
        v.verdict = "error"
    finally:
        if tab is not None:
            try:
                await tab.close()
            except Exception:
                pass
        v.elapsed_s = round(time.perf_counter() - t0, 2)
    return v


async def run(site_filter: str | None) -> int:
    urls = load_url_list("fingerprint")
    if site_filter:
        urls = [(u, v) for u, v in urls if v == site_filter]
    if not urls:
        print("No fingerprint sites matched filter.", file=sys.stderr)
        return 1

    print(f"Running fingerprint benchmark: {len(urls)} sites")
    print(f"  commit:   {git_sha()}")
    print()

    t0 = time.perf_counter()
    verdicts: list[FingerprintVerdict] = []
    for url, site_id in urls:
        print(f"  → {site_id}: {url}")
        v = await test_one(url, site_id)
        print(f"    [{v.elapsed_s:5.1f}s] verdict={v.verdict}  passed={v.tests_passed}/{v.tests_total or '-'}")
        if v.error:
            print(f"    error: {v.error}")
        verdicts.append(v)
    duration = round(time.perf_counter() - t0, 2)

    summary = {
        "pass": sum(1 for v in verdicts if v.verdict == "pass"),
        "partial": sum(1 for v in verdicts if v.verdict == "partial"),
        "fail": sum(1 for v in verdicts if v.verdict == "fail"),
        "error": sum(1 for v in verdicts if v.verdict == "error"),
        "total": len(verdicts),
        # Sannysoft-specific (most concrete signal we have)
        "sannysoft_passed": next(
            (v.tests_passed for v in verdicts if v.site_id == "sannysoft"),
            None,
        ),
        "sannysoft_total": next(
            (v.tests_total for v in verdicts if v.site_id == "sannysoft"),
            None,
        ),
    }

    print()
    print(f"Done in {duration}s")
    print(f"  pass: {summary['pass']}/{summary['total']}  "
          f"partial: {summary['partial']}  fail: {summary['fail']}  "
          f"error: {summary['error']}")
    if summary["sannysoft_total"]:
        print(f"  sannysoft: {summary['sannysoft_passed']}/{summary['sannysoft_total']} subtests passed")

    payload = BenchReport(
        name="fingerprint",
        iso_timestamp=__import__("datetime").datetime.utcnow().isoformat() + "Z",
        commit_sha=git_sha(),
        backend_endpoint="local-nodriver-via-app.browser.pool",
        duration_s=duration,
        config={"site_filter": site_filter, "wait_after_load_s": 4.0},
        summary=summary,
        results=[asdict(v) for v in verdicts],
    )
    out = write_report("fingerprint", payload)
    print(f"  Report: {out.relative_to(out.parent.parent.parent)}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--site", help="only run one site_id")
    args = ap.parse_args()
    sys.exit(asyncio.run(run(args.site)))


if __name__ == "__main__":
    main()
