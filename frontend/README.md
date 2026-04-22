# Frontend — Stealth-Scraper v2

Next.js 16 App Router · React 19 · Tailwind v4 · Framer Motion · lucide-react.

## Quickstart

```bash
cd frontend
cp .env.local.example .env.local   # set BACKEND_URL if not localhost:8000
npm install
npm run dev
```

Opens on http://localhost:3000.

## Structure

```
frontend/
├── app/
│   ├── layout.tsx         Root layout + global styles
│   ├── page.tsx           Landing (URL input, feature cards)
│   ├── globals.css        Tailwind v4 theme + dark styling
│   ├── pick/page.tsx      Picker route (?url=...)
│   └── templates/page.tsx Saved templates list + re-run
├── components/
│   ├── brand.tsx          Wordmark
│   ├── url-form.tsx       Landing input
│   ├── templates-list.tsx Templates CRUD UI
│   ├── picker/            Picker screen (SnapshotCanvas + LabelModal + sidebar + results)
│   └── ui/                shadcn-style primitives (Button, Input, Badge)
└── lib/
    ├── api.ts             Typed client for the FastAPI backend
    └── utils.ts           cn(), CSV, blob download
```

## How it talks to the backend

`next.config.ts` rewrites `/api/backend/*` → `${BACKEND_URL}/*`. All browser calls
hit the Next.js origin so we never touch CORS. The only env var is
`BACKEND_URL` (defaults to `http://localhost:8000`).
