# Legacy — Stealth-Scraper v1

This folder holds the original Flask + Playwright app that powered the project
from 2024 through mid-2025. It's preserved for history but not wired into the
current build.

**The new app lives in `../backend/` (FastAPI) and `../frontend/` (Next.js 16).**
See the root README for quickstart.

## Running the legacy app (optional)

```bash
cd legacy
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Opens on `http://localhost:5000`. Enter a URL + XPath rules, get JSON back.

The legacy UI expects the user to already know XPath. The v2 app replaces this
with a visual point-and-click picker — no XPath required.
