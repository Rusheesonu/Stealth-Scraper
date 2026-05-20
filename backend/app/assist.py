"""AI-assisted schema generation via any OpenAI-compatible LLM endpoint.

Defaults to Groq + Llama 3.3 70B because:
  * Free tier covers >>> our launch traffic (30 req/min, 14k req/day)
  * Sub-second latency makes the live demo feel magical
  * OpenAI-compatible API means swapping providers later is a one-line change

Configure via env (defaults to Groq if unset):
    LLM_API_KEY   — your provider key (e.g. Groq, OpenAI, OpenRouter)
    LLM_BASE_URL  — defaults to https://api.groq.com/openai/v1
    LLM_MODEL     — defaults to llama-3.3-70b-versatile

Future: users will BYOK via /settings/llm — see Task #41."""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx


# ── Provider config ──────────────────────────────────────────────────────

LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
# gemma2-9b-it: 15k TPM on Groq free tier — most generous in the free pool.
# Quality is fine for "pick CSS selectors from a list." Override via LLM_MODEL
# for harder pages once you're on a paid tier.
LLM_MODEL = os.getenv("LLM_MODEL", "gemma2-9b-it")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "30"))

# Trim defaults chosen so a noisy 1000-element page (Target product pages,
# Amazon search results) lands under ~4k input tokens — safely inside the
# tightest Groq free-tier TPM bucket (6k).
MAX_CATALOG_ELEMENTS = int(os.getenv("LLM_MAX_CATALOG_ELEMENTS", "70"))
MAX_TEXT_LEN = int(os.getenv("LLM_MAX_TEXT_LEN", "50"))


def is_configured() -> bool:
    return bool(LLM_API_KEY)


def provider_label() -> str:
    """Friendly name for /status display."""
    if "groq.com" in LLM_BASE_URL:
        return "Groq"
    if "openai.com" in LLM_BASE_URL:
        return "OpenAI"
    if "anthropic.com" in LLM_BASE_URL:
        return "Anthropic"
    if "openrouter.ai" in LLM_BASE_URL:
        return "OpenRouter"
    if "127.0.0.1" in LLM_BASE_URL or "localhost" in LLM_BASE_URL:
        return "local (Ollama?)"
    return LLM_BASE_URL


# ── Prompt ───────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You build web-scraping schemas. Input: a JSON array of page elements
(each has `t`=tag, `x`=text, `c`=CSS selector) + a user description.

Output ONLY this JSON object — no prose, no fences:

{"template":[{"label":"snake_case","selector":"<copy from c>","kind":"text|attr|list|markdown","attr":"<only if kind=attr>"}]}

