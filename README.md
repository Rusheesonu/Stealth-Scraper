# Stealth-Scraper

**A visual, point-and-click web scraper. No XPath, no config files.**

### 🔗 Live demo: **[stealth-scraper.vercel.app](https://stealth-scraper.vercel.app)**

Paste a URL. Get a screenshot. Click the fields you want — *title, price,
image, whatever* — and we generate a reusable scraping recipe you can run on
any matching page.

> *First load may take 15-20s* — the backend sleeps on idle (free tier) and
> has to wake Chrome. Subsequent requests are fast.

```
┌──────────────────────────────┐      ┌──────────────────┐
│  URL                         │ ──▶  │  Snapshot + live │
│  https://news.ycombinator…   │      │  hover overlay   │
└──────────────────────────────┘      └──────────────────┘
                                             │  click
                                             ▼
                                      ┌──────────────────┐
                                      │ Label the field  │
                                      │ (title / price / │
                                      │  image / …)      │
                                      └──────────────────┘
                                             │
                                             ▼
                                      ┌──────────────────┐
                                      │  JSON / CSV out  │
                                      │  +  Save recipe  │
                                      │  +  Rerun later  │
                                      └──────────────────┘
```

---

## Why

Most scraping tools assume you know XPath. That's a wall for anyone who isn't
a dev. This flips the model: the user sees *exactly* what the page looks like,
hovers to highlight, clicks to extract. The recipe is saved, so the next URL
with the same structure is a one-click rerun.

Under the hood it's still Playwright + CSS/XPath selectors — but the user
never types one.

---

## Stack

| Layer | What |
|-------|------|
| Frontend | Next.js 16 App Router · React 19 · Tailwind v4 · lucide-react · framer-motion |
| Backend | FastAPI · **nodriver** (stealth-patched Chromium via CDP) · lxml · aiosqlite |
| Storage | SQLite (zero config, no external DB) |
| CI | GitHub Actions — pytest on backend, lint + build on frontend |

**Why nodriver instead of Playwright?** nodriver patches Chromium at the
flag/CDP level to close automation leaks that Playwright+stealth-JS can't
reach — `navigator.webdriver`, CDP-injected runtime markers, the
`Runtime.evaluate` leak. Passes soft Cloudflare and Turnstile invisible
mode out of the box, even without residential proxies. Then
`app/stealth.py` layers an `addScriptToEvaluateOnNewDocument` init patch
on top (WebGL vendor, chrome.runtime, plugins, permissions, screen dims,
hardware spoof) to close the remaining JS-land fingerprint leaks.

---

## Quickstart

