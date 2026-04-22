# Backend — Stealth-Scraper v2

FastAPI + Playwright. Talks to the Next.js frontend on `:3000`.

## Quickstart

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
python run.py
```

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
│   ├── browser.py     Shared Playwright browser pool
│   ├── snapshot.py    URL → screenshot + element catalog
│   ├── extract_js.py  In-page JS for element detection
│   ├── extract.py     Run a template against a URL
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