Rules:
- Pick selectors directly from `c`. Never invent.
- `list` for repeating items, `text` for singles, `attr` for href/src etc, `markdown` for rich blocks.
- Keep labels short snake_case."""


# ── Generation ───────────────────────────────────────────────────────────

async def generate_template(
    *,
    elements: list[dict[str, Any]],
    description: str,
    url: str,
    title: str = "",
) -> list[dict[str, Any]]:
    """Call the configured LLM, return a parsed template array."""
    if not is_configured():
        raise RuntimeError(
            "AI schema generation is not configured — set LLM_API_KEY "
            "(default provider is Groq — free tier at console.groq.com)"
        )

    trimmed = _trim_catalog(elements, max_elements=MAX_CATALOG_ELEMENTS)

    # Compact JSON (no indent) — saves ~25% tokens. The model parses it fine.
    user_msg = (
        f"URL: {url}\n"
        f"Title: {title or '(no title)'}\n\n"
        f"Elements ({len(trimmed)}/{len(elements)} kept after dedup+filter):\n"
        f"{json.dumps(trimmed, separators=(',', ':'))}\n\n"
        f"Extract: {description}"
    )

    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.1,  # we want determinism, not creativity
        "response_format": {"type": "json_object"},  # forces valid JSON output
        "max_tokens": 2000,
    }

    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        res = await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {LLM_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    # Auto-retry on 413 (request too large) with progressively smaller trims.
    # First request uses the configured defaults; if rejected, halve element
    # count + text length and try again. Most pages succeed on first or second
    # attempt.
    if res.status_code == 413:
        for retry_n, factor in enumerate([0.5, 0.25], start=1):
            half_trim = _trim_catalog(elements, max_elements=max(20, int(MAX_CATALOG_ELEMENTS * factor)))
            for el in half_trim:
                if el.get("x") and len(el["x"]) > int(MAX_TEXT_LEN * factor):
                    el["x"] = el["x"][:int(MAX_TEXT_LEN * factor)]
            retry_msg = (
                f"URL: {url}\nElements ({len(half_trim)} trimmed for size):\n"
                f"{json.dumps(half_trim, separators=(',', ':'))}\nExtract: {description}"
            )
            payload["messages"][1]["content"] = retry_msg
            async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
                res = await client.post(
                    f"{LLM_BASE_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {LLM_API_KEY}", "Content-Type": "application/json"},
                    json=payload,
                )
            if res.status_code != 413:
                break

    if res.status_code >= 400:
        raise RuntimeError(f"LLM API {res.status_code}: {res.text[:300]}")

    body = res.json()
    choices = body.get("choices", [])
    if not choices:
        raise RuntimeError("LLM returned no choices")

    content = choices[0].get("message", {}).get("content", "").strip()
    if not content:
        raise RuntimeError("LLM returned empty content")

    # Strip accidental fences in case response_format isn't honored.
    if content.startswith("```"):
        content = content.split("\n", 1)[1] if "\n" in content else content[3:]
        if content.endswith("```"):
            content = content.rsplit("```", 1)[0]
        content = content.strip()
        if content.startswith("json"):
            content = content[4:].strip()

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"LLM returned invalid JSON: {e} — raw: {content[:300]}") from e

    # Some models honor response_format and return {"template": [...]},
    # others return the array directly. Handle both.
    if isinstance(parsed, dict) and "template" in parsed:
        items = parsed["template"]
    elif isinstance(parsed, list):
        items = parsed
    elif isinstance(parsed, dict):
        # Last-ditch: any list value inside.
        items = next((v for v in parsed.values() if isinstance(v, list)), None)
        if items is None:
            raise RuntimeError(f"LLM returned unexpected shape: {list(parsed.keys())}")
    else:
        raise RuntimeError(f"LLM returned unexpected type: {type(parsed).__name__}")

    if not isinstance(items, list):
        raise RuntimeError(f"Expected a list of fields, got {type(items).__name__}")

    valid: list[dict[str, Any]] = []
    for f in items:
        if not isinstance(f, dict):
            continue
        if not f.get("label") or not f.get("selector"):
            continue
        f.setdefault("kind", "text")
        f.setdefault("xpath", "")
        f.setdefault("attr", "")
        valid.append(f)

    return valid


_NTH_OF_TYPE_RE = re.compile(r":nth-of-type\(\d+\)")
_INTERESTING_TAGS = {
    "a", "button", "input", "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "li", "span", "td", "th", "img", "label", "article",
}


def _trim_catalog(elements: list[dict[str, Any]], *, max_elements: int) -> list[dict[str, Any]]:
    """Aggressively pare down the element catalog so the LLM prompt stays
    under free-tier TPM limits even for huge product pages.

    Three reductions:
      1. Skip elements with no text + non-interactive tag + no href/src
      2. Dedupe by selector SHAPE — `a.foo:nth-of-type(1)` and `a.foo:nth-of-type(7)`
         collapse to the same shape. The LLM only needs one representative
         per repeating pattern to write a list-selector.
      3. Truncate text to MAX_TEXT_LEN, drop attrs entirely (the LLM picks
         CSS selectors, not attribute values).
    """
    out: list[dict[str, Any]] = []
    seen_shapes: set[str] = set()

    for el in elements:
        tag = (el.get("tag") or "").lower()
        text = (el.get("text") or "").strip()
        css = el.get("css") or ""
        attrs = el.get("attrs") or {}

        if not text and tag not in _INTERESTING_TAGS and "href" not in attrs and "src" not in attrs:
            continue

        shape = _NTH_OF_TYPE_RE.sub("", css)
        if shape in seen_shapes:
            continue
        seen_shapes.add(shape)

        out.append({
            "t": tag,                                 # short keys also save tokens
            "x": text[:MAX_TEXT_LEN] if text else "",
            "c": css,
        })
        if len(out) >= max_elements:
            break
    return out