### Requirements
- **Python 3.11 – 3.13** (3.12 recommended). Python 3.14 is technically supported
  but some native-dep packages (`nodriver`, `pydantic-core`) need workarounds there —
  see [troubleshooting](#troubleshooting).
- **Node 20+**
- **Google Chrome** (or Chromium) installed locally — nodriver drives your real
  Chrome binary for better stealth. macOS: `brew install --cask google-chrome`.

### Backend (terminal 1)

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python run.py
```

Backend on `http://localhost:8000`. Interactive API docs at `/docs`.

### Frontend (terminal 2)

```bash
cd frontend
cp .env.local.example .env.local     # edit if backend isn't on :8000
npm install
npm run dev
```

Open `http://localhost:3000`.

---

## The core loop

1. **Snapshot** — `POST /snapshot { url }` loads the page in a headless
   browser with lightweight stealth defaults, scrolls once to trigger lazy
   images, screenshots the full page, and walks the DOM to collect every
   visible element: `{ tag, bbox, xpath, css, text, attrs }`.
2. **Pick** — the frontend renders the PNG and overlays the bounding boxes.
   Hovering highlights the *innermost* hit (so overlapping containers don't
   swallow clicks). Clicking opens a label modal: give it a name, choose
   Text / Attribute (href, src, …) / List (all matches).
3. **Save** — your picks become a **template**: a JSON array of
   `{ label, selector, xpath, kind, attr }` rows, stored in SQLite.
4. **Extract** — `POST /extract { url, template }` runs the template against
   any URL. Returns `{ fields: {...}, errors: {...} }`. Frontend offers Copy
   JSON, Download JSON, Download CSV (with a smart all-lists pivot so catalog
   pages export as rows).

---

## Repo layout

```
Stealth-Scraper/
├── backend/
│   ├── app/
│   │   ├── main.py          FastAPI app + routes
│   │   ├── browser.py       Shared Playwright browser pool
│   │   ├── snapshot.py      URL → screenshot + element catalog
│   │   ├── extract_js.py    In-page JS to collect elements + selectors
│   │   ├── extract.py       Run a template against a URL
│   │   └── db.py            Template SQLite store
│   ├── tests/               pytest — CRUD + API smoke
│   ├── requirements.txt
│   └── run.py
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx         Landing
│   │   ├── pick/            Picker (client)
│   │   └── templates/       Saved recipes
│   ├── components/
│   │   ├── picker/          SnapshotCanvas, LabelModal, FieldSidebar, ResultsPanel
│   │   └── ui/              Button, Input, Badge
│   └── lib/                 api client, utils
│
├── legacy/                  Previous v1 Flask app (preserved; not wired)
├── .github/workflows/       CI
└── docs/
```

---

## API reference (short version)

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/snapshot` | `{ url, viewport_width?, viewport_height? }` | `{ screenshot (b64 PNG), elements[], viewport, page }` |
| `POST` | `/extract` | `{ url, template[] }` | `{ fields: {...}, errors: {...} }` |
| `GET`  | `/templates` | — | `[{ id, name, source_url, fields[] }]` |
| `POST` | `/templates` | `{ name, source_url, fields[] }` | created template |
| `GET`  | `/templates/{id}` | — | template |
| `PUT`  | `/templates/{id}` | partial update | updated template |
| `DELETE` | `/templates/{id}` | — | 204 |
| `GET`  | `/health` | — | `{ status, browser }` |

Full OpenAPI at `http://localhost:8000/docs`.

### Template field shape

```ts
{
  label: string,
  selector: string,       // CSS
  xpath?: string,         // XPath fallback when CSS misses
  kind: "text" | "attr" | "list" | "html",
  attr?: string           // required when kind="attr"
}
```

---

## Example — scraping HN frontpage

```bash
# 1. Snapshot the page
curl -s -X POST http://localhost:8000/snapshot \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://news.ycombinator.com"}' \
  | jq '.title, .element_count'
# "Hacker News"
# 247

# 2. Extract with a hand-rolled template (the UI makes this clickable)
curl -s -X POST http://localhost:8000/extract \
  -H 'Content-Type: application/json' \
  -d '{
    "url":"https://news.ycombinator.com",
    "template":[
      {"label":"titles","selector":".titleline > a","kind":"list"},
      {"label":"points","selector":".score","kind":"list"}
    ]
  }' | jq '.fields.titles[0:3]'
# ["Show HN: ...", "Ask HN: ...", "..."]
```

---

## Deploy (free, no credit card)

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for a 10-minute click-by-click:
Hugging Face Spaces for the backend (16GB RAM free, Docker), Vercel for the
frontend. End-state: a public URL you can drop on your resume.

---

## Troubleshooting

### `SyntaxError: Non-UTF-8 code ... in nodriver/cdp/network.py`
Known nodriver packaging bug on Python 3.14 (the file contains a `±` byte
without a coding declaration, which 3.14 rejects). Patch in place:
```bash
sed -i.bak '1i\
# -*- coding: latin-1 -*-
' venv/lib/python3.14/site-packages/nodriver/cdp/network.py
```
Or switch to Python 3.12: `brew install python@3.12 && /opt/homebrew/bin/python3.12 -m venv venv` then reinstall.

### `pydantic-core` build fails on Python 3.14
`pydantic < 2.11` ships PyO3 0.22 which caps at 3.13. This repo pins
`pydantic>=2.11` already; if you still hit it, `pip install --upgrade pip`
so pip picks up the newer wheel.

### nodriver hangs on first request
Chrome isn't where nodriver expects. Install the cask: `brew install --cask google-chrome`.

### `Blocked by WAF` or Cloudflare challenge page
Soft challenges clear automatically. Hard ones (rate limits, datacenter-IP
blocks) need residential proxies — add a `proxy={...}` arg in
`backend/app/browser.py:BrowserPool.start()`.

---

## Roadmap

- [x] Visual picker
- [x] Template save/load
- [x] JSON + CSV export
- [ ] Selector generalization for lists (click 2 similar items → auto-find siblings)
- [ ] Batch URL processing against a saved template
- [ ] Scheduled reruns (cron)
- [ ] Pagination detection + auto-follow
- [ ] Auth + cloud template storage

---

## License

MIT — see [LICENSE](LICENSE).

---

## v1 (legacy)

The original Flask + XPath-based app is preserved under [`legacy/`](legacy/)
with its own README. It still runs if you want to see where this started —
but the v2 picker replaces it entirely.
