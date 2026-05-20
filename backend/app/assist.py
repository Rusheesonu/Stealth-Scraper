"""AI-assisted schema generation.

User provides a URL + plain-English description ("get product info", "extract
job listings", etc). We snapshot the page, hand Claude the element catalog
+ the description, and get back a ready-to-use template array.

Killer demo for AI agent buyers: paste URL + sentence → working extractor
in one tool call. No XPath, no DOM inspection.

Rate-limit policy: 10 calls/day for free tier, 100/day for paid. Tracked
in `assist_usage_counts` (separate from scrape usage — assist calls don't
count toward scrape quota).
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx


ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ASSIST_MODEL = os.getenv("ASSIST_MODEL", "claude-sonnet-4-5-20250929")
ASSIST_BASE_URL = "https://api.anthropic.com/v1"


def is_configured() -> bool:
    return bool(ANTHROPIC_API_KEY)


_SYSTEM_PROMPT = """\
You are a web-scraping assistant. The user gives you:
  1. A list of detected elements from a webpage (each with tag, text, CSS selector, XPath, bbox).
  2. A plain-English description of what data they want to extract.

You return a JSON array of "template fields" — one per piece of data the user wants. Each field is:

{
  "label":    "<short snake_case key for the output>",
  "selector": "<the CSS selector for the matching element(s) — copy from the element catalog>",
  "kind":     "text" | "attr" | "list" | "markdown",
  "attr":     "<attribute name, ONLY when kind='attr'>"
}

Rules:
- Pick selectors directly from the catalog's `css` field. Don't invent ones not in the catalog.
- Use `"list"` when there are multiple matching items (e.g. all product cards, all news headlines).
- Use `"text"` for single text values (title, price on a product page).
- Use `"attr"` for hrefs, image sources, etc. Set `attr` to the attribute name.
- Use `"markdown"` when the user wants a rich block (article body, product description) as markdown.
- Use short snake_case labels — they become JSON keys.
- Return ONLY the JSON array. No prose, no markdown fences, no explanation.

If the description is ambiguous, pick the most likely interpretation based on the page content."""


async def generate_template(
    *,
    elements: list[dict[str, Any]],
    description: str,
    url: str,
    title: str = "",
) -> list[dict[str, Any]]:
    """Call Claude with the page's element catalog + the user's description,
    return a parsed template array. Raises on API errors or invalid JSON
    output."""
    if not is_configured():
        raise RuntimeError(
            "AI schema generation is not configured — set ANTHROPIC_API_KEY"
        )

    # Trim the catalog — Claude doesn't need invisibles. Limit to the
    # first ~300 elements with text content to keep the prompt small.
    trimmed = _trim_catalog(elements, max_elements=300)

    user_msg = (
        f"URL: {url}\n"
        f"Title: {title or '(no title)'}\n\n"
        f"Detected elements ({len(trimmed)} of {len(elements)} shown):\n"
        f"```json\n{json.dumps(trimmed, indent=2)}\n```\n\n"
        f"What I want to extract: {description}\n\n"
        f"Return the template JSON array now."
    )

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            f"{ASSIST_BASE_URL}/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": ASSIST_MODEL,
                "max_tokens": 2000,
                "system": _SYSTEM_PROMPT,
                "messages": [{"role": "user", "content": user_msg}],
            },
        )
    if res.status_code >= 400:
        raise RuntimeError(f"Claude API {res.status_code}: {res.text[:300]}")

    body = res.json()
    content = body.get("content", [])
    if not content:
        raise RuntimeError("Claude returned no content")
    text = content[0].get("text", "").strip()
    if not text:
        raise RuntimeError("Claude returned empty text")

    # Strip accidental markdown fences in case the model added them despite
    # instructions.
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()
        if text.startswith("json"):
            text = text[4:].strip()

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Claude returned invalid JSON: {e} — raw: {text[:300]}") from e

    if not isinstance(parsed, list):
        raise RuntimeError(f"Claude returned {type(parsed).__name__}, expected list")

    # Lightly validate each field has the required keys.
    valid: list[dict[str, Any]] = []
    for f in parsed:
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
    """Keep elements with non-empty text + interactive elements (a, button, input),
    drop pure structure tags (div with no direct text). Smaller prompt = lower cost,
    less noise for the model."""
    INTERESTING_TAGS = {"a", "button", "input", "h1", "h2", "h3", "h4", "h5", "h6",
                         "p", "li", "span", "td", "th", "img", "label", "article"}
    interesting: list[dict[str, Any]] = []
    for el in elements:
        tag = (el.get("tag") or "").lower()
        text = (el.get("text") or "").strip()
        attrs = el.get("attrs") or {}
        # Keep if: has text, is an interactive/content tag, or has an href / src.
        if text or tag in INTERESTING_TAGS or "href" in attrs or "src" in attrs:
            interesting.append({
                "tag": tag,
                "text": text[:200] if text else "",
                "css": el.get("css") or "",
                "attrs": {k: v for k, v in attrs.items() if k in ("href", "src", "class", "id", "alt", "title")},
            })
        if len(interesting) >= max_elements:
            break
    return interesting
