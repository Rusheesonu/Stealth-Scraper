-- Stealth-Scraper initial schema for Supabase Postgres.
--
-- Apply by either:
--   1. Pasting this whole file into the Supabase SQL editor and running
--   2. Or via psql: psql "$DATABASE_URL" -f backend/migrations/initial.sql
--   3. Or via the helper script: python -m app.migrate
--
-- All tables are designed for backend-only access (no RLS) — the FastAPI
-- layer enforces auth + tenancy via Supabase JWT verification.

CREATE TABLE IF NOT EXISTS templates (
    id            SERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL DEFAULT '',
    name          TEXT NOT NULL,
    source_url    TEXT NOT NULL,
    fields_json   TEXT NOT NULL,
    is_public     BOOLEAN NOT NULL DEFAULT FALSE,
    fork_count    INTEGER NOT NULL DEFAULT 0,
    description   TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_templates_user   ON templates (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_templates_public ON templates (is_public, fork_count DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
    ls_subscription_id  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    ls_variant_id       TEXT NOT NULL,
    plan                TEXT NOT NULL,
    status              TEXT NOT NULL,
    current_period_end  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);

CREATE TABLE IF NOT EXISTS usage_counts (
    user_id     TEXT NOT NULL,
    year_month  TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, year_month)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id            SERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    prefix        TEXT NOT NULL,
    hashed_key    TEXT NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id);

-- Processed Lemon Squeezy webhook events. We dedupe on `event_id` (the
-- top-level `data.id` from the webhook payload) so a replayed delivery
-- can't double-apply a subscription change. `payload` is kept verbatim
-- so we can replay manually if we hit a processing bug post-receive.
CREATE TABLE IF NOT EXISTS processed_webhook_events (
    event_id      TEXT PRIMARY KEY,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload       JSONB
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id               SERIAL PRIMARY KEY,
    user_id          TEXT NOT NULL,
    template_id      INTEGER NOT NULL,
    name             TEXT NOT NULL,
    target_url       TEXT NOT NULL,
    schedule_cron    TEXT NOT NULL,
    webhook_url      TEXT NOT NULL DEFAULT '',
    last_run_at      TIMESTAMPTZ,
    last_status      TEXT,
    next_run_at      TIMESTAMPTZ,
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_user      ON scheduled_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_next_run  ON scheduled_jobs (enabled, next_run_at);

-- Reliability SLA — every failed scrape (blocked, empty, errored) gets
-- a row here AND a usage_counts decrement. The /me/refunds endpoint
-- reads from this for the user-visible refund history.
CREATE TABLE IF NOT EXISTS usage_refunds (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT NOT NULL,
    year_month      TEXT NOT NULL,
    refunded_count  INTEGER NOT NULL DEFAULT 1,
    reason          TEXT NOT NULL,
    url             TEXT,
    refunded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scrape_meta     JSONB
);
CREATE INDEX IF NOT EXISTS idx_refunds_user_month ON usage_refunds (user_id, year_month);
CREATE INDEX IF NOT EXISTS idx_refunds_user_date  ON usage_refunds (user_id, refunded_at DESC);

-- Reviews — per-product (stealth-scraper) + per-template.
-- target_kind = 'product' | 'template'. UNIQUE constraint = one review
-- per user per target.
CREATE TABLE IF NOT EXISTS reviews (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT NOT NULL,
    target_kind  TEXT NOT NULL CHECK (target_kind IN ('product','template')),
    target_id    TEXT NOT NULL,
    rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body         TEXT NOT NULL DEFAULT '',
    verified     BOOLEAN NOT NULL DEFAULT FALSE,
    author_name  TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, target_kind, target_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_target ON reviews (target_kind, target_id, created_at DESC);
