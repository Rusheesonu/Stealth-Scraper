# Stealth-Scraper

**The reliable web-data layer for AI agents.**

Most AI agents fail in production because the modern web doesn't want
to be scraped. Cloudflare, DataDome, PerimeterX, Akamai, Kasada and
Imperva now gate **~40% of valuable sites**, and the open-source
scrapers your agent imports today don't get past any of them.

Stealth-Scraper is a hosted API + visual picker that handles the
anti-bot fight so your agent doesn't have to. One endpoint, JSON out,
schemas it figures out for you.

- **Hosted**: [**stealthscraper.dev**](https://stealthscraper.dev) — paste a URL, point at the fields you want, get a re-runnable recipe + API key. Free tier, no card.
- **API**: `api.stealthscraper.dev` · MCP server · Python SDK · TypeScript SDK
- **Open source**: [`stealth-browser`](https://github.com/Rusheesonu/stealth-browser) — the engine layer, MIT-licensed, useable standalone.
- **Status**: [status.stealthscraper.dev](https://status.stealthscraper.dev)

---

## What you actually get

```python
# Install from source until v1 hits PyPI (coming soon):
# pip install git+https://github.com/Rusheesonu/Stealth-Scraper.git#subdirectory=sdks/python

from stealth_scraper import StealthClient

client = StealthClient(api_key="ssk_...")

# 1. Snapshot any URL — handles the anti-bot fight automatically.
snap = client.snapshot("https://www.crunchbase.com/")

# 2. Or describe what you want in plain English — we generate the schema.
data = client.assist_extract(
    url="https://news.ycombinator.com/",
    description="get me top 20 stories: title, points, comments, link",
)
# → data.template = [...], data.fields = {...}

# 3. Save the recipe (via the dashboard or `POST /templates`), then re-run it.
result = client.run_template(template_id="t_hn_frontpage", url="https://news.ycombinator.com/")
```

TypeScript/JS:

```bash
# Install from source until v1 hits npm (coming soon):
npm install github:Rusheesonu/Stealth-Scraper#path:sdks/typescript
```

```ts
import { StealthClient } from 'stealth-scraper';
const client = new StealthClient({ apiKey: 'ssk_...' });
const snap = await client.snapshot('https://news.ycombinator.com/');
```

For AI agents that need real-time tool use:

```bash
# MCP server — sources: sdks/mcp/. Until we publish to npm, install from
# the cloned repo:  git clone … && cd sdks/mcp && npm install && npm run build
# Then point Claude Desktop / Cursor at: node /absolute/path/to/sdks/mcp/dist/index.js
node ./sdks/mcp/dist/index.js
# → adds `scrape_url`, `extract_structured`, `list_templates`, `run_template`
#   tools to Claude Desktop / Cursor / Cline / etc.
```

---

## How the engine actually works

Most "stealth scrapers" ship one browser-automation library and call
it stealth. They lose to vendors that have IP-reputation, behavioral
biometrics, or Chromium-specific runtime sensors. Our thesis: **no
single engine wins everywhere**, so we route per-target.

```
                ┌─────────────────────────────────────────┐
                │  EngineRouter (capability + history)    │
                └─────────────────────────────────────────┘
                       │            │            │
              ┌────────▼─┐  ┌───────▼──┐  ┌──────▼───────┐
              │ nodriver │  │curl_cffi │  │   camoufox   │
              │ (Chromium│  │ (TLS-imp-│  │ (Firefox,    │
              │  via CDP)│  │ ersonate)│  │  patched)    │
              └──────────┘  └──────────┘  └──────────────┘
                JS+screenshot   no-JS,         beats creepjs,
                CF Turnstile    50-100x        Kasada,
                                faster on      PerimeterX
                                static HTML
```

The router picks per-request by:
1. **Capability filter** — drop engines that can't satisfy the requirements
   (e.g. needs JS → drop `curl_cffi`)
2. **Vendor affinity** — known-good engine order per anti-bot vendor
3. **Per-host learning** — engine that succeeded on this host before
   floats to the head (persisted on-disk)
4. **Cost ascending** — among ties, pick cheapest (`curl_cffi` is free,
   `camoufox` is ~2× `nodriver`)
5. **Escalate on failure** — if engine A returns `EngineFailedError`,
   try engine B, then C. Up to 3 escalations per request.

Each engine has a documented honest capability set (`engines/base.py`):
TLS impersonation, JS execution, CDP-native, behavioral simulation,
Firefox engine, lightweight, etc. The router treats them as
interchangeable except for what they advertise.

---

## Bench numbers (honest)

Bench harness in `bench/` runs three benchmarks against real production
URLs. Numbers come from `bench/results/*.json` — never fabricated.

| Benchmark | Result | Target | Notes |
|---|---|---|---|
| **Antibot bypass** (18 URLs, 7 vendors) | **83.3%** | ≥95% | Last 3 fails are IP-reputation-bound (g2.com, hyatt.com, crunchbase/discover) — unlocked by residential proxy plan. |
| **Fingerprint fidelity** (9 detection sites) | **0 fails** / 5 pass / 4 unknown | clean across creepjs + sannysoft + browserleaks + fingerprint.com | Engine work is done; the 4 "unknowns" are LLM-judge text-parsing gaps, not engine fails. |
| **Throughput** (30 URLs, mixed difficulty) | **90% at 4,744 pages/\$** | ≥95% / ≥2,000 pages/\$ | pages/\$ already **2.4× the target**. |

Vendor-specific (antibot, full prod stack):

| Vendor | Pass rate | Engine that wins |
|---|---|---|
| Cloudflare (basic) | 2/3 | `nodriver` |
| Cloudflare Turnstile | 2/2 | `camoufox` (Firefox sidesteps Chromium runtime sensors) |
| DataDome | 3/3 | `curl_cffi` + `camoufox` (TLS-fingerprint heavy) |
| Akamai Bot Manager | 3/3 | `curl_cffi` first, browser fallback |
| Kasada | 2/2 | `camoufox` (canonical Kasada bypass) |
| PerimeterX | 1/2 | `camoufox` for glassdoor; zillow needs CAPTCHA solver |
| Imperva | 1/2 | hyatt needs residential proxy |

The bench plateaus at the documented [paid-infra ceiling](bench/setup_needed.md):
residential proxies (~$5/run) unlock 3 more URLs to 94.4%, a PX
CAPTCHA solver ($1-2/zillow scrape) unlocks the last to 100%.

Run yourself:

```bash
python -m bench.antibot       # 18 URLs, ~4min
python -m bench.fingerprint   # 9 detection sites, LLM-judged verdicts
python -m bench.throughput    # 30 URLs, pages/$ + engine mix
```

---

## What's included

| Layer | What |
|---|---|
| **Visual picker** | Paste URL → live screenshot → click fields you want. Smart selectors (drag-select for split-spans, auto-sibling detection by visual column, parent-select escape hatch). |
| **AI assist** | Describe what you want in English. Groq Llama-3.3-70b picks selectors from the rendered DOM. Falls back to visual picker if uncertain. |
| **Multi-engine router** | `nodriver` + `curl_cffi` + `camoufox`. Auto-routes per vendor. Escalates on failure. Learns per-host. |
| **Output formats** | JSON, CSV, Markdown, PDF. Row-aligned extraction (missing fields → `null`, lists stay same length). |
| **Pagination** | Auto-follow next-page links. Configurable max pages. |
| **Browser actions** | Pre-snapshot click/scroll/fill (dismiss banners, log in, trigger lazy content). |
| **Scheduled scrapes** | Cron-like scheduling per template. Webhook delivery on completion. |
| **Batch mode** | Newline list of URLs → JSON/CSV bundle. |
| **Recipe marketplace** | Publish + clone public templates. |
| **API + SDKs** | REST + Python (`sdks/python/` — install from git, PyPI release coming) + TypeScript (`sdks/typescript/` — install from git, npm release coming) + MCP server (`sdks/mcp/` — build locally + point Claude Desktop at the binary). |
| **Usage dashboard** | Monthly scrapes vs plan limit, success rate, average latency. |

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16 · React 19 · Tailwind v4 · framer-motion · Apple-minimal design |
| Backend | FastAPI · Python 3.12 · `nodriver` (Chromium via CDP) · `camoufox` (Firefox) · `curl_cffi` (TLS impersonation) · `lxml` |
| Storage | Supabase Postgres (us-east-1) · S3-compatible blob for snapshots |
| Auth | Supabase Auth (Google / GitHub / email) |
| Billing | Lemon Squeezy webhooks |
| LLM | Groq (Llama-3.3-70b primary, Llama-3.1-8b fallback) |
| Host | AWS Lightsail Virginia (backend) · Vercel (frontend) |
| CI | GitHub Actions: pytest backend, lint+build frontend |
| Proxies | Webshare datacenter pool (default) · Bright Data / Oxylabs residential (env-gated, optional) |

---

## Self-host quickstart

You don't need our hosted product to use the engine — the [`stealth-browser`](https://github.com/Rusheesonu/stealth-browser)
package (MIT) gives you the full multi-engine router as a standalone
library.

```bash
pip install stealth-browser
```

```python
import asyncio
from stealth_browser.engines import router, Requirements

async def main():
    snap, decision = await router.snapshot(
        "https://news.ycombinator.com/",
        requirements=Requirements(needs_js=True, vendor_hint="cloudflare"),
    )
    print(f"engine: {snap.engine_name}, elements: {len(snap.elements)}")
    print(f"router reason: {decision.reason}")

asyncio.run(main())
```

To run the whole product locally (visual picker, API, AI assist):

```bash
# Requirements: Python 3.12+, Node 20+, Google Chrome installed,
#               Supabase project (free tier OK), Groq API key.

git clone https://github.com/Rusheesonu/Stealth-Scraper
cd Stealth-Scraper

# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in Supabase + Groq keys
python run.py          # http://localhost:8000

# Frontend (new terminal)
cd ../frontend
cp .env.local.example .env.local
npm install && npm run dev   # http://localhost:3000
```

`camoufox` will download a patched-Firefox binary (~350MB) into your
user cache on first use. `nodriver` uses your installed Chrome.

---

## Repo layout

```
Stealth-Scraper/
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI app + 30 routes
│   │   ├── engines/           Multi-engine router
│   │   │   ├── base.py        Engine Protocol + Capability flags + Requirements
│   │   │   ├── router.py      Decision logic + SuccessTracker (per-host learning)
│   │   │   ├── nodriver_engine.py    Chromium via patched CDP
│   │   │   ├── curl_cffi_engine.py   TLS-impersonating HTTP
│   │   │   └── camoufox_engine.py    Patched Firefox
│   │   ├── snapshot.py        URL → screenshot + bbox catalog
│   │   ├── extract.py         Template → structured data (row-aligned)
│   │   ├── assist.py          AI-assisted schema generation (Groq)
│   │   ├── actions.py         Pre-snapshot click/scroll/fill
│   │   ├── proxies.py         Datacenter + residential pool selectors
│   │   ├── safety.py          robots.txt + per-host rate limit
│   │   └── detect.py          Anti-bot wall signature library
│   ├── tests/                 pytest
│   └── Dockerfile
│
├── frontend/                  Next.js 16 + Tailwind v4 (Apple-minimal)
│
├── bench/
│   ├── antibot.py             Per-vendor bypass rate
│   ├── fingerprint.py         Detection-site verdicts (LLM-judged)
│   ├── throughput.py          pages/$ on a fixed URL pool
│   ├── lib.py                 Shared scrape_one through the router
│   ├── llm_judge.py           Groq-based universal verdict reader
│   ├── lists/                 URL pools per benchmark
│   ├── results/               Timestamped JSON reports
│   └── setup_needed.md        Paid-infra integration plan
│
├── oss/stealth-browser/       Separate git repo — the OSS engine package
├── sdks/
│   ├── python/                stealth-scraper PyPI package (sync + async)
│   ├── typescript/            stealth-scraper npm package (ESM + CJS)
│   └── mcp/                   @stealth-scraper/mcp — MCP server for Claude Desktop
├── deploy/aws-lightsail/      Docker + Caddy + setup/update scripts
├── docs/                      ARCHITECTURE.md, DEPLOY.md
├── legacy/                    Original v1 Flask + XPath app (preserved)
├── AUDIT.md                   Current architecture vs SOTA
├── LICENSES.md                Dep license audit
└── LOOP_LOG.md                Iteration log (Phase 0 → present)
```

---

## API reference (short)

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/snapshot` | `{ url, viewport_*, actions? }` | `{ screenshot, elements[], viewport, page }` |
| `POST` | `/extract` | `{ url, template[] }` | `{ fields, errors }` (row-aligned for shared-ancestor lists) |
| `POST` | `/extract/batch` | `{ urls[], template_id }` | `{ count, results[] }` |
| `POST` | `/assist/template` | `{ url, description }` | generated template |
| `GET`  | `/templates` · `POST` `/templates` · CRUD | — | template store |
| `POST` | `/schedules` | `{ template_id, cron, webhook_url? }` | scheduled job |
| `GET`  | `/status` | — | uptime, engine state, LLM chain health |

Full OpenAPI at [`api.stealthscraper.dev/docs`](https://api.stealthscraper.dev/docs).

---

## Pricing (hosted)

| Plan | Scrapes/mo | Concurrent | API access | Price |
|---|---|---|---|---|
| Free | 100 | 1 | ✓ | $0 |
| Hobby | 5,000 | 3 | ✓ | $19/mo |
| Pro | 50,000 | 10 | ✓ + webhook | $79/mo |
| Scale | 500,000 | 25 | ✓ + dedicated proxies | $299/mo |

[Compare plans →](https://stealthscraper.dev/pricing)

---

## Open source

| Repo | What | License |
|---|---|---|
| [**Rusheesonu/Stealth-Scraper**](https://github.com/Rusheesonu/Stealth-Scraper) (this) | Full product: backend + frontend + bench. Useful if you want to self-host the whole thing. | MIT |
| [**Rusheesonu/stealth-browser**](https://github.com/Rusheesonu/stealth-browser) | Just the engine layer (router + nodriver + curl_cffi + camoufox). Drop into any Python project. | MIT |

Both repos use [`nodriver`](https://github.com/ultrafunkamsterdam/nodriver) (AGPL-3.0 — see [LICENSES.md](LICENSES.md) for full dep audit and our AGPL §13 compliance).

---

## Roadmap

**Shipped** ✓
- [x] Visual picker (drag-select, auto-sibling, parent-escape)
- [x] AI-assisted schema generation
- [x] Multi-engine router (nodriver + curl_cffi + camoufox)
- [x] Per-host engine learning + escalation
- [x] Python + TypeScript SDKs
- [x] MCP server for AI agents
- [x] Pagination auto-follow
- [x] Browser actions (click/scroll/fill)
- [x] Scheduled scrapes + webhooks
- [x] MD/PDF output modes
- [x] Recipe marketplace
- [x] Usage dashboard
- [x] Bench harness (antibot + fingerprint + throughput)
- [x] Residential proxy hook (env-gated, drop-in)
- [x] robots.txt + per-host rate limiter

**Up next**
- [ ] Bright Data Web Unlocker integration → 95%+ antibot
- [ ] CAPTCHA solver (CapSolver/2captcha) for PerimeterX press-and-hold
- [ ] Tiered LLM judge (8b first-pass + 70b verify) to push fingerprint bench past free-tier TPM cap
- [ ] Team seats — actual multi-user workspace
- [ ] BYOK — let users bring their own LLM provider + key
- [ ] White-label embeddable picker
- [ ] CI auto-deploy on push to master (currently manual `ssh stealth + update.sh`)
- [ ] Production cut-over: wire main.py's scrape endpoints through the router (currently router is bench-only; production still calls `take_snapshot` direct)

---

## Contributing

Bench-first. Numbers are the only truth. If you have an idea, run the
bench against current main first, ship your change, and re-run. Commit
message includes the delta:

```
fix(camoufox): tune humanize for PerimeterX
antibot 77.8% → 81.4% (+3.6pp), perimeterx 0/3 → 1/3
```

Reverts welcome. We revert anything that regresses a bench number even
if the change looks "obviously right." See [`LOOP_LOG.md`](LOOP_LOG.md)
for the iter-by-iter history (Phase 0 audit → present).

---

## License

MIT — see [LICENSE](LICENSE).

Built solo by [@rushikeshsonu](https://x.com/rushikeshsonu).
Reach me with questions, paid integrations, or hire me to scrape your
target — `rushikeshsonu@gmail.com`.
