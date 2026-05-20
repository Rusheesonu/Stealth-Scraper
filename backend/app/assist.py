"""AI-assisted schema generation via any OpenAI-compatible LLM endpoint.

Defaults to Groq because:
  * Free tier covers >>> our launch traffic (30 req/min, 14k req/day)
  * Sub-second latency makes the live demo feel magical
  * OpenAI-compatible API means swapping providers later is a one-line change

Configure via env (defaults to Groq if unset):
    LLM_API_KEY   — your provider key (e.g. Groq, OpenAI, OpenRouter)
    LLM_BASE_URL  — defaults to https://api.groq.com/openai/v1
    LLM_MODELS    — csv chain, e.g. "llama-3.3-70b-versatile,llama-3.1-8b-instant"
                    Tried in order on model-level failures (deprecation, 404).
    LLM_MODEL     — singular override; promoted to head of the chain.
                    Use this when you want one specific model with the
                    defaults as safety net.

Why a chain?
  Free-tier providers decommission models faster than you can ship. The chain
  + in-process dead-model cache means a single deprecation announcement no
  longer breaks production — the next request transparently uses the fallback.

Future: users will BYOK via /settings/llm — see Task #41."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx


log = logging.getLogger(__name__)


# ── Provider config ──────────────────────────────────────────────────────

LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1").rstrip("/")
LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT", "30"))

# Default model chain for Groq (the default provider). Order matters:
# we try [0] first, fall through on model-level errors. Keep this list
# narrow but resilient — two currently-supported flagship models. When
# Groq deprecates one, the other keeps prod alive while we update.
#
# Updated 2026 after gemma2-9b-it deprecation:
DEFAULT_MODEL_CHAIN = [
    "llama-3.3-70b-versatile",  # Groq flagship, 30k TPM free, broadly capable
    "llama-3.1-8b-instant",     # smaller fallback, same provider, separate quota
]


def _resolve_model_chain() -> list[str]:
    """Resolve env config into an ordered model chain. Resolution order:

      1. LLM_MODELS (csv) — explicit user-defined chain, wins outright.
      2. LLM_MODEL (singular) — single model wanted first, but defaults
         remain as fallbacks (so a typo or deprecation doesn't break prod).
      3. DEFAULT_MODEL_CHAIN — both defaults, in order.
    """
    csv = os.getenv("LLM_MODELS", "").strip()
    if csv:
        return [m.strip() for m in csv.split(",") if m.strip()]
    single = os.getenv("LLM_MODEL", "").strip()
    if single:
        # Promote the user's pick to head, keep defaults as safety net.
        return [single] + [m for m in DEFAULT_MODEL_CHAIN if m != single]
    return list(DEFAULT_MODEL_CHAIN)


# In-process cache: once a model returns "decommissioned" or "not found",
# don't keep retrying it on every subsequent request. Cleared on restart
# (HF Spaces redeploys roughly daily anyway).
_DEAD_MODELS: set[str] = set()


# Trim defaults. Previously 70 elements, tuned for gemma2-9b's tight TPM.
# Now on llama-3.3-70b (30k TPM) we can send ~3× more context — the more
# elements the LLM sees, the less it has to *guess*. Hallucination was the
# top failure mode on the previous low-context setup (LLM filled gaps with
# Target-style selectors on Amazon pages, because that's what its training
# data primes it to produce for "ecommerce product page" requests).
MAX_CATALOG_ELEMENTS = int(os.getenv("LLM_MAX_CATALOG_ELEMENTS", "200"))
MAX_TEXT_LEN = int(os.getenv("LLM_MAX_TEXT_LEN", "80"))


# Friendly exception for clear error UX. Carries an HTTP-style status hint
# so main.py can map to the right response code.
class LLMError(RuntimeError):
    def __init__(self, message: str, *, status: int = 502, kind: str = "error"):
        super().__init__(message)
        self.status = status
        self.kind = kind  # one of: not_configured | auth | rate_limit | all_models_dead | bad_response | timeout | error


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


def active_models() -> dict[str, Any]:
    """For /status — what's the current chain and which models are dead?"""
    chain = _resolve_model_chain()
    return {
        "chain": chain,
        "dead": sorted(_DEAD_MODELS),
        "primary": chain[0] if chain else None,
    }


# ── Page-type heuristic (for landing magic-snapshot) ─────────────────────
#
# When a user pastes a URL on the landing page (no description given), we
# need to seed the LLM with a sensible "what would someone want to extract
# from this page?" context. Generic prompts produce generic schemas.
# Page-type-specific prompts produce *concrete* schemas the visitor
# instantly recognizes ("oh wow, it picked title + price + rating, exactly
# what I wanted").
#
# The detection is intentionally simple — no ML, no scoring tournament.
# Just count signals and pick the dominant pattern. Five buckets cover
# 90%+ of pasted URLs:
#
#   ecommerce_product  — single product page (Amazon/Target/Shopify PDPs)
#   ecommerce_listing  — search / category / grid of products
#   article            — news, blog post, long-form content
#   social_feed        — HN, Reddit, Twitter, forum threads (lists of items)
#   generic            — fallback (landing pages, docs, marketing sites)


def _detect_page_type(elements: list[dict[str, Any]], title: str = "") -> str:
    """Best-effort page-type classifier from a snapshot's element catalog.

    Looks at element density + tag patterns + text signals. Cheap (~1ms);
    runs before the LLM call so we can pick the right system prompt.
    """
    if not elements:
        return "generic"

    # ── Tag/text frequency signals
    h1_count = 0
    h2_count = 0
    img_count = 0
    a_count = 0
    price_signal = 0     # text containing currency markers
    review_signal = 0    # "stars" / "rating" / "review" patterns
    listing_signal = 0   # repeating product-card-ish patterns
    article_signal = 0   # long paragraphs (news/blog tell)
    feed_signal = 0      # comment counts, points, upvotes (HN/Reddit tell)

    for el in elements:
        tag = (el.get("tag") or "").lower()
        text = (el.get("text") or "").strip()
        attrs = el.get("attrs") or {}

        if tag == "h1": h1_count += 1
        if tag == "h2": h2_count += 1
        if tag == "img": img_count += 1
        if tag == "a": a_count += 1

        # Currency markers anywhere in text → pricing context
        if re.search(r"[\$€£₹¥]\s*\d", text) or re.search(r"\d+\s*USD\b", text):
            price_signal += 1

        # Rating / review hints
        lo = text.lower()
        if any(p in lo for p in ("out of 5", "stars", "rating", " review")):
            review_signal += 1

        # Article tells — long paragraph blocks
        if tag == "p" and len(text) > 240:
            article_signal += 1

        # Feed tells — HN-style "points by user", "comments", Reddit-style
        if re.search(r"\b\d+\s*(points?|upvotes?|comments?|replies)\b", lo):
            feed_signal += 1

        # Listing tells — repeating cards usually have alt text or aria-label
        if (attrs.get("alt") or attrs.get("aria_label")) and tag in ("a", "img"):
            listing_signal += 1

    title_lo = (title or "").lower()

    # ── Decision tree, ordered by specificity (strongest signal wins)
    if feed_signal >= 3:
        return "social_feed"
    if price_signal >= 8 and listing_signal >= 6:
        # Lots of prices AND many cards → category/search/listing page
        return "ecommerce_listing"
    if price_signal >= 1 and review_signal >= 1 and h1_count >= 1:
        # Single product page — has h1, at least one price, at least one rating
        return "ecommerce_product"
    if article_signal >= 3 and h1_count >= 1:
        return "article"
    if "blog" in title_lo or "news" in title_lo or article_signal >= 2:
        return "article"
    return "generic"


# Per-type description seeds — what to ask the LLM to extract when the user
# didn't write a description themselves (landing-page magic preview).
# Each is a single line that mimics what an experienced user would type.
PAGE_TYPE_SEED_DESCRIPTIONS = {
    "ecommerce_product": (
        "Extract the product's title, price (current + original if discounted), "
        "discount percentage, rating, review count, primary image, and "
        "availability. Return as scalar fields — this is a single product page."
    ),
    "ecommerce_listing": (
        "Extract every product card on this page as a list — for each, "
        "get the title, price, image URL, link, and rating if visible. "
        "Return list fields so each row corresponds to one product."
    ),
    "article": (
        "Extract the headline, author, publish date, and main body content "
        "(markdown for the body). Also any tags/categories if visible."
    ),
    "social_feed": (
        "Extract every story/post/comment as a list — for each item get "
        "the title or content, author, score (points/upvotes), and comment "
        "count if visible. Return list fields."
    ),
    "generic": (
        "Identify the 5 most useful structured fields a visitor would want "
        "to extract from this page — title, key metadata, and any prominent "
        "values. Prefer list fields when you see repeating patterns."
    ),
}


# ── Heuristic fallback — works without an LLM ────────────────────────────
#
# The whole landing-page magic moment depends on auto-picking fields. If
# the LLM is missing (local dev w/o key), rate-limited (Groq hits TPM
# during a viral spike), or just slow, we MUST still show the visitor
# something concrete. Otherwise the homepage demo looks broken.
#
# This function finds the strongest repeating patterns in the element
# catalog using simple signals — no LLM. The fields it returns are good
# enough for the "wow, it auto-detected!" moment on >90% of common pages.
# The LLM still gets first crack; this is only the fallback.


def _heuristic_suggest_fields(
    elements: list[dict[str, Any]],
    *,
    max_fields: int = 5,
) -> list[dict[str, Any]]:
    """Find the most likely useful fields without calling an LLM.

    Strategy:
      1. Group selectors by their SHAPE (strip nth-of-type). Each shape
         that has ≥3 matching elements is a repeating pattern — candidate
         list field.
      2. For each repeating shape, score it by total text density across
         its matches (more text = more useful for extraction).
      3. Also surface scalar candidates: the page h1, any element with
         currency markers, the first <a> with non-trivial text.
      4. Return the top max_fields with reasonable labels.

    Never returns invented selectors — every output came directly from
    the catalog. Same anti-hallucination guarantee as the LLM path.
    """
    if not elements:
        return []

    # Group by selector shape
    by_shape: dict[str, list[dict[str, Any]]] = {}
    for el in elements:
        css = el.get("css") or ""
        if not css:
            continue
        shape = _NTH_OF_TYPE_RE.sub("", css)
        by_shape.setdefault(shape, []).append(el)

    # Score repeating patterns: count × average text length
    repeating: list[tuple[str, list[dict[str, Any]], float]] = []
    for shape, items in by_shape.items():
        if len(items) < 3:
            continue
        avg_text_len = sum(len((el.get("text") or "")) for el in items) / len(items)
        if avg_text_len < 2:
            continue  # all-empty repeating pattern → not useful (probably nav)
        # Slight bonus for shapes that look like content (h2, h3, span inside a list item)
        score = len(items) * avg_text_len
        repeating.append((shape, items, score))

    # Sort by score, take top patterns first
    repeating.sort(key=lambda x: -x[2])

    out: list[dict[str, Any]] = []
    used_shapes: set[str] = set()

    for shape, items, _score in repeating:
        if len(out) >= max_fields:
            break
        if shape in used_shapes:
            continue
        used_shapes.add(shape)
        label = _label_from_sample(items[0])
        # Dedupe labels (prepend a numeric if needed)
        label = _unique_label(label, [f["label"] for f in out])
        out.append({
            "label": label,
            "selector": shape,
            "kind": "list",
            "attr": "",
        })

    # If we didn't find any repeating patterns (single-product page, doc page),
    # fall back to scalar fields: h1, price patterns, primary image.
    if len(out) < max_fields:
        scalars = _scalar_candidates(elements, exclude_labels={f["label"] for f in out})
        for s in scalars:
            if len(out) >= max_fields:
                break
            out.append(s)

    return out


def _label_from_sample(el: dict[str, Any]) -> str:
    """Best-effort label from a sample element. Looks at CSS selector
    class names (most reliable — devs name their classes after content),
    then tag, then text content, then attributes.

    Order matters: selector class hints win because they reveal the
    site author's intent. .product-price beats checking if text starts
    with $."""
    tag = (el.get("tag") or "").lower()
    text = (el.get("text") or "").strip()
    text_lo = text.lower()
    css = (el.get("css") or "").lower()
    attrs = el.get("attrs") or {}

    # ── Selector class-name hints (strongest signal — devs name classes
    # after their semantic content). Check most specific first.
    if "price" in css:                                       return "price"
    if "title" in css or "headline" in css:                  return "title"
    if "author" in css or "byline" in css:                   return "author"
    if "rating" in css or "stars" in css or "score" in css:  return "rating"
    if "review" in css or "comment" in css:                  return "reviews"
    if "tag" in css and tag not in ("a", "img"):             return "tag"
    if "quote" in css and tag in ("span", "div", "p"):       return "quote"
    if "name" in css:                                        return "name"
    if "description" in css or "desc" in css or "body" in css: return "description"
    if "category" in css:                                    return "category"
    if "date" in css or "time" in css:                       return "date"
    if "image" in css or "thumb" in css or "photo" in css:   return "image"

    # ── Tag-based defaults (after class hints because classes are more
    # specific than tags)
    if tag in ("h1", "h2", "h3"):
        return "title" if tag == "h1" else "heading"
    if tag == "img":
        return "image"
    if tag == "small":  # HTML5 spec: small = attribution/byline
        return "author"
    if tag == "a":
        return "link"
    if tag == "button":
        return "button"
    if tag == "time":
        return "date"

    # ── Text-content patterns
    if re.search(r"[\$€£₹¥]\s*\d", text):
        return "price"
    if any(w in text_lo for w in ("rating", "stars", "out of 5")):
        return "rating"
    if any(w in text_lo for w in ("review", "comment")):
        return "review_count"
    if re.search(r"\b\d+\s*(point|upvote)", text_lo):
        return "points"
    # Quote-like text (starts + ends with quote marks)
    if (text.startswith(("“", '"', "'", "«"))
            and text.endswith(("”", '"', "'", "»"))
            and len(text) > 20):
        return "quote"

    # ── Attribute hints
    if attrs.get("href"):
        return "link"
    if attrs.get("src"):
        return "image"

    return "field"


def _unique_label(base: str, taken: list[str]) -> str:
    """Ensure no two fields share the same label (the picker enforces this
    too, but better to send a clean schema)."""
    if base not in taken:
        return base
    i = 2
    while f"{base}_{i}" in taken:
        i += 1
    return f"{base}_{i}"


def _scalar_candidates(
    elements: list[dict[str, Any]],
    *,
    exclude_labels: set[str],
) -> list[dict[str, Any]]:
    """Pick a few single-occurrence high-value fields from the catalog —
    h1, page price, primary image. Used to round out heuristic suggestions
    when there aren't enough repeating patterns to fill max_fields."""
    out: list[dict[str, Any]] = []

    # First h1
    for el in elements:
        if (el.get("tag") or "").lower() == "h1" and (el.get("text") or "").strip():
            css = el.get("css") or ""
            if css and "title" not in exclude_labels:
                out.append({"label": "title", "selector": css, "kind": "text", "attr": ""})
                break

    # First price-looking text
    for el in elements:
        text = (el.get("text") or "").strip()
        if re.search(r"[\$€£₹¥]\s*\d", text):
            css = el.get("css") or ""
            if css and "price" not in exclude_labels:
                out.append({"label": "price", "selector": css, "kind": "text", "attr": ""})
                break

    # First substantial image
    for el in elements:
        if (el.get("tag") or "").lower() == "img":
            attrs = el.get("attrs") or {}
            css = el.get("css") or ""
            if css and attrs.get("src") and "image" not in exclude_labels:
                out.append({
                    "label": "image",
                    "selector": css,
                    "kind": "attr",
                    "attr": "src",
                })
                break

    return out


# ── Prompt ───────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You build web-scraping schemas. Input: a JSON array of page elements
(each has `t`=tag, `x`=text, `c`=CSS selector) + a user description.

Output ONLY this JSON object — no prose, no fences:

{"template":[{"label":"snake_case","selector":"<verbatim from c>","kind":"text|attr|list|markdown","attr":"<only if kind=attr>"}]}

CRITICAL RULES — violations cause silent extraction failures:

1. SELECTORS MUST COME VERBATIM FROM THE `c` FIELD ABOVE.
   Do NOT generate selectors from memory. Do NOT use selectors you
   "expect" a site like Amazon/Target/etc to have (e.g. #productTitle,
   #pdp-product-title-id, .a-price-whole) unless they literally appear
   in the `c` field of an element you can see in the input array.

2. IF YOU CAN'T FIND A FIELD, OMIT IT.
   Returning a hallucinated selector means the user gets `null` back
   and thinks the product is broken. Returning fewer fields with real
   selectors is ALWAYS better than more fields with invented selectors.

3. EXTRACT STRUCTURE, NOT COMPUTED ANSWERS.
   You can't sort, filter, count, or compute — you only select DOM nodes.
   If the user asks "the product with the highest discount", you CANNOT
   answer that directly. Instead extract the WHOLE LIST so they can
   sort/filter in code:
     ✓ products = list, prices = list, discounts = list
     ✗ highest_discount_product = text (you can't know which is highest)
   Same for "the cheapest", "the best rated", "the top 5" — all become
   list extractions, never scalars.

4. PREFER LIST FIELDS WHEN THE USER MENTIONS PLURAL ITEMS.
   Words like "products", "items", "stories", "results", "rows",
   "every", "all", "each" → use `list`. The selector should be the
   shape that matches the repeating pattern (strip nth-of-type from
   the catalog selectors to make it cover all matches).

5. WHAT THE USER ASKED FOR IS A HINT, NOT A CONTRACT.
   If the user says "get everything a user might check while buying"
   and only 3 of those things are present in the catalog, return
   exactly 3 fields. Do NOT pad with invented selectors to look helpful.

6. KIND RULES:
   - `list` for repeating items (e.g. every story on a feed). Pick ONE
     representative element from the repeating pattern — its selector
     shape works for the whole list.
   - `text` for a single distinct value (h1 title, single price node).
   - `attr` only when extracting an attribute (href, src, alt, datetime).
     Set `attr` to the attribute name.
   - `markdown` for rich content blocks (article body, comment thread).

7. LABELS: short snake_case, descriptive, no spaces, no punctuation."""


# ── Generation ───────────────────────────────────────────────────────────


def _build_payload(model: str, system: str, user: str) -> dict[str, Any]:
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "max_tokens": 2000,
    }


def _is_dead_model_error(status: int, body_text: str) -> bool:
    """Heuristic: does this response mean 'this model is gone / unsupported'?

    Covered:
      * Groq:     400 + 'decommissioned' or code='model_decommissioned'
      * Groq:     400 + 'model_not_found'
      * OpenAI:   404 + code='model_not_found'
      * Generic:  404 status (model endpoint missing on provider)
    Not covered (intentionally):
      * 429 rate-limit — same model might work in 60s, don't blacklist it
      * 5xx server error — provider problem, not model problem
    """
    lower = body_text.lower()
    if status == 404:
        return True
    if status == 400 and (
        "decommissioned" in lower
        or "model_decommissioned" in lower
        or "model_not_found" in lower
        or "does not exist" in lower
        or "no such model" in lower
        or "is not supported" in lower
    ):
        return True
    return False


def _extract_error_message(body_text: str) -> str:
    """Pull a clean human-readable message from a provider error response,
    falling back to the raw body if shape is unexpected."""
    try:
        data = json.loads(body_text)
        if isinstance(data, dict):
            err = data.get("error")
            if isinstance(err, dict):
                msg = err.get("message")
                if isinstance(msg, str):
                    return msg
            if isinstance(err, str):
                return err
    except (json.JSONDecodeError, TypeError):
        pass
    return body_text[:200]


async def _call_one_model(
    *,
    model: str,
    user_msg: str,
) -> httpx.Response:
    """Single POST to the configured provider with a specific model.
    Caller decides what to do with the result."""
    payload = _build_payload(model, _SYSTEM_PROMPT, user_msg)
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
        return await client.post(
            f"{LLM_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {LLM_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )


async def auto_suggest_template(
    *,
    elements: list[dict[str, Any]],
    url: str,
    title: str = "",
) -> tuple[list[dict[str, Any]], str]:
    """Landing-page magic preview entry point. The whole homepage demo
    hinges on this — visitors paste a URL and expect to see fields
    auto-picked. We must ALWAYS return something concrete; the empty
    "we couldn't auto-pick" state breaks the magic.

    Resolution order:
      1. If the LLM is configured, ask it (best results — picks the
         specific fields a user wants for this page type).
      2. If the LLM is missing OR returns nothing OR throws, fall back
         to the local heuristic suggester (works without any LLM,
         finds repeating patterns + high-value scalars).
      3. If even the heuristic returns nothing (extremely sparse page),
         return an empty template — the frontend then shows the
         "open in picker and click what you want" CTA.

    Returns: (template, page_type)
    """
    page_type = _detect_page_type(elements, title)

    # Path 1 — try the LLM first if configured. Soft-fail to heuristic
    # on ANY error so the homepage demo never breaks because of LLM issues.
    if is_configured():
        try:
            seed_description = PAGE_TYPE_SEED_DESCRIPTIONS.get(
                page_type, PAGE_TYPE_SEED_DESCRIPTIONS["generic"]
            )
            template = await generate_template(
                elements=elements,
                description=seed_description,
                url=url,
                title=title,
            )
            if template:
                return template, page_type
            log.info("LLM returned empty template, falling back to heuristic")
        except LLMError as e:
            log.warning("LLM error (%s), falling back to heuristic: %s", e.kind, e)
        except Exception as e:
            log.warning("LLM unexpected error, falling back to heuristic: %r", e)

    # Path 2 — heuristic fallback. Always works, no network calls.
    heuristic_template = _heuristic_suggest_fields(elements, max_fields=5)
    return heuristic_template, page_type


async def generate_template(
    *,
    elements: list[dict[str, Any]],
    description: str,
    url: str,
    title: str = "",
) -> list[dict[str, Any]]:
    """Call the LLM, return a parsed template array.

    Iterates the model chain on model-level failures (deprecation, 404).
    Auto-shrinks the catalog on 413 (request too large) without restarting
    the chain. Caches dead models so subsequent requests skip them.
    """
    if not is_configured():
        raise LLMError(
            "AI schema generation is not configured. Admin: set LLM_API_KEY "
            "(free Groq key at console.groq.com).",
            status=503,
            kind="not_configured",
        )

    chain = _resolve_model_chain()
    if not chain:
        raise LLMError(
            "No LLM models configured. Set LLM_MODELS env var.",
            status=503,
            kind="not_configured",
        )

    # Skip known-dead models — but keep them as last-resort fallback in case
    # the cache is wrong (provider revived a model, our cache is stale).
    live = [m for m in chain if m not in _DEAD_MODELS]
    revived_attempt = [m for m in chain if m in _DEAD_MODELS]
    attempt_order = live + revived_attempt

    trimmed = _trim_catalog(elements, max_elements=MAX_CATALOG_ELEMENTS)
    user_msg = (
        f"URL: {url}\n"
        f"Title: {title or '(no title)'}\n\n"
        f"Elements ({len(trimmed)}/{len(elements)} kept after dedup+filter):\n"
        f"{json.dumps(trimmed, separators=(',', ':'))}\n\n"
        f"Extract: {description}"
    )

    last_non_model_error: tuple[int, str] | None = None
    tried: list[str] = []

    for model in attempt_order:
        tried.append(model)
        try:
            res = await _call_one_model(model=model, user_msg=user_msg)
        except httpx.TimeoutException as e:
            log.warning("LLM timeout on model=%s: %s", model, e)
            last_non_model_error = (504, f"timeout after {LLM_TIMEOUT}s")
            continue
        except httpx.HTTPError as e:
            log.warning("LLM transport error on model=%s: %s", model, e)
            last_non_model_error = (502, f"transport error: {e}")
            continue

        # Happy path
        if res.status_code < 400:
            _DEAD_MODELS.discard(model)
            log.info("LLM ok model=%s status=%d", model, res.status_code)
            template = _parse_response(res, model=model)
            return _validate_selectors(template, catalog=trimmed, all_elements=elements, model=model)

        # 413 — payload too large. Trim and retry on the SAME model
        # (not a model problem, don't waste a fallback hop).
        if res.status_code == 413:
            res = await _retry_with_trim(
                model=model,
                elements=elements,
                description=description,
                url=url,
            )
            if res is not None and res.status_code < 400:
                _DEAD_MODELS.discard(model)
                template = _parse_response(res, model=model)
                return _validate_selectors(template, catalog=trimmed, all_elements=elements, model=model)
            # If retry still failed, fall through to non-model-error handling.

        body_text = res.text if res is not None else ""
        if res is not None and _is_dead_model_error(res.status_code, body_text):
            log.warning("LLM model dead model=%s status=%d: %s", model, res.status_code, body_text[:200])
            _DEAD_MODELS.add(model)
            continue  # Try next model in chain.

        # Non-model error (auth, rate-limit, 5xx) — don't burn the chain on
        # it. Remember it and break; if no model succeeds we'll report this.
        if res is not None:
            last_non_model_error = (res.status_code, _extract_error_message(body_text))
            # Retry the next model anyway — sometimes a different model has
            # a different rate-limit bucket on the same provider.
            continue

    # Chain exhausted. Decide what to report.
    if last_non_model_error is not None:
        status, msg = last_non_model_error
        if status == 401 or status == 403:
            raise LLMError(
                "LLM provider rejected the API key. Admin: check LLM_API_KEY.",
                status=503,
                kind="auth",
            )
        if status == 429:
            raise LLMError(
                "AI is rate-limited right now. Try the visual picker instead, "
                "or wait ~60 seconds.",
                status=429,
                kind="rate_limit",
            )
        if status == 504:
            raise LLMError(
                f"AI service timed out after {LLM_TIMEOUT}s. Try a smaller page "
                "or the visual picker.",
                status=504,
                kind="timeout",
            )
        raise LLMError(
            f"AI service error ({status}): {msg}",
            status=502,
            kind="error",
        )

    # Every model in the chain returned a model-dead error.
    raise LLMError(
        f"All configured AI models are unavailable: {', '.join(tried)}. "
        "Admin: update LLM_MODELS env var with current model names — "
        "see https://console.groq.com/docs/models",
        status=503,
        kind="all_models_dead",
    )


async def _retry_with_trim(
    *,
    model: str,
    elements: list[dict[str, Any]],
    description: str,
    url: str,
) -> httpx.Response | None:
    """Half-then-quarter trim retry sequence for 413 (payload too large).
    Returns the last response (success or final failure)."""
    last: httpx.Response | None = None
    for factor in (0.5, 0.25):
        half_trim = _trim_catalog(elements, max_elements=max(20, int(MAX_CATALOG_ELEMENTS * factor)))
        cap = max(20, int(MAX_TEXT_LEN * factor))
        for el in half_trim:
            if el.get("x") and len(el["x"]) > cap:
                el["x"] = el["x"][:cap]
        retry_msg = (
            f"URL: {url}\nElements ({len(half_trim)} trimmed for size):\n"
            f"{json.dumps(half_trim, separators=(',', ':'))}\n"
            f"Extract: {description}"
        )
        try:
            last = await _call_one_model(model=model, user_msg=retry_msg)
        except (httpx.TimeoutException, httpx.HTTPError) as e:
            log.warning("LLM trim-retry transport error model=%s: %s", model, e)
            return None
        if last.status_code != 413:
            return last
    return last


def _parse_response(res: httpx.Response, *, model: str) -> list[dict[str, Any]]:
    """Extract + validate the template array from a successful LLM response."""
    body = res.json()
    choices = body.get("choices", [])
    if not choices:
        raise LLMError(
            f"LLM (model={model}) returned no choices",
            status=502,
            kind="bad_response",
        )

    content = choices[0].get("message", {}).get("content", "").strip()
    if not content:
        raise LLMError(
            f"LLM (model={model}) returned empty content",
            status=502,
            kind="bad_response",
        )

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
        raise LLMError(
            f"LLM (model={model}) returned invalid JSON: {e}",
            status=502,
            kind="bad_response",
        ) from e

    if isinstance(parsed, dict) and "template" in parsed:
        items = parsed["template"]
    elif isinstance(parsed, list):
        items = parsed
    elif isinstance(parsed, dict):
        items = next((v for v in parsed.values() if isinstance(v, list)), None)
        if items is None:
            raise LLMError(
                f"LLM (model={model}) returned unexpected shape: {list(parsed.keys())}",
                status=502,
                kind="bad_response",
            )
    else:
        raise LLMError(
            f"LLM (model={model}) returned unexpected type: {type(parsed).__name__}",
            status=502,
            kind="bad_response",
        )

    if not isinstance(items, list):
        raise LLMError(
            f"Expected a list of fields, got {type(items).__name__}",
            status=502,
            kind="bad_response",
        )

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


def _validate_selectors(
    template: list[dict[str, Any]],
    *,
    catalog: list[dict[str, Any]],
    all_elements: list[dict[str, Any]],
    model: str,
) -> list[dict[str, Any]]:
    """Drop fields whose selector wasn't actually in the catalog we sent.

    This is the anti-hallucination guard rail. The LLM is *instructed* to
    pick selectors verbatim from `c`, but instruction-following isn't 100%.
    Models often pad responses with template-y selectors they learned
    during training (#productTitle for Amazon, #pdp-product-title-id for
    Target). When the actual page doesn't have those, the extraction
    silently returns null and the user thinks the product is broken.

    Rule: keep a field only if its selector matches one of:
      a) The exact selector of some element we sent (`c` field).
      b) The "shape" of some element's selector (nth-of-type stripped) —
         this is the legitimate list-selector case, where the LLM
         generalizes `.row:nth-of-type(3) .title` → `.row .title`.
      c) The exact selector of some element NOT in the trimmed catalog
         but present in the full element set (rare but valid: the LLM
         saw a duplicate that the trim deduped, and copied the original).
    """
    if not template:
        return template

    catalog_selectors = {el.get("c", "") for el in catalog if el.get("c")}
    catalog_shapes = {_NTH_OF_TYPE_RE.sub("", s) for s in catalog_selectors}
    all_selectors = {el.get("css", "") for el in all_elements if el.get("css")}
    all_shapes = {_NTH_OF_TYPE_RE.sub("", s) for s in all_selectors}

    kept: list[dict[str, Any]] = []
    dropped: list[str] = []
    for f in template:
        sel = f.get("selector", "")
        if not sel:
            continue
        shape = _NTH_OF_TYPE_RE.sub("", sel)
        if (
            sel in catalog_selectors
            or shape in catalog_shapes
            or sel in all_selectors
            or shape in all_shapes
        ):
            kept.append(f)
        else:
            dropped.append(f"{f.get('label','?')}={sel[:60]}")

    if dropped:
        log.warning(
            "LLM hallucinated %d/%d selectors (model=%s): %s",
            len(dropped), len(template), model, "; ".join(dropped),
        )
    return kept


# ── Catalog trim helpers ─────────────────────────────────────────────────

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
            "t": tag,
            "x": text[:MAX_TEXT_LEN] if text else "",
            "c": css,
        })
        if len(out) >= max_elements:
            break
    return out
