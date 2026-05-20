"""MCP server — exposes Stealth-Scraper's API as three tools agents can call.

Tools:
    snapshot(url)              → screenshot + element catalog
    extract(url, template)     → structured fields from a template
    list_templates()           → user's saved templates

All tools authenticate via the user's STEALTH_SCRAPER_API_KEY env var,
which is sent to the hosted API as `Authorization: Bearer ssk_...`.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool


# ── Config ────────────────────────────────────────────────────────────────

API_KEY = os.environ.get("STEALTH_SCRAPER_API_KEY", "").strip()
BASE_URL = os.environ.get("STEALTH_SCRAPER_BASE_URL", "https://stealthscraper.dev").rstrip("/")
TIMEOUT = float(os.environ.get("STEALTH_SCRAPER_TIMEOUT", "60"))


def _ensure_configured() -> None:
    """Fail loud if API key is missing — agents shouldn't get confusing
    401s from inside a tool call."""
    if not API_KEY:
        sys.stderr.write(
            "[stealth-scraper-mcp] STEALTH_SCRAPER_API_KEY env var is not set.\n"
            "Get one at https://stealthscraper.dev/settings/api-keys and add it\n"
            "to your MCP client's `env` block. See the README for examples.\n"
        )
        sys.exit(2)


# ── HTTP client ───────────────────────────────────────────────────────────

def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=f"{BASE_URL}/api/backend",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=TIMEOUT,
    )


async def _post(path: str, body: dict[str, Any]) -> Any:
    async with _client() as client:
        res = await client.post(path, json=body)
        if res.status_code >= 400:
            raise RuntimeError(f"{res.status_code}: {res.text[:300]}")
        return res.json()


async def _get(path: str) -> Any:
    async with _client() as client:
        res = await client.get(path)
        if res.status_code >= 400:
            raise RuntimeError(f"{res.status_code}: {res.text[:300]}")
        return res.json()


# ── MCP server ────────────────────────────────────────────────────────────

server: Server = Server("stealth-scraper")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="snapshot",
            description=(
                "Load a URL in a stealth-patched headless Chromium and return a "
                "screenshot (PNG, base64) + every visible element with bbox, "
                "tag, text, CSS selector, and XPath. Use when the agent needs "
                "to *see* the page layout, e.g. for visual reasoning or to "
                "define an extraction schema. Works on Cloudflare-protected and "
                "JS-heavy sites that other scrapers fail on. Counts as 1 scrape "
                "against the user's monthly quota."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Fully-qualified URL including https://",
                    },
                    "viewport_width": {
                        "type": "integer",
                        "description": "Browser viewport width in pixels (default 1440).",
                        "default": 1440,
                    },
                    "viewport_height": {
                        "type": "integer",
                        "description": "Browser viewport height in pixels (default 900).",
                        "default": 900,
                    },
                },
                "required": ["url"],
            },
        ),
        Tool(
            name="extract",
            description=(
                "Run a structured extraction template against a URL. Returns "
                "JSON with the requested fields. Each template field has "
                "{label, selector (CSS), xpath (optional), kind: 'text'|'attr'|"
                "'list'|'html', attr (when kind='attr')}. List fields that share "
                "an ancestor are row-aligned automatically (missing cells → null). "
                "Use when the agent knows what fields it wants. Counts as 1 "
                "scrape."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Fully-qualified URL including https://",
                    },
                    "template": {
                        "type": "array",
                        "description": "List of fields to extract.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "selector": {"type": "string"},
                                "xpath": {"type": "string"},
                                "kind": {
                                    "type": "string",
                                    "enum": ["text", "attr", "list", "html"],
                                },
                                "attr": {"type": "string"},
                            },
                            "required": ["label"],
                        },
                    },
                },
                "required": ["url", "template"],
            },
        ),
        Tool(
            name="list_templates",
            description=(
                "List the user's saved extraction templates. Each template has "
                "{id, name, source_url, fields[], created_at}. Useful when the "
                "agent wants to reuse a previously-defined schema (saves the "
                "user from re-explaining the structure on every call)."
            ),
            inputSchema={"type": "object", "properties": {}},
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    try:
        if name == "snapshot":
            result = await _post(
                "/snapshot",
                {
                    "url": arguments["url"],
                    "viewport_width": arguments.get("viewport_width", 1440),
                    "viewport_height": arguments.get("viewport_height", 900),
                },
            )
            # The screenshot field is a base64 PNG — large and rarely useful for
            # text-only agents. Strip it from the default response; the agent can
            # still see element_count, viewport, page dims, and the element catalog.
            if isinstance(result, dict) and "screenshot" in result:
                shot_len = len(result["screenshot"])
                result["screenshot"] = (
                    f"<base64 PNG, {shot_len} bytes — omitted from tool response. "
                    "Call /snapshot directly via REST API if you need the image.>"
                )
            return [TextContent(type="text", text=json.dumps(result, indent=2))]

        if name == "extract":
            result = await _post(
                "/extract",
                {"url": arguments["url"], "template": arguments["template"]},
            )
            return [TextContent(type="text", text=json.dumps(result, indent=2))]

        if name == "list_templates":
            result = await _get("/templates")
            return [TextContent(type="text", text=json.dumps(result, indent=2))]

        raise RuntimeError(f"Unknown tool: {name}")
    except Exception as e:
        # Return errors as tool content rather than raising — gives the agent a
        # chance to retry / explain to the user instead of crashing the session.
        return [
            TextContent(
                type="text",
                text=json.dumps({"error": str(e), "tool": name}, indent=2),
            )
        ]


async def run() -> None:
    """Start the stdio MCP server. Blocks until the client disconnects."""
    _ensure_configured()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )
