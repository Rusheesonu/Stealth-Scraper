# @stealth-scraper/mcp

Model Context Protocol (MCP) server for [Stealth Scraper](https://stealthscraper.dev). Plugs the anti-bot-resistant web scraping API directly into Claude Desktop, Cursor, Cline, and any other MCP-aware agent.

> **Status:** beta. Public API is stable; we follow semver from `1.0.0` onward.

## What it does

Exposes four tools to the agent:

| Tool                 | What it does                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `scrape_url`         | Stealth-scrape a URL, with optional natural-language hints about what to extract. |
| `extract_structured` | Run a one-shot extract with an inline schema (list of fields + CSS selectors). |
| `list_templates`     | List the user's saved extraction recipes.                                     |
| `run_template`       | Run a saved template against a target URL.                                    |

## Claude Desktop setup

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "stealth-scraper": {
      "command": "npx",
      "args": ["@stealth-scraper/mcp"],
      "env": {
        "STEALTH_SCRAPER_API_KEY": "ssk_..."
      }
    }
  }
}
```

Restart Claude Desktop. You should see a hammer/tools icon in the input area listing the four tools.

## Cursor / Cline / generic stdio

Any client that supports an MCP stdio server can use:

```jsonc
{
  "command": "npx",
  "args": ["@stealth-scraper/mcp"],
  "env": { "STEALTH_SCRAPER_API_KEY": "ssk_..." }
}
```

For a custom backend (self-hosted), also set `STEALTH_SCRAPER_BASE_URL=https://your-host`.

## Example agent prompts

> Use stealth-scraper to grab the top 20 stories from Hacker News with titles, scores, and links.

> List my saved scraper templates, then run the "Amazon product price" one against `https://www.amazon.com/dp/B08N5WRWNW`.

## Local install

```bash
npm install -g @stealth-scraper/mcp
stealth-scraper-mcp     # runs the server on stdio
```

## Development

```bash
npm install
npm run build           # produces dist/index.js (the bin)
STEALTH_SCRAPER_API_KEY=ssk_test node dist/index.js
```

Smoke test against the local backend with an MCP inspector:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## RUN THIS TO PUBLISH

```bash
npm install
npm run build
npm publish --access public   # under the @stealth-scraper org
```

> First-time only: create the npm org at `https://www.npmjs.com/org/create` with name `stealth-scraper`.

## License

MIT
