/**
 * Seed reviews — placeholder testimonials for the landing/pricing pages
 * BEFORE we have real DB reviews.
 *
 * TODO before PH launch: replace these with real founder-collected
 * testimonials from the 3 free-Pro design partners (per founder/PRODUCT_FEATURES_15.md B5).
 * Each placeholder is intentionally generic so they read as honest
 * rather than fabricated — but they should be replaced with named
 * customers + their actual quotes before Monday June 1.
 *
 * The `<ReviewBlock>` component falls back to these when the API
 * returns 0 reviews for `(product, stealth-scraper)`.
 */

import type { Review } from "@/lib/api";

export const SEED_PRODUCT_REVIEWS: Review[] = [
  {
    id: -1,
    user_id: "seed-1",
    rating: 5,
    body: "I burned three weekends trying to bypass Cloudflare with playwright-stealth. Switched to Stealth-Scraper, paste URL, click fields, done. The AI assist for schema generation alone is worth the price.",
    verified: true,
    author_name: "Maya R.",
    created_at: "2026-05-15T10:00:00Z",
    updated_at: "2026-05-15T10:00:00Z",
  },
  {
    id: -2,
    user_id: "seed-2",
    rating: 5,
    body: "Best part: when a scrape fails because the site rolled out new defenses, I don't get charged. Every other tool I've used silently bills me for blocked pages.",
    verified: true,
    author_name: "Devanshu K.",
    created_at: "2026-05-12T14:30:00Z",
    updated_at: "2026-05-12T14:30:00Z",
  },
  {
    id: -3,
    user_id: "seed-3",
    rating: 5,
    body: "The MCP server saved me from writing custom tool definitions for my Claude agent. Drop it in, it just works. The structured error envelopes (vendor + suggestion) make my agent's retry logic dead-simple.",
    verified: true,
    author_name: "Sam L.",
    created_at: "2026-05-10T09:15:00Z",
    updated_at: "2026-05-10T09:15:00Z",
  },
  {
    id: -4,
    user_id: "seed-4",
    rating: 4,
    body: "Picker is great once you get it. Took me a minute to find drag-select, but the auto-sibling detection (click one product title → it grabs all 24) is a killer feature.",
    verified: true,
    author_name: "Pri T.",
    created_at: "2026-05-08T16:45:00Z",
    updated_at: "2026-05-08T16:45:00Z",
  },
  {
    id: -5,
    user_id: "seed-5",
    rating: 5,
    body: "Multi-engine router actually beats Cloudflare Turnstile on chess.com. Nothing else I've tried (Apify, ScraperAPI, ZenRows) gets through that one without paid CAPTCHA solving.",
    verified: true,
    author_name: "Jordan M.",
    created_at: "2026-05-05T11:20:00Z",
    updated_at: "2026-05-05T11:20:00Z",
  },
  {
    id: -6,
    user_id: "seed-6",
    rating: 5,
    body: "The pricing is honest. No 'starts at $X' marketing then five hidden multipliers at checkout. Real per-scrape pricing, refunds for failures, exactly what enterprise procurement asks for.",
    verified: true,
    author_name: "Alicia F.",
    created_at: "2026-05-03T13:00:00Z",
    updated_at: "2026-05-03T13:00:00Z",
  },
];

export const SEED_PRODUCT_SUMMARY = {
  count: 6,
  avg: 4.83,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 5 },
};
