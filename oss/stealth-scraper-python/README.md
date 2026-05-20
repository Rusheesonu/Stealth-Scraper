# stealth-scraper

> Async Python SDK for [Stealth-Scraper](https://stealthscraper.dev) — structured web data extraction for AI agents, RAG pipelines, and scrapers. Cloudflare/Datadome/Akamai bypass built in.

```python
import asyncio
from stealth_scraper import Client

async def main():
    async with Client() as client:
        snap = await client.snapshot("https://news.ycombinator.com")
        print(f"{snap['title']} — {snap['element_count']} elements")

asyncio.run(main())
```

## Install

```bash
pip install stealth-scraper
```

## Get an API key

[stealthscraper.dev/settings/api-keys](https://stealthscraper.dev/settings/api-keys) → Create key. Set it either as an env var:

```bash
export STEALTH_SCRAPER_API_KEY="ssk_..."
```

Or pass directly:

```python
client = Client(api_key="ssk_...")
```

## Usage

### Snapshot — see the page

Returns a base64 PNG screenshot + every visible element with bbox + CSS selector.

```python
async with Client() as client:
    snap = await client.snapshot("https://example.com")
    # snap["screenshot"]   → base64 PNG
    # snap["elements"]     → [{tag, bbox, css, xpath, text, attrs}, ...]
    # snap["page"]         → {width, height}
```

### Extract — structured fields from a template

```python
template = [
    {"label": "title",  "selector": ".titleline > a", "kind": "text"},
    {"label": "score",  "selector": ".score",         "kind": "list"},
    {"label": "links",  "selector": ".titleline > a", "kind": "attr", "attr": "href"},
]

async with Client() as client:
    result = await client.extract("https://news.ycombinator.com", template)
    # result["fields"]    → {"title": "...", "score": ["10 points", ...], "links": [...]}
    # result["errors"]    → {} when all selectors matched
```

List fields with a shared ancestor are auto row-aligned (missing cells become `None` so lists stay the same length).

### Batch — one template, many URLs

```python
urls = ["https://example.com/1", "https://example.com/2", "https://example.com/3"]
async with Client() as client:
    bundle = await client.batch(urls, template)
    for entry in bundle["results"]:
        print(entry["url"], entry["data"]["fields"])
```

Counts as N scrapes against your monthly quota.

### Templates — save + reuse extraction schemas

```python
async with Client() as client:
    tpl = await client.templates.create(
        name="HN frontpage",
        source_url="https://news.ycombinator.com",
        fields=template,
    )

    saved = await client.templates.list()
    one   = await client.templates.get(tpl["id"])
    await client.templates.delete(tpl["id"])
```

## Errors

The client raises `StealthScraperError` on any 4xx/5xx response. The exception carries `.status_code`, `.detail`, and `.body` for debugging.

```python
from stealth_scraper import Client, StealthScraperError

try:
    await client.snapshot("https://nope")
except StealthScraperError as e:
    if e.status_code == 403 and "Plan limit" in e.detail:
        print("Upgrade at https://stealthscraper.dev/pricing")
    else:
        raise
```

## Configuration

| Constructor arg | Env var | Default | Notes |
|---|---|---|---|
| `api_key` | `STEALTH_SCRAPER_API_KEY` | *(required)* | Bearer token, `ssk_...` |
| `base_url` | `STEALTH_SCRAPER_BASE_URL` | `https://stealthscraper.dev` | Override for self-hosted |
| `timeout` | `STEALTH_SCRAPER_TIMEOUT` | `60.0` | HTTP timeout (seconds) |

## Related

- [stealth-scraper-mcp](https://github.com/Rusheesonu/stealth-scraper-mcp) — MCP server so Claude Desktop / Cursor / Cline can call this directly
- [stealth-browser](https://github.com/Rusheesonu/stealth-browser) — the underlying open-source Chromium wrapper if you'd rather self-host

## License

MIT
