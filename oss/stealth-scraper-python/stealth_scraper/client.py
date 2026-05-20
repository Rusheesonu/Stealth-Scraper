"""Async client for the Stealth-Scraper REST API.

Thin wrapper over httpx — no surprises, no magic. Patterns mirror modern
LLM SDKs (OpenAI, etc.) so the ergonomics feel familiar.
"""

from __future__ import annotations

import os
from typing import Any, Literal, TypedDict

import httpx


__all__ = ["Client", "StealthScraperError", "TemplateField"]


DEFAULT_BASE_URL = "https://stealthscraper.dev"
DEFAULT_TIMEOUT = 60.0


class TemplateField(TypedDict, total=False):
    label: str
    selector: str
    xpath: str
    kind: Literal["text", "attr", "list", "html"]
    attr: str


class StealthScraperError(RuntimeError):
    """Raised on any 4xx/5xx response from the API.

    Attributes:
        status_code: HTTP status (e.g. 401, 403, 502).
        detail:      Parsed `detail` field from the JSON response, or empty.
        body:        Raw response body (truncated to 1KB).
    """

    def __init__(self, status_code: int, detail: str, body: str) -> None:
        super().__init__(f"HTTP {status_code}: {detail or body}")
        self.status_code = status_code
        self.detail = detail
        self.body = body


class Client:
    """Async client for the Stealth-Scraper API.

    Usage:
        async with Client() as c:
            result = await c.snapshot("https://example.com")
        # — or —
        c = Client()
        try:
            ...
        finally:
            await c.aclose()
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("STEALTH_SCRAPER_API_KEY", "")
        if not self.api_key:
            raise ValueError(
                "api_key is required — pass directly or set STEALTH_SCRAPER_API_KEY. "
                "Get one at https://stealthscraper.dev/settings/api-keys"
            )
        self.base_url = (base_url or os.environ.get("STEALTH_SCRAPER_BASE_URL", DEFAULT_BASE_URL)).rstrip("/")
        self.timeout = timeout or float(os.environ.get("STEALTH_SCRAPER_TIMEOUT", DEFAULT_TIMEOUT))
        self._http = httpx.AsyncClient(
            base_url=f"{self.base_url}/api/backend",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "stealth-scraper-python/0.1.0",
            },
            timeout=self.timeout,
        )
        self.templates = _TemplatesAPI(self)

    async def __aenter__(self) -> "Client":
        return self

    async def __aexit__(self, *exc) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    # ── HTTP helpers ──────────────────────────────────────────────────────

    async def _post(self, path: str, body: dict[str, Any]) -> Any:
        res = await self._http.post(path, json=body)
        return self._handle(res)

    async def _get(self, path: str) -> Any:
        res = await self._http.get(path)
        return self._handle(res)

    async def _put(self, path: str, body: dict[str, Any]) -> Any:
        res = await self._http.put(path, json=body)
        return self._handle(res)

    async def _delete(self, path: str) -> Any:
        res = await self._http.delete(path)
        if res.status_code == 204:
            return None
        return self._handle(res)

    def _handle(self, res: httpx.Response) -> Any:
        if res.status_code >= 400:
            body = res.text[:1024]
            detail = ""
            try:
                j = res.json()
                if isinstance(j, dict) and "detail" in j:
                    detail = str(j["detail"])
            except Exception:
                pass
            raise StealthScraperError(res.status_code, detail, body)
        return res.json()

    # ── Public methods ────────────────────────────────────────────────────

    async def snapshot(
        self,
        url: str,
        *,
        viewport_width: int = 1440,
        viewport_height: int = 900,
    ) -> dict[str, Any]:
        """Load a URL in a stealth Chromium and return screenshot + element catalog.

        Returns a dict with: url, title, screenshot (base64 PNG), viewport,
        page, elements, element_count. Counts as 1 scrape against the user's
        monthly quota."""
        return await self._post(
            "/snapshot",
            {
                "url": url,
                "viewport_width": viewport_width,
                "viewport_height": viewport_height,
            },
        )

    async def extract(self, url: str, template: list[TemplateField]) -> dict[str, Any]:
        """Run a template against a URL → structured fields. Counts as 1 scrape.

        Returns: {url, title, fields: {label: value}, errors: {label: msg}}.
        List fields that share an ancestor are row-aligned automatically."""
        return await self._post("/extract", {"url": url, "template": template})

    async def batch(
        self, urls: list[str], template: list[TemplateField]
    ) -> dict[str, Any]:
        """Run one template across many URLs (max 100). Counts as N scrapes.

        Returns: {count, results: [{url, data: {...}}, ...]}."""
        return await self._post("/extract/batch", {"urls": urls, "template": template})


class _TemplatesAPI:
    """Saved template CRUD. Access via `client.templates`."""

    def __init__(self, parent: Client) -> None:
        self._c = parent

    async def list(self) -> list[dict[str, Any]]:
        return await self._c._get("/templates")

    async def get(self, template_id: int) -> dict[str, Any]:
        return await self._c._get(f"/templates/{template_id}")

    async def create(
        self,
        *,
        name: str,
        source_url: str,
        fields: list[TemplateField],
    ) -> dict[str, Any]:
        return await self._c._post(
            "/templates",
            {"name": name, "source_url": source_url, "fields": fields},
        )

    async def update(
        self,
        template_id: int,
        *,
        name: str | None = None,
        source_url: str | None = None,
        fields: list[TemplateField] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if source_url is not None:
            body["source_url"] = source_url
        if fields is not None:
            body["fields"] = fields
        return await self._c._put(f"/templates/{template_id}", body)

    async def delete(self, template_id: int) -> None:
        await self._c._delete(f"/templates/{template_id}")
