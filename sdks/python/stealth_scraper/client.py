"""Sync and async clients for the Stealth Scraper API.

Design notes:
    * Both clients share `_build_headers` and `_raise_for_status` to keep the
      auth + error envelope behaviour identical. Diverging them is a recipe
      for the sync surface returning a different exception class than the
      async surface for the same backend response.
    * Idempotency keys are auto-generated when not supplied (UUID4). The
      backend can dedupe replays cheaply because every mutating call carries
      one. Callers who want explicit replay protection across retries pass
      their own.
    * `httpx.Client` is held open across calls so we get HTTP/2 + connection
      reuse. Explicit `close()` / `__exit__` to release.
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import AsyncIterator, Mapping
from typing import Any

import httpx

from stealth_scraper.exceptions import (
    KIND_TO_EXC,
    ApiError,
    AuthError,
    OverloadedError,
    RateLimitError,
)
from stealth_scraper.models import (
    AssistExtractResult,
    EstimateResult,
    ExtractResult,
    SnapshotProgress,
    SnapshotResult,
    Template,
)

DEFAULT_BASE_URL = "https://api.stealthscraper.dev"
DEFAULT_TIMEOUT = 120.0  # snapshots can take a while on heavy sites
_USER_AGENT = "stealth-scraper-python/0.1.0"


def _gen_idempotency_key() -> str:
    """Generate a fresh idempotency key. UUID4 is plenty unique for SDK use."""
    return f"sdk-{uuid.uuid4().hex}"


def _parse_detail(payload: Any) -> tuple[str | None, str, Any]:
    """Pull (kind, message, raw_detail) out of a FastAPI-style error envelope.

    The backend usually returns ``{"detail": {...}}`` for structured errors
    and ``{"detail": "string"}`` for ad-hoc ones. Handle both, plus the rare
    case where the body isn't JSON at all (network ate it, gateway 502, etc.).
    """
    if isinstance(payload, dict):
        detail = payload.get("detail", payload)
        if isinstance(detail, dict):
            kind = detail.get("kind")
            msg = detail.get("message") or detail.get("error") or json.dumps(detail)
            return kind, msg, detail
        return None, str(detail), detail
    return None, str(payload), payload


def _raise_for_status(response: httpx.Response) -> None:
    """Translate non-2xx responses into typed exceptions.

    Called by both sync and async clients. Reads the body once (it's already
    fully received at this point) and decides which subclass to raise based on
    the ``detail.kind`` envelope. Falls back to ApiError when the kind is
    missing or unknown.
    """
    if response.status_code < 400:
        return

    request_id = response.headers.get("x-request-id")
    try:
        payload = response.json()
    except Exception:  # body wasn't JSON — gateway error, HTML page, etc.
        payload = {"detail": response.text or response.reason_phrase}

    kind, message, detail = _parse_detail(payload)
    status = response.status_code

    # Status-code-based shortcuts for cases the backend doesn't always tag
    # with an explicit `kind` (401/403/429 in particular).
    if status in (401, 403) and not kind:
        raise AuthError(
            message or "authentication failed",
            status_code=status,
            kind=kind,
            detail=detail,
            request_id=request_id,
        )

    exc_cls = KIND_TO_EXC.get(kind or "", ApiError)

    # Pull structured fields out of detail when the typed subclass cares.
    extra: dict[str, Any] = {}
    if isinstance(detail, dict):
        if exc_cls.__name__ == "AntiBotBlockError":
            extra["vendor"] = detail.get("vendor")
            extra["suggestion"] = detail.get("suggestion")
        elif exc_cls.__name__ == "PlanLimitError":
            extra["used"] = detail.get("used")
            extra["limit"] = detail.get("limit")
            extra["upgrade_url"] = detail.get("upgrade_url")
        elif exc_cls.__name__ in ("OverloadedError", "RateLimitError"):
            ra = detail.get("retry_after_s") or detail.get("retry_after")
            if ra is None:
                hdr = response.headers.get("retry-after")
                if hdr:
                    try:
                        ra = float(hdr)
                    except ValueError:
                        ra = None
            if ra is not None:
                extra["retry_after_s"] = float(ra)

    # 429 without an explicit kind still gets routed to RateLimitError.
    if status == 429 and exc_cls is ApiError:
        exc_cls = RateLimitError
        hdr = response.headers.get("retry-after")
        if hdr and "retry_after_s" not in extra:
            try:
                extra["retry_after_s"] = float(hdr)
            except ValueError:
                pass

    # 503 → OverloadedError unless we already matched something better.
    if status == 503 and exc_cls is ApiError:
        exc_cls = OverloadedError

    raise exc_cls(
        message,
        status_code=status,
        kind=kind,
        detail=detail,
        request_id=request_id,
        **extra,
    )


def _build_headers(
    api_key: str,
    *,
    idempotency_key: str | None,
    extra: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Assemble the headers for a single request.

    Idempotency-Key is always sent on mutating calls. The auto-generator is
    cheap and the backend treats absence as "don't dedupe", which loses us a
    safety net for free retries.
    """
    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "User-Agent": _USER_AGENT,
        "Accept": "application/json",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    if extra:
        headers.update(extra)
    return headers


