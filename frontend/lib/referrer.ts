/**
 * Cohort detection for personalized landing — Z5 in PRODUCT_FEATURES_15.md.
 *
 * Different audiences speak different dialects. PH visitors aren't HN
 * visitors aren't r/webscraping. One landing page can't speak all of
 * them at peak conversion. This module classifies the visitor's source
 * so the hero can render the right headline + featured templates.
 *
 * Priority order:
 *   1. ?ref=<cohort> query param (explicit, e.g. share links)
 *   2. ?utm_source=<source> query param (campaign-aware)
 *   3. document.referrer (the browser-sent referrer)
 *
 * All return 'generic' when no signal matches.
 */

export type Cohort =
  | "r-webscraping"
  | "hackernews"
  | "producthunt"
  | "x"
  | "langchain"
  | "indiehackers"
  | "generic";

const REF_PARAM_MAP: Record<string, Cohort> = {
  "r-webscraping": "r-webscraping",
  "webscraping": "r-webscraping",
  "hn": "hackernews",
  "hackernews": "hackernews",
  "ph": "producthunt",
  "producthunt": "producthunt",
  "x": "x",
  "twitter": "x",
  "langchain": "langchain",
  "lc": "langchain",
  "ih": "indiehackers",
  "indiehackers": "indiehackers",
};

const REFERRER_PATTERNS: { pattern: RegExp; cohort: Cohort }[] = [
  { pattern: /reddit\.com\/r\/webscraping/i, cohort: "r-webscraping" },
  { pattern: /news\.ycombinator\.com|ycombinator/i, cohort: "hackernews" },
  { pattern: /producthunt\.com/i, cohort: "producthunt" },
  { pattern: /(^|\.)x\.com|twitter\.com|t\.co/i, cohort: "x" },
  { pattern: /langchain|smith\.langchain/i, cohort: "langchain" },
  { pattern: /indiehackers\.com|ih\.com/i, cohort: "indiehackers" },
];

/**
 * Classify the current visitor.
 *
 * Safe to call SSR-side (window/document checks guarded). Returns
 * 'generic' on server-render — the client component then re-evaluates
 * after mount.
 */
export function getCohort(): Cohort {
  if (typeof window === "undefined") return "generic";
  const params = new URLSearchParams(window.location.search);
  const ref = (params.get("ref") || "").toLowerCase().trim();
  if (ref && ref in REF_PARAM_MAP) return REF_PARAM_MAP[ref];
  const utm = (params.get("utm_source") || "").toLowerCase().trim();
  if (utm && utm in REF_PARAM_MAP) return REF_PARAM_MAP[utm];
  const r = document.referrer || "";
  for (const { pattern, cohort } of REFERRER_PATTERNS) {
    if (pattern.test(r)) return cohort;
  }
  return "generic";
}

export type CohortCopy = {
  headline: string;
  subhead: string;
  primaryCta: string;
  featuredTemplate?: string;    // hint for which marketplace template to feature
};

export const COHORT_COPY: Record<Cohort, CohortCopy> = {
  "r-webscraping": {
    headline: "For the people who fight Cloudflare every Monday.",
    subhead:
      "Multi-engine router. Real-Chrome TLS impersonation. Camoufox for the sites that hate Chromium. The scraper actually built by someone who's been in your shoes.",
    primaryCta: "Try it free",
    featuredTemplate: "cloudflare-bypass-demo",
  },
  hackernews: {
    headline: "For the people who built their own Playwright stack and want it to stop breaking.",
    subhead:
      "Open-source engine layer (stealth-browser). Bench-first culture. Honest numbers in every commit. Hosted SaaS for when you don't want to maintain it.",
    primaryCta: "Read the bench numbers",
  },
  producthunt: {
    headline: "Scrape any site in 30 seconds — no signup.",
    subhead:
      "Product Hunt visitors get 20 free scrapes/day. No credit card. Paste a URL, click the fields you want, get JSON.",
    primaryCta: "Try the demo →",
  },
  x: {
    headline: "The web-data layer that AI agents actually trust.",
    subhead:
      "Typed error envelopes. Per-field confidence scores. Cost-preview API. Idempotent retries. MCP server with one fat tool. Everything an agent runtime needs.",
    primaryCta: "Add to your agent",
  },
  langchain: {
    headline: "Web scraping for LangGraph + Claude agents.",
    subhead:
      "MCP server, Python SDK, TypeScript SDK. Drop into your agent's tool list. Streaming markdown, structured JSON, per-field confidence — pick what your agent needs.",
    primaryCta: "Add to your agent",
    featuredTemplate: "langgraph-rag-ingestion",
  },
  indiehackers: {
    headline: "For solo builders who can't afford BrightData.",
    subhead:
      "$19/month gets you 5,000 scrapes. The same engines BrightData charges $500/month for. Same Cloudflare bypass, same residential routing, fraction of the price.",
    primaryCta: "Start free",
  },
  generic: {
    // Restored from the pre-1ed2ad5 hero — leads with the visual picker
    // (the actual differentiator) instead of a generic "data layer" claim
    // that Firecrawl / Apify / Bright Data all already make.
    headline: "The visual scraper for AI agents. Point, click, save, ship.",
    subhead:
      "Other scrapers ask you to prompt and pray. We let you see what you're extracting — click any element, save the recipe, run it forever. With selectors you can actually debug.",
    primaryCta: "Try it free",
  },
};
