# stealth-scraper (TypeScript / JavaScript SDK)

> SDK for [Stealth-Scraper](https://stealthscraper.dev) — structured web data extraction for AI agents, RAG pipelines, and scrapers. Cloudflare/Datadome/Akamai bypass built in.

```ts
import { Client } from "stealth-scraper";

const client = new Client();  // reads STEALTH_SCRAPER_API_KEY env

const snap = await client.snapshot("https://news.ycombinator.com");
console.log(`${snap.title} — ${snap.element_count} elements`);
```

## Install

```bash
npm install stealth-scraper
# or
pnpm add stealth-scraper
# or
bun add stealth-scraper
```

Works in Node 18+, Bun, Deno (with `npm:` specifier), and edge runtimes (Cloudflare Workers, Vercel Edge) that support the WHATWG `fetch` API.

## Get an API key

Create one at [stealthscraper.dev/settings/api-keys](https://stealthscraper.dev/settings/api-keys), then either:

```bash
export STEALTH_SCRAPER_API_KEY="ssk_..."
```

Or pass directly:

```ts
const client = new Client({ apiKey: "ssk_..." });
```

## Usage

### Snapshot — see the page

```ts
const snap = await client.snapshot("https://example.com");
// snap.screenshot     base64 PNG
// snap.elements       Array of {tag, bbox, css, xpath, text, attrs}
// snap.element_count  number
```

### Extract — structured fields

```ts
const template = [
  { label: "titles", selector: ".titleline > a", kind: "list" as const },
  { label: "scores", selector: ".score", kind: "list" as const },
  { label: "links",  selector: ".titleline > a", kind: "attr" as const, attr: "href" },
];

const result = await client.extract("https://news.ycombinator.com", template);
// result.fields.titles → string[]
// result.fields.links  → string[]
// result.errors        → {} when all selectors matched
```

### Batch — many URLs, one template

```ts
const urls = ["https://example.com/1", "https://example.com/2"];
const bundle = await client.batch(urls, template);
for (const entry of bundle.results) {
  console.log(entry.url, entry.data.fields);
}
```

### Templates — save + reuse

```ts
const created = await client.templates.create({
  name: "HN frontpage",
  source_url: "https://news.ycombinator.com",
  fields: template,
});

const all = await client.templates.list();
const one = await client.templates.get(created.id);
await client.templates.delete(created.id);
```

## Error handling

All 4xx/5xx responses throw `StealthScraperError`:

```ts
import { Client, StealthScraperError } from "stealth-scraper";

try {
  await client.snapshot("https://nope.example");
} catch (err) {
  if (err instanceof StealthScraperError) {
    if (err.statusCode === 403 && err.detail.includes("Plan limit")) {
      console.log("Upgrade at https://stealthscraper.dev/pricing");
    }
  } else {
    throw err;
  }
}
```

## Configuration

| Option | Env var | Default |
|---|---|---|
| `apiKey` | `STEALTH_SCRAPER_API_KEY` | *(required)* |
| `baseUrl` | `STEALTH_SCRAPER_BASE_URL` | `https://stealthscraper.dev` |
| `timeoutMs` | `STEALTH_SCRAPER_TIMEOUT_MS` | `60000` |

## Related

- [stealth-scraper-mcp](https://github.com/Rusheesonu/stealth-scraper-mcp) — MCP server (Claude Desktop / Cursor / Cline integration)
- [stealth-scraper (Python)](https://github.com/Rusheesonu/stealth-scraper-python) — Python SDK
- [stealth-browser](https://github.com/Rusheesonu/stealth-browser) — underlying OSS Chromium wrapper

## License

MIT
