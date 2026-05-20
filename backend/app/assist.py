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