class _BaseClient:
    """Shared config + URL/body helpers for both sync and async clients."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        api_key = api_key or os.environ.get("STEALTH_SCRAPER_API_KEY")
        if not api_key:
            raise ValueError(
                "api_key is required. Pass it explicitly or set "
                "STEALTH_SCRAPER_API_KEY in the environment."
            )
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return f"{self._base_url}{path}"


class StealthClient(_BaseClient):
    """Synchronous client backed by ``httpx.Client``.

    Example::

        from stealth_scraper import StealthClient
        client = StealthClient(api_key="ssk_...")
        snap = client.snapshot("https://news.ycombinator.com/")
        print(snap.title, len(snap.elements))

    Use ``with StealthClient(...) as c:`` to ensure the underlying HTTP
    connection pool is released promptly.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        http_client: httpx.Client | None = None,
    ) -> None:
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout)
        self._http = http_client or httpx.Client(timeout=timeout)
        self._owns_http = http_client is None

    # Lifecycle ----------------------------------------------------------------

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> StealthClient:
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()

    # Low-level transport ------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        # Mutating verbs always get an idempotency key (auto if not supplied).
        if method in ("POST", "PUT", "PATCH", "DELETE") and not idempotency_key:
            idempotency_key = _gen_idempotency_key()
        headers = _build_headers(self._api_key, idempotency_key=idempotency_key)
        resp = self._http.request(
            method,
            self._url(path),
            json=json_body,
            params=params,
            headers=headers,
            timeout=self._timeout,
        )
        _raise_for_status(resp)
        if resp.status_code == 204 or not resp.content:
            return {}
        return resp.json()

    # ----- Public API ---------------------------------------------------------

    def snapshot(
        self,
        url: str,
        *,
        viewport_width: int | None = None,
        viewport_height: int | None = None,
        actions: list[dict[str, Any]] | None = None,
        idempotency_key: str | None = None,
    ) -> SnapshotResult:
        """Take a stealth snapshot of a page.

        Returns a `SnapshotResult` with screenshot, page metadata, and the
        element catalog the backend uses for downstream extraction.
        """
        body: dict[str, Any] = {"url": url}
        if viewport_width is not None:
            body["viewport_width"] = viewport_width
        if viewport_height is not None:
            body["viewport_height"] = viewport_height
        if actions:
            body["actions"] = actions
        data = self._request("POST", "/snapshot", json_body=body, idempotency_key=idempotency_key)
        return SnapshotResult.from_response(data)

    def extract(
        self,
        url: str,
        *,
        template: list[dict[str, Any]] | None = None,
        template_id: str | None = None,
        output_format: str = "json",
        pagination_selector: str | None = None,
        max_pages: int = 1,
        actions: list[dict[str, Any]] | None = None,
        idempotency_key: str | None = None,
    ) -> ExtractResult:
        """Run an extraction against `url`.

        Provide either an inline `template` (list of field specs) or a saved
        `template_id`. When both are given, `template` wins for explicitness.
        """
        if template is None and template_id is None:
            raise ValueError("extract() requires either `template` or `template_id`.")
        if template is None:
            # Hydrate the template from the saved recipe so we can reuse the
            # same /extract endpoint instead of needing a server-side runner.
            tmpl = self.get_template(template_id)  # type: ignore[arg-type]
            template = tmpl.fields
        body: dict[str, Any] = {
            "url": url,
            "template": template,
            "output_format": output_format,
            "max_pages": max_pages,
        }
        if pagination_selector:
            body["pagination_selector"] = pagination_selector
        if actions:
            body["actions"] = actions
        data = self._request("POST", "/extract", json_body=body, idempotency_key=idempotency_key)
        return ExtractResult.from_response(data)

    def assist_extract(
        self,
        url: str,
        description: str,
        *,
        viewport_width: int | None = None,
        viewport_height: int | None = None,
        idempotency_key: str | None = None,
    ) -> AssistExtractResult:
        """Ask the AI to generate a template from a natural-language description,
        then run it. Returns the generated template alongside extracted values.
        """
        body: dict[str, Any] = {"url": url, "description": description}
        if viewport_width is not None:
            body["viewport_width"] = viewport_width
        if viewport_height is not None:
            body["viewport_height"] = viewport_height
        data = self._request(
            "POST", "/assist/schema", json_body=body, idempotency_key=idempotency_key
        )
        return AssistExtractResult.from_response(data)

    def estimate(
        self,
        url: str,
        *,
        template: list[dict[str, Any]] | None = None,
        schema: list[dict[str, Any]] | None = None,
        idempotency_key: str | None = None,
    ) -> EstimateResult:
        """Preview the credit cost of a scrape before running it.

        NOTE: The backend `/estimate` endpoint is a planned addition. Until it
        ships, expect ApiError(404). See ``sdks/BACKEND_TODO.md``.
        """
        body: dict[str, Any] = {"url": url}
        if template is not None:
            body["template"] = template
        if schema is not None:
            body["schema"] = schema
        data = self._request(
            "POST", "/estimate", json_body=body, idempotency_key=idempotency_key
        )
        return EstimateResult.from_response(data)

    # ----- Templates ----------------------------------------------------------

    def list_templates(self) -> list[Template]:
        data = self._request("GET", "/templates")
        items = data if isinstance(data, list) else data.get("items", [])
        return [Template.from_response(t) for t in items]

    def get_template(self, template_id: str) -> Template:
        data = self._request("GET", f"/templates/{template_id}")
        return Template.from_response(data)

    def run_template(
        self,
        template_id: str,
        url: str,
        *,
        idempotency_key: str | None = None,
    ) -> ExtractResult:
        """Convenience: fetch the template, then run it against `url`."""
        return self.extract(url=url, template_id=template_id, idempotency_key=idempotency_key)


