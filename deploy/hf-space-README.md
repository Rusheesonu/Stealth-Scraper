---
title: Stealth-Scraper API
emoji: 🕷️
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Stealth-Scraper API

Backend for [Stealth-Scraper](https://github.com/Rusheesonu/Stealth-Scraper) — a
visual, point-and-click web scraper.

- **Source:** https://github.com/Rusheesonu/Stealth-Scraper
- **Frontend:** deployed separately on Vercel; this Space only serves the API
- **Stack:** FastAPI + nodriver (stealth-patched Chromium) + lxml + aiosqlite

## Endpoints

- `POST /snapshot` — URL → screenshot + element catalog
- `POST /extract` — URL + template → structured JSON
- `POST /extract/batch` — many URLs, one template
- `GET / PUT / DELETE /templates/{id}` — saved recipes (SQLite, ephemeral on free tier)
- `GET /health` — liveness + browser status

Interactive docs: `/docs`

## Notes

Free HF tier has no persistent storage, so saved templates reset on each
rebuild. For persistent storage, attach a paid HF persistent volume.
