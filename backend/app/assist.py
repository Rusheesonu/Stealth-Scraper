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
from typing import Any

import httpx


# ── Provider config ──────────────────────────────────────────────────────

LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "30"))


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
You are a web-scraping assistant. The user gives you:
  1. A list of detected elements from a webpage (each with tag, text, CSS selector).
  2. A plain-English description of what data they want.

Return a JSON object with a single "template" key containing an array of field objects:

{
  "template": [
    {
      "label":    "snake_case_key",
      "selector": "<copy CSS selector from the catalog>",
      "kind":     "text" | "attr" | "list" | "markdown",
      "attr":     "<attribute name, ONLY when kind='attr'>"
    }
  ]
}

Rules:
- Pick selectors directly from the catalog's `css` field. Never invent selectors.
- Use "list" when there are multiple matching items (all product cards, all news headlines).
- Use "text" for single text values (single title, single price on a product page).
- Use "attr" for hrefs, image sources, etc. Set `attr` to the attribute name (e.g. "href").
- Use "markdown" only when the user asks for a rich block (article body, product description).
- Labels are short snake_case keys.
- Return ONLY the JSON object. No prose, no markdown fences, no explanation."""


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

    trimmed = _trim_catalog(elements, max_elements=300)

    user_msg = (
        f"URL: {url}\n"
        f"Title: {title or '(no title)'}\n\n"
        f"Detected elements ({len(trimmed)} of {len(elements)} shown):\n"
        f"```json\n{json.dumps(trimmed, indent=2)}\n```\n\n"
        f"What I want to extract: {description}\n\n"
        f"Return the JSON object now."
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


def _trim_catalog(elements: list[dict[str, Any]], *, max_elements: int) -> list[dict[str, Any]]:
    """Keep elements likely to be extraction targets — interactive tags or
    elements with visible text. Drop pure layout divs. Smaller prompt =
    lower latency + less noise for the model."""
    INTERESTING_TAGS = {"a", "button", "input", "h1", "h2", "h3", "h4", "h5", "h6",
                         "p", "li", "span", "td", "th", "img", "label", "article"}
    out: list[dict[str, Any]] = []
    for el in elements:
        tag = (el.get("tag") or "").lower()
        text = (el.get("text") or "").strip()
        attrs = el.get("attrs") or {}
        if text or tag in INTERESTING_TAGS or "href" in attrs or "src" in attrs:
            out.append({
                "tag": tag,
                "text": text[:200] if text else "",
                "css": el.get("css") or "",
                "attrs": {k: v for k, v in attrs.items() if k in ("href", "src", "class", "id", "alt", "title")},
            })
        if len(out) >= max_elements:
            break
    return out
