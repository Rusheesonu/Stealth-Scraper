"""Generic LLM-based interpreter for bot-detection test pages.

Why this module exists: hardcoding a parser per detection site
(sannysoft, creepjs, browserleaks, ...) is brittle. The pages change
their DOM structure constantly — a parser that worked last month is
the test failure this month.

The intelligent alternative: dump the rendered visible text + page
title to an LLM with a structured-output prompt. The LLM reads the
verdict the same way a human would. One judge, every detection site,
zero per-site code.

Reuses LLM_API_KEY / LLM_BASE_URL / model chain from app.assist so
we share the same Groq budget as the schema-generation flow. If no
key is configured, returns verdict='unknown' (no fabrication).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from typing import Optional

import httpx


# Match assist.py's config — same env vars so deploys don't need
# duplicate secrets.
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "30"))


@dataclass
class Verdict:
    """Normalized verdict shape — what every detection site's result
    boils down to after the LLM reads it.

    verdict: 'pass' | 'partial' | 'fail' | 'unknown' | 'error'
      pass    = the page treats this as a real browser
      partial = some sub-checks failed but the verdict isn't clearly bot
      fail    = the page flagged this as bot / headless / automated
      unknown = page loaded but the LLM couldn't tell (or no LLM key set)
      error   = exception during evaluation (network, JSON parse, etc.)
    """
    verdict: str
    score: Optional[float] = None             # 0-100 if site shows one
    tests_passed: Optional[int] = None
    tests_total: Optional[int] = None
    evidence: str = ""                         # short quote justifying verdict
    notes: str = ""
    raw_text_chars: int = 0                    # how much page text the LLM saw
    error: Optional[str] = None


SYSTEM_PROMPT = """\
You are a benchmark judge. The user will hand you the visible text from
a browser-fingerprinting or bot-detection test page that ran inside an
automated browser. Your job: decide whether the test page flagged the
browser as automated / a bot / headless, or treated it as a real
human-driven browser.

Return ONLY this JSON object (no prose, no markdown fences):

{
  "verdict": "pass" | "partial" | "fail" | "unknown",
  "score": <number 0-100 if the page shows a trust/uniqueness score, else null>,
  "tests_passed": <integer if the page shows X/Y subtests passed, else null>,
  "tests_total":  <integer total subtests if shown, else null>,
  "evidence": "<short verbatim quote from the page text, max 200 chars>",
  "notes": "<any other observation that matters, max 200 chars>"
}

Decision rules — read carefully, this is the whole point:

- verdict = "pass" when the page either (a) explicitly says the browser
  passed / was not detected as a bot, (b) lists subtest results that are
  predominantly "passed"/"OK"/"present"/"detected" (where "detected"
  means "we detected the feature is present, which is good"), or
  (c) shows a high trust/anonymity score (>=80%).
- verdict = "fail" when the page calls the browser a bot / headless /
  automated / "not human", OR has predominantly failing subtests, OR
  shows a low trust score (<60%).
- verdict = "partial" when results are mixed (some pass, some fail) or
  the trust score is middling (60-79%). When in doubt between pass
  and partial, pick "partial".
- verdict = "unknown" if the page never finished rendering its verdict
  or the text doesn't contain enough information to judge.

Examples of EVIDENCE quotes (so you have a calibration):
  - "WebDriver: passed"  → contributes to pass
  - "WebDriver(New): failed" → contributes to fail
  - "Your fingerprint is unique among 1,234,567 observed" → fail (unique = trackable)
  - "Trust Score: 87%" → contributes to pass (score: 87)
  - "Bot Detection: Possible Bot" → fail
  - "Chrome (Headless)" → fail (headless leaked)

DO NOT include any text outside the JSON. DO NOT use markdown fences."""


def is_configured() -> bool:
    return bool(LLM_API_KEY)


async def judge_page(
    *,
    url: str,
    title: str,
    visible_text: str,
    max_chars: int = 4500,
) -> Verdict:
    """Send the rendered page text to the LLM and parse the verdict.

    Truncates the text to `max_chars` because detection pages can be
    huge (creepjs ships ~50KB of debug output) — past 4-5K we're paying
    tokens for noise that doesn't affect the verdict.

    Never raises — all errors become verdict='error' with the exception
    message in `error`. The whole point of the benchmark is to NEVER
    silently break."""
    if not is_configured():
        return Verdict(
            verdict="unknown",
            evidence="",
            notes="LLM_API_KEY not set — verdict cannot be computed",
            raw_text_chars=len(visible_text),
        )

    text = (visible_text or "").strip()
    if not text:
        return Verdict(
            verdict="unknown",
            evidence="",
            notes="page returned no visible text (probably blocked at network layer)",
            raw_text_chars=0,
        )

    truncated = text[:max_chars]
    user_msg = (
        f"URL: {url}\n"
        f"Title: {title or '(no title)'}\n\n"
        f"VISIBLE TEXT (first {len(truncated)} of {len(text)} chars):\n"
        f"{truncated}"
    )

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "max_tokens": 600,
    }

    # Retry with exponential backoff on 429 (Groq free-tier rate limit).
    # Groq's 429 response usually means "wait ~30s for the per-minute
    # bucket to refill" — the Retry-After header is honored if present,
    # otherwise we fall back to 30s, 60s, 90s.
    import asyncio
    res = None
    for attempt in range(4):  # 1 initial + 3 retries
        try:
            async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
                res = await client.post(
                    f"{LLM_BASE_URL}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {LLM_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
        except Exception as e:
            return Verdict(verdict="error", error=f"{type(e).__name__}: {e}",
                           raw_text_chars=len(text))

        if res.status_code != 429:
            break
        # 429 — back off and retry. Honor Retry-After if Groq sent one.
        retry_after = res.headers.get("retry-after")
        try:
            wait_s = float(retry_after) if retry_after else 30.0 * (attempt + 1)
        except ValueError:
            wait_s = 30.0 * (attempt + 1)
        wait_s = min(wait_s, 90.0)  # cap so a bench doesn't hang for hours
        await asyncio.sleep(wait_s)

    if res is None or res.status_code >= 400:
        return Verdict(
            verdict="error",
            error=f"LLM HTTP {res.status_code if res else 'no-response'}: "
                  f"{(res.text[:200] if res else '')}",
            raw_text_chars=len(text),
        )

    try:
        body = res.json()
        content = body["choices"][0]["message"]["content"].strip()
        # Strip accidental fences in case the model ignores response_format.
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content.rsplit("```", 1)[0]
            content = content.strip()
            if content.lower().startswith("json"):
                content = content[4:].strip()
        parsed = json.loads(content)
    except Exception as e:
        return Verdict(
            verdict="error",
            error=f"could not parse LLM response: {type(e).__name__}: {e}",
            raw_text_chars=len(text),
        )

    verdict = (parsed.get("verdict") or "unknown").lower()
    if verdict not in ("pass", "partial", "fail", "unknown"):
        verdict = "unknown"

    return Verdict(
        verdict=verdict,
        score=_safe_num(parsed.get("score")),
        tests_passed=_safe_int(parsed.get("tests_passed")),
        tests_total=_safe_int(parsed.get("tests_total")),
        evidence=(parsed.get("evidence") or "").strip()[:240],
        notes=(parsed.get("notes") or "").strip()[:240],
        raw_text_chars=len(text),
    )


def _safe_num(v):
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _safe_int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
