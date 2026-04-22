# Architecture

High-level view of how the pieces fit.

## Two services, one repo

```
    ┌───────────────────┐   rewrite    ┌──────────────────────┐
    │  Next.js 16       │  /api/*  ──▶ │  FastAPI :8000       │
    │  :3000            │              │                      │
    │  (browser talks   │   ◀──── JSON │  Playwright pool     │
    │   here only)      │              │  SQLite templates    │
    └───────────────────┘              └──────────────────────┘
```

The browser never calls the FastAPI origin directly. All `/api/backend/*`
requests from the Next.js app route through a rewrite rule
(`next.config.ts`) that proxies to `BACKEND_URL`. This:

- Removes the need to configure CORS.
- Keeps the backend URL out of the browser.
- Means prod can point `BACKEND_URL` at an internal address.

## Request flow — snapshot

```
User → /pick?url=X
          │
          ▼
PickerClient.load()
          │
          ▼
fetch /api/backend/snapshot  ─── rewrite ──▶  FastAPI POST /snapshot
                                                        │
                                                        ▼
                                              snapshot.take_snapshot()
                                                        │
                                                        ▼
                                              BrowserPool.context()
                                                        │
                                                        ▼
                                              Playwright page.goto(url)
                                              page.screenshot(full_page)
                                              page.evaluate(COLLECT_ELEMENTS_JS)
                                                        │
                                                        ▼
                                              { screenshot_b64, elements[], … }
                                                        │
                   ◀──────────── same body ─────────────┘

SnapshotCanvas renders the PNG, scales element bboxes into display
coords, and wires hover/click.
```

## Element detection (`app/extract_js.py`)

Runs **inside the page** (via Playwright's `page.evaluate`). That's the
key decision: the bounding boxes we return are pixel-perfect against the
screenshot, because both come from the same rendered DOM at the same
instant.

Pipeline:
1. `document.querySelectorAll("*")`
2. Skip structural tags (SCRIPT, STYLE, SVG children, …)
3. Visibility filter (display, visibility, opacity, bbox ≥ 4px)
4. Keep if (has own direct text) OR (is media/interactive: IMG, A, BUTTON, INPUT)
5. Drop full-page container divs that would swallow clicks
6. For each survivor: build a stable CSS selector (id if safe, else
   tag[.class]:nth-of-type chain) and XPath, capture bbox + attrs.

## Why nodriver (and not Playwright)

Playwright is great, but it loses on the first fingerprint check that
looks for `Runtime.evaluate` traces or the specific flag signature
Playwright uses to launch Chromium. Stealth-JS plugins help but can't
fix leaks that live below the JS layer.

**nodriver** (the undetected-chromedriver successor) patches Chromium
at the binary-flag + CDP level:

- Uses a real Chrome install, not a Playwright-bundled Chromium
- Strips the `--enable-automation` family of flags
- Avoids the `Runtime.evaluate` leak by routing script execution
  differently
- Injects a real extension for proxy auth (unused here — we don't ship
  proxies in this OSS build)

On top of nodriver we layer `ULTRA_STEALTH_JS` via CDP
`Page.addScriptToEvaluateOnNewDocument`, which runs before any page JS
on every navigation. It closes the remaining fingerprint leaks in
JS-land:

| Leak | Fix |
|------|-----|
| `navigator.webdriver` | redefined to `undefined` |
| `window.chrome.runtime` | real-looking shape stub |
| `navigator.plugins.length === 0` | return a 5-entry array |
| `navigator.languages === []` | `["en-US", "en"]` |
| WebGL vendor = `Google SwiftShader` | spoofed to `Intel Inc.` / `Intel Iris OpenGL Engine` |
| `Notification.permission` ≠ permissions.query | patched to agree |
| `hardwareConcurrency`, `deviceMemory`, `maxTouchPoints` | realistic defaults |
| Screen dims = 800x600 | 1920x1080 |

Result: soft Cloudflare, DataDome, Turnstile "invisible mode", and most
basic PerimeterX deployments clear without any proxy. Hardened targets
(StockX, Akamai on hot sites, Kasada) still need residential proxies
— that piece is out of scope for this OSS repo but trivial to add:
one `proxies.txt` and a `proxy={...}` arg in `BrowserPool.start()`.

## Template model

```sql
CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  fields_json TEXT NOT NULL,       -- array of TemplateField
  created_at TEXT,
  updated_at TEXT
);
```

`fields_json` is the array the user built by clicking. Each row:
```ts
{ label, selector (CSS), xpath, kind: "text|attr|list|html", attr }
```

Running a template is a flat `for field in template: query_selector_all →
read text/attr/html → collect`. No magic — the *picking* is the hard
part; the *running* is trivial.

## Browser lifetime

One Chromium, lazy-init on the first `/snapshot` request, kept hot for
the process lifetime. New `BrowserContext` per request (fresh cookies,
fresh UA) — cheap (~100ms) compared to a full browser boot (~3s).
