# Backend — Stealth-Scraper v2

FastAPI + **nodriver** (stealth-patched Chromium via CDP). Talks to the
Next.js frontend on `:3000`.

## Quickstart

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python run.py
```

Requires a local Google Chrome / Chromium install. On macOS:
`brew install --cask google-chrome`.

Opens on `http://localhost:8000`. Interactive API docs at `/docs`.

## Endpoints

| Method | Path | What it does |
|---|---|---|
| `POST` | `/snapshot` | URL → screenshot (base64 PNG) + catalog of clickable elements with bboxes + selectors |
| `POST` | `/extract` | URL + field template → structured JSON/CSV-ready data |
| `GET`  | `/templates` | List saved recipes |
| `POST` | `/templates` | Save a recipe |
| `GET`  | `/templates/{id}` | Get one |
| `PUT`  | `/templates/{id}` | Update |
| `DELETE` | `/templates/{id}` | Delete |
| `GET` | `/health` | Liveness + browser status |

## Layout

```
backend/
├── app/
│   ├── main.py        FastAPI app + routes
│   ├── browser.py     nodriver Browser pool (lazy, locked, one tab per request)
│   ├── stealth.py     ULTRA_STEALTH_CHROMIUM_ARGS + ULTRA_STEALTH_JS
│   ├── snapshot.py    URL → full-page CDP screenshot + element catalog
│   ├── extract_js.py  In-page JS for element detection (bbox + selectors)
│   ├── extract.py     Run a template against a URL (nodriver + lxml)
│   └── db.py          SQLite template store
├── data/              templates.db (gitignored)
├── requirements.txt
└── run.py
```

## Smoke test

With the server running:

```bash
curl -X POST http://localhost:8000/snapshot \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' | jq '.title, .element_count'
```
