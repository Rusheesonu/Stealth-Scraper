# stealth-scraper (TypeScript / JavaScript)

Official TypeScript/JavaScript SDK for [Stealth Scraper](https://stealthscraper.dev) — the anti-bot-resistant web scraping API.

> **Status:** beta — npm release coming with the Product Hunt launch
> (June 1, 2026). Until then, install from git (works today).

## Install

```bash
# During beta — install directly from GitHub:
npm install github:Rusheesonu/Stealth-Scraper#path:sdks/typescript

# After June 1 npm release:
npm install stealth-scraper
# or pnpm add stealth-scraper
# or yarn add stealth-scraper
```

## Quickstart

```ts
import { StealthClient } from 'stealth-scraper';

const client = new StealthClient({ apiKey: 'ssk_...' }); // or set STEALTH_SCRAPER_API_KEY

// Stealth snapshot
const snap = await client.snapshot('https://news.ycombinator.com/');
console.log(snap.title, snap.elementCount);

// Run a saved template
const result = await client.extract({
  url: 'https://news.ycombinator.com/',
  templateId: 't_xxx',
});
console.log(result.fields);

// AI-assisted one-shot extraction
const data = await client.assistExtract({
  url: 'https://news.ycombinator.com/',
  description: 'get the top 20 story titles, scores, and links',
});
console.log(data.template, data.fields);
```

### Streaming snapshots

```ts
for await (const ev of client.snapshotStream({ url: 'https://heavy.example' })) {
  console.log(ev.event, ev.progress, ev.message);
  if (ev.event === 'done' && ev.result) console.log(ev.result.title);
}
```

## Features

- **Typed result + error objects** — `SnapshotResult`, `ExtractResult`, `AntiBotBlockError(vendor)`, `PlanLimitError(used, limit, upgradeUrl)`, `OverloadedError(retryAfterS)`, `RateLimitError`, `AuthError`.
- **Automatic idempotency keys** — every mutating call sends an `Idempotency-Key` header. Safe to retry.
- **Cost preview** — `client.estimate({ url, schema })` returns expected credits before you spend them.
- **Streaming snapshots** — `for await (const ev of client.snapshotStream(...))`.
- **Zero runtime deps** — uses the platform `fetch`. Works in Node 18+, Deno, Bun, and modern browsers (with an appropriate CORS config).
- **Dual ESM + CJS build** — `import { StealthClient } from 'stealth-scraper'` and `const { StealthClient } = require('stealth-scraper')` both work.

## Error handling

```ts
import {
  StealthClient,
  AntiBotBlockError,
  RateLimitError,
  PlanLimitError,
} from 'stealth-scraper';

try {
  await client.snapshot('https://www.cloudflare-protected.example');
} catch (e) {
  if (e instanceof AntiBotBlockError) {
    console.error(`blocked by ${e.vendor}: ${e.suggestion}`);
  } else if (e instanceof RateLimitError) {
    console.error(`slow down, retry in ${e.retryAfterS}s`);
  } else if (e instanceof PlanLimitError) {
    console.error(`used ${e.used}/${e.limit} — upgrade at ${e.upgradeUrl}`);
  }
}
```

## Configuration

| Option       | Env var                    | Default                          |
| ------------ | -------------------------- | -------------------------------- |
| `apiKey`     | `STEALTH_SCRAPER_API_KEY`  | required                         |
| `baseUrl`    | —                          | `https://api.stealthscraper.dev` |
| `timeoutMs`  | —                          | 120000                           |
| `fetch`      | —                          | global `fetch`                   |

## Development

```bash
npm install
npm run build           # produces dist/{index.js,index.cjs,index.d.ts}
npm test
```

## RUN THIS TO PUBLISH

```bash
npm install
npm run build
npm publish --access public   # logged in as the package owner
```

## License

MIT
