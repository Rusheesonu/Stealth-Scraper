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

Under the hood it's nodriver (stealth-patched Chromium) + CSS/XPath
selectors — but the user never types one.

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

1. **Snapshot** — `POST /snapshot { url }` loads the page in a stealth
   Chromium, force-eagers lazy images, scrolls through to trigger
   intersection-observer loaders, waits for `scrollHeight` to stabilise,
   then walks the DOM to collect every visible element
   (`{ tag, bbox, xpath, css, text, attrs }`) and takes a full-page
   screenshot. The stability poll matters — Amazon-style pages
   lazy-insert banners and without it the overlay boxes drift ~70px off
   the real content.
2. **Pick** — the frontend renders the PNG and overlays the bounding boxes.
   Hovering highlights the *innermost* hit. Clicking opens a label modal:
   name it, choose Text / Attribute (href, src, …) / List (all matches).
   The picker is smarter than a plain click — see
   [picker tricks](#picker-tricks) below.
3. **Save** — your picks become a **template**: a JSON array of
   `{ label, selector, xpath, kind, attr }` rows, stored in SQLite.
4. **Extract** — `POST /extract { url, template }` runs the template
   against any URL. When two or more list fields share a CSS ancestor,
   the backend iterates that ancestor row-by-row and extracts each
   field relative to the row, emitting `null` for rows that are
   missing a particular field. Lists stay the same length even if one
   product omits a spec, so the Records view zips them cleanly.
   Frontend offers Copy JSON, Download JSON, Download CSV.

---

## Picker tricks

These are the things that make the picker actually work on messy real-
world sites instead of just toy demos.

**Drag-to-select for composite values.** Mouse-down and drag a rectangle
over something like `$319.99` — the picker scores every element by how
much of the drag area it covers (IoU-flavoured) and picks the smallest
one that fully contains the box. Solves the "Amazon splits the price
into two spans so a click on `$319` drops the `.99`" problem.

**Auto-sibling detection via visual column.** Clicking one product title
on a 16-product page fills in a list of 16. The heuristic is "same
structural selector *and* same bbox x-coordinate" — so a click on a
Display Size cell returns the 16 Display Size values, not all 64 cells
of the 4-column spec table.

**Shift-click to extend.** Auto-detection misses a sponsored variant?
Hold shift, click the missing item — it's added to your latest list
field using the same column-aware logic. The toast confirms the new
match count.

**Select parent button (Alt + ↑).** Accidentally clicked a too-tight
inner span? The label modal climbs to the smallest collected wrapper
containing your pick. Keyboard works too.

**Records view.** When every list field in the extraction has the same
length, the results panel opens as a table with one row per item —
real spreadsheet shape, not "here are three parallel arrays". CSV
export follows whichever view is active.

**Extract from a different URL than you picked on.** The header has an
editable *Extract from* field pre-seeded with the snapshot URL. Useful
when you pick fields on `example.com/products/1` and want to run the
same template against `/products/2`, `/3`, … without saving and
reloading the template.

**Batch mode.** The Batch button takes a newline-separated URL list and
runs the current template against all of them. Results arrive as each
page finishes; export as a single JSON/CSV bundle.

---

## Repo layout

```
Stealth-Scraper/
├── backend/
│   ├── app/
│   │   ├── main.py          FastAPI app + routes
│   │   ├── browser.py       Shared nodriver browser pool
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
│   │   ├── picker/          SnapshotCanvas (drag-select, hover, overlays),
│   │   │                    LabelModal (parent-select escape hatch),
│   │   │                    FieldSidebar, ResultsPanel (Records view),
│   │   │                    BatchModal
│   │   └── ui/              Button, Input, Badge
│   └── lib/                 api client, utils (sibling detection, list normalization)
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
| `POST` | `/extract` | `{ url, template[] }` | `{ fields: {...}, errors: {...} }` (row-aligned when multiple list fields share an ancestor) |
| `POST` | `/extract/batch` | `{ urls[], template[] }` | `{ count, results: [{ url, data }] }` |
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
- [x] Selector generalisation for lists (one click → all siblings, bbox-column aware)
- [x] Shift-click to extend a list with missed items
- [x] Drag-select for composite values (split-price spans etc.)
- [x] Parent-select escape hatch in the label modal
- [x] Extract from a different URL than you picked on
- [x] Batch URL processing against a saved template
- [x] Row-aligned extraction (missing fields → `null` so lists stay the same length)
- [x] Records view in the results panel
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