class AsyncStealthClient(_BaseClient):
    """Asynchronous client backed by ``httpx.AsyncClient``.

    Example::

        async with AsyncStealthClient(api_key="ssk_...") as client:
            snap = await client.snapshot("https://example.com")
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        super().__init__(api_key=api_key, base_url=base_url, timeout=timeout)
        self._http = http_client or httpx.AsyncClient(timeout=timeout)
        self._owns_http = http_client is None

    async def close(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def __aenter__(self) -> AsyncStealthClient:
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        await self.close()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        if method in ("POST", "PUT", "PATCH", "DELETE") and not idempotency_key:
            idempotency_key = _gen_idempotency_key()
        headers = _build_headers(self._api_key, idempotency_key=idempotency_key)
        resp = await self._http.request(
            method,
            self._url(path),
            json=json_body,
            params=params,
            headers=headers,
            timeout=self._timeout,
        )
        _raise_for_status(resp)
        if resp.status_code == 204 or not resp.content:
            return {}
        return resp.json()

    async def snapshot(
        self,
        url: str,
        *,
        viewport_width: int | None = None,
        viewport_height: int | None = None,
        actions: list[dict[str, Any]] | None = None,
        idempotency_key: str | None = None,
    ) -> SnapshotResult:
        body: dict[str, Any] = {"url": url}
        if viewport_width is not None:
            body["viewport_width"] = viewport_width
        if viewport_height is not None:
            body["viewport_height"] = viewport_height
        if actions:
            body["actions"] = actions
        data = await self._request(
            "POST", "/snapshot", json_body=body, idempotency_key=idempotency_key
        )
        return SnapshotResult.from_response(data)

    async def extract(
        self,
        url: str,
        *,
        template: list[dict[str, Any]] | None = None,
        template_id: str | None = None,
        output_format: str = "json",
        pagination_selector: str | None = None,
        max_pages: int = 1,
        actions: list[dict[str, Any]] | None = None,
        idempotency_key: str | None = None,
    ) -> ExtractResult:
        if template is None and template_id is None:
            raise ValueError("extract() requires either `template` or `template_id`.")
        if template is None:
            tmpl = await self.get_template(template_id)  # type: ignore[arg-type]
            template = tmpl.fields
        body: dict[str, Any] = {
            "url": url,
            "template": template,
            "output_format": output_format,
            "max_pages": max_pages,
        }
        if pagination_selector:
            body["pagination_selector"] = pagination_selector
        if actions:
            body["actions"] = actions
        data = await self._request(
            "POST", "/extract", json_body=body, idempotency_key=idempotency_key
        )
        return ExtractResult.from_response(data)

    async def assist_extract(
        self,
        url: str,
        description: str,
        *,
        viewport_width: int | None = None,
        viewport_height: int | None = None,
        idempotency_key: str | None = None,
    ) -> AssistExtractResult:
        body: dict[str, Any] = {"url": url, "description": description}
        if viewport_width is not None:
            body["viewport_width"] = viewport_width
        if viewport_height is not None:
            body["viewport_height"] = viewport_height
        data = await self._request(
            "POST", "/assist/schema", json_body=body, idempotency_key=idempotency_key
        )
        return AssistExtractResult.from_response(data)

    async def estimate(
        self,
        url: str,
        *,
        template: list[dict[str, Any]] | None = None,
        schema: list[dict[str, Any]] | None = None,
        idempotency_key: str | None = None,
    ) -> EstimateResult:
        body: dict[str, Any] = {"url": url}
        if template is not None:
            body["template"] = template
        if schema is not None:
            body["schema"] = schema
        data = await self._request(
            "POST", "/estimate", json_body=body, idempotency_key=idempotency_key
        )
        return EstimateResult.from_response(data)

    async def list_templates(self) -> list[Template]:
        data = await self._request("GET", "/templates")
        items = data if isinstance(data, list) else data.get("items", [])
        return [Template.from_response(t) for t in items]

    async def get_template(self, template_id: str) -> Template:
        data = await self._request("GET", f"/templates/{template_id}")
        return Template.from_response(data)

    async def run_template(
        self,
        template_id: str,
        url: str,
        *,
        idempotency_key: str | None = None,
    ) -> ExtractResult:
        return await self.extract(
            url=url, template_id=template_id, idempotency_key=idempotency_key
        )

    async def snapshot_stream(
        self,
        url: str,
        *,
        viewport_width: int | None = None,
        viewport_height: int | None = None,
        actions: list[dict[str, Any]] | None = None,
        idempotency_key: str | None = None,
    ) -> AsyncIterator[SnapshotProgress]:
        """Stream snapshot progress events via Server-Sent Events.

        NOTE: requires the backend to expose ``/snapshot/stream`` returning
        ``text/event-stream`` with one JSON payload per ``data:`` line. Until
        that ships, this falls back to a synthetic "queued → done" event pair
        wrapping a normal :py:meth:`snapshot` call, so callers can adopt the
        API today and gain streaming for free when the server is ready.
        """
        body: dict[str, Any] = {"url": url}
        if viewport_width is not None:
            body["viewport_width"] = viewport_width
        if viewport_height is not None:
            body["viewport_height"] = viewport_height
        if actions:
            body["actions"] = actions
        if not idempotency_key:
            idempotency_key = _gen_idempotency_key()
        headers = _build_headers(
            self._api_key,
            idempotency_key=idempotency_key,
            extra={"Accept": "text/event-stream"},
        )

        try:
            async with self._http.stream(
                "POST",
                self._url("/snapshot/stream"),
                json=body,
                headers=headers,
                timeout=self._timeout,
            ) as resp:
                if resp.status_code == 404:
                    # Endpoint not deployed yet — synthesize a 2-event stream.
                    await resp.aclose()
                    yield SnapshotProgress(
                        event="queued",
                        message="streaming endpoint unavailable; falling back to /snapshot",
                        progress=0.0,
                    )
                    snap = await self.snapshot(
                        url,
                        viewport_width=viewport_width,
                        viewport_height=viewport_height,
                        actions=actions,
                        idempotency_key=idempotency_key,
                    )
                    yield SnapshotProgress(
                        event="done", message="done", progress=1.0, result=snap
                    )
                    return

                _raise_for_status(resp)
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    payload = line[len("data:") :].strip()
                    if not payload:
                        continue
                    try:
                        ev = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    result = None
                    if ev.get("event") == "done" and isinstance(ev.get("result"), dict):
                        result = SnapshotResult.from_response(ev["result"])
                    yield SnapshotProgress(
                        event=ev.get("event", "message"),
                        message=ev.get("message", ""),
                        progress=float(ev.get("progress", 0.0) or 0.0),
                        result=result,
                        raw=ev,
                    )
        except httpx.HTTPError as e:
            raise ApiError(f"streaming snapshot failed: {e}") from e
