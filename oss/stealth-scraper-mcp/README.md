# stealth-scraper-mcp

> MCP server for [Stealth-Scraper](https://stealthscraper.dev) — give Claude Desktop, Cursor, Cline, and any MCP-aware AI agent direct access to structured web data extraction with anti-bot bypass.

Lets your agent do this in a single tool call:

> *"Pull the top 30 launches from Product Hunt today and rank them by upvotes."*

Without you having to write scraping code, deal with Cloudflare, or LLM-parse messy markdown.

## What this gives your agent

Three tools, exposed via the Model Context Protocol:

| Tool | What it does |
|---|---|
| `snapshot(url)` | Loads a URL in a stealth-patched headless Chromium, returns a screenshot + every visible element with bbox + selector. Use this when the agent needs to *see* the page. |
| `extract(url, template)` | Runs a saved schema against a URL → returns structured JSON. Use when the agent already knows what fields it wants. |
| `list_templates()` | Lists schemas the user has previously saved in their Stealth-Scraper account. |

All three pass through the hosted Stealth-Scraper API, which means: residential proxy rotation, CDP-level stealth, plan-tier metering — none of which the agent has to think about.

## Install

```bash
pip install stealth-scraper-mcp
```

Requires Python 3.11+. Get your API key at [stealthscraper.dev/settings/api-keys](https://stealthscraper.dev/settings/api-keys) (free tier includes 50 scrapes/month).

## Setup — Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "stealth-scraper": {
      "command": "stealth-scraper-mcp",
      "env": {
        "STEALTH_SCRAPER_API_KEY": "ssk_..."
      }
    }
  }
}
```

Restart Claude Desktop. Type "scrape news.ycombinator.com" and Claude will offer to use the tool.

## Setup — Cursor

Cursor → Settings → Features → MCP → **Add new MCP server**:

```
Name:     stealth-scraper
Command:  stealth-scraper-mcp
Env:      STEALTH_SCRAPER_API_KEY=ssk_...
```

## Setup — Cline (VSCode extension)

Cline → settings → MCP Servers → **Edit MCP Settings**:

```json
{
  "mcpServers": {
    "stealth-scraper": {
      "command": "stealth-scraper-mcp",
      "env": {
        "STEALTH_SCRAPER_API_KEY": "ssk_..."
      }
    }
  }
}
```

## Setup — any other MCP-aware client

Stdio transport, command `stealth-scraper-mcp`, env var `STEALTH_SCRAPER_API_KEY` set to your key.

## Configuration

| Env var | Default | Notes |
|---|---|---|
| `STEALTH_SCRAPER_API_KEY` | *(required)* | Your `ssk_...` key. Create at [stealthscraper.dev/settings/api-keys](https://stealthscraper.dev/settings/api-keys). |
| `STEALTH_SCRAPER_BASE_URL` | `https://stealthscraper.dev` | Override for self-hosted / staging. |
| `STEALTH_SCRAPER_TIMEOUT` | `60` | HTTP timeout in seconds. Snapshots on hard sites can take 20-30s. |

## Use cases for agents

- **Research agents** pull current data from any site, even Cloudflare-protected ones, without writing scraping code
- **Lead enrichment** for sales agents — scrape company sites for pricing/team/about pages
- **Competitive monitoring** — agent scrapes competitor pricing pages daily, flags changes
- **RAG ingestion** — pull a structured schema from any URL, drop straight into your vector DB
- **AI workflows** — combine with Claude's tool-use loop to scrape → reason → act

## Quotas + pricing

Free tier: 50 scrapes/month. [Paid plans](https://stealthscraper.dev/pricing) start at $29/month for 1,000 scrapes (includes hard-site access). Soft Cloudflare and standard sites work on the free tier.

## License

MIT. See [LICENSE](LICENSE).

## Related

- [stealthscraper.dev](https://stealthscraper.dev) — hosted SaaS (visual picker, saved templates, billing)
- [stealth-browser](https://github.com/Rusheesonu/stealth-browser) — the underlying open-source Chromium wrapper (Python library, no API needed)
