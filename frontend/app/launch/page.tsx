import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LaunchDemoClient } from "./launch-demo-client";

/**
 * /launch — the 30-second Product Hunt landing.
 *
 * Single-purpose page: a PH visitor lands here and the page auto-runs a real
 * scrape against one of three soft sites (hn / quotes / books) without
 * signup or a single click. The result phase shows the screenshot + the
 * structured JSON the API would actually return, plus a sign-up CTA.
 *
 * Architecture: server component (this file) holds the static SSR fallback
 * + metadata; the auto-running demo flow is a client component below.
 * `?demo=hn|quotes|books` selects the URL (default hn). The client
 * component reads the param on mount and fires the snapshot ~1.5s after
 * paint so the visitor gets a moment to read "preparing your demo…"
 * before the loader takes over.
 */
export const metadata: Metadata = {
  title: "Live demo · Stealth-Scraper",
  description: "See it scrape Hacker News in 7 seconds. No signup.",
  openGraph: {
    title: "Live demo · Stealth-Scraper",
    description: "See it scrape Hacker News in 7 seconds. No signup.",
    type: "website",
    url: "https://stealthscraper.dev/launch",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Live demo · Stealth-Scraper",
    description: "See it scrape Hacker News in 7 seconds. No signup.",
    images: ["/opengraph-image"],
  },
};

export default function LaunchPage() {
  // Suspense boundary is required because the client component reads
  // useSearchParams (Next 16 requires Suspense around any consumer of it
  // at build time). The fallback doubles as the JS-disabled view.
  return (
    <Suspense fallback={<NoJsFallback />}>
      <LaunchDemoClient />
    </Suspense>
  );
}

/**
 * Pure-SSR fallback shown when JS is disabled OR while the client bundle
 * is hydrating. No interactivity, no real scrape — just enough to prove
 * the page works and offer a way forward (sign-up, see homepage).
 *
 * Keep this dependency-free so the bundle stays light: no Nav, no
 * framer-motion, no icons that pull in lucide-react.
 */
function NoJsFallback() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-6 py-12">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          Live demo
        </div>
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--color-fg-display)]">
          Watch us scrape a real site in 7 seconds.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">
          This demo runs automatically when JavaScript is enabled. Until then,
          head to the homepage to paste your own URL.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-md bg-[var(--color-fg-strong)] px-5 text-[14px] font-medium text-[var(--color-bg)] hover:bg-[var(--color-fg-display)]"
          >
            Go to homepage
          </Link>
          <Link
            href="/login?mode=signup"
            className="inline-flex h-11 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-5 text-[14px] font-medium text-[var(--color-fg)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]"
          >
            Sign up free
          </Link>
        </div>
      </div>
    </main>
  );
}
