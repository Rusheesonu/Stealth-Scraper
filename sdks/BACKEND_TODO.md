# SDK ↔ Backend gaps

These backend routes are referenced by the SDKs but don't exist yet in
`backend/app/main.py`. The SDKs ship today and degrade gracefully when the
route 404s; stub them when you get the chance.

## 1. `POST /estimate` (cost preview)

Request body:

```json
{
  "url": "https://...",
  "template": [ ... ]   // OR "schema": [ ... ]
}
```

Response:

```json
{
  "estimated_credits": 1.0,
  "estimated_usd": 0.005,
  "plan_credits_remaining": 990,
  "breakdown": {
    "snapshot": 1.0,
    "assist": 0.0,
    "extraction": 0.0
  }
}
```

Used by `client.estimate(url, schema=...)` in both the Python and TS SDKs.
Maps `kind: "plan_limit"` → `PlanLimitError` on the SDK side.

## 2. `POST /snapshot/stream` (SSE)

Server-Sent Events stream of snapshot progress. Each event:

```
data: {"event": "navigating", "message": "loading https://...", "progress": 0.25}
```

Final event:

```
data: {"event": "done", "message": "ok", "progress": 1.0, "result": { ...same shape as /snapshot... }}
```

Used by `AsyncStealthClient.snapshot_stream(url)` (Python) and
`client.snapshotStream(req)` (TS). Both SDKs fall back to a synthetic
2-event stream wrapping a normal `/snapshot` call when this endpoint 404s,
so adding it later is a pure upgrade — no client changes needed.

## 3. Typed error envelopes

Several endpoints already return structured 4xx responses, but the SDKs
expect this exact envelope shape across the board:

```json
{
  "detail": {
    "kind": "anti_bot_block",
    "message": "human-readable",
    "vendor": "cloudflare",
    "suggestion": "..."
  }
}
```

Known `kind`s the SDKs understand today:

- `anti_bot_block` (vendor, suggestion) → `AntiBotBlockError`
- `plan_limit` (used, limit, upgrade_url) → `PlanLimitError`
- `overloaded` (retry_after_s) → `OverloadedError`
- `unsafe_url` / `robots_disallowed` → `UnsafeUrlError`
- `rate_limit` (retry_after_s) → `RateLimitError` (or status 429)

New kinds added on the backend fall through to the generic `ApiError` with
`kind` preserved, so adding them is forward-compatible.

## 4. `Idempotency-Key` header

Every mutating call from the SDKs sends `Idempotency-Key: sdk-<uuid4>`
(auto-generated if the caller didn't supply one). The backend should:

1. Hash `(user_id, route, idempotency_key)` and stash the response for ~24h.
2. On replay within that window, return the cached response without
   re-running the scrape.

Until this lands the header is harmless (FastAPI ignores unknown headers),
so it's safe for the SDK to send it now.
