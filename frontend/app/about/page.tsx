import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "About",
  description:
    "Built by Rushikesh Sonu — ex-data engineer, 5 years scraping 500+ sites.",
};

/**
 * /about — one-screen founder page. Copy lifted verbatim from
 * founder-note.tsx so the bio stays consistent across the product.
 */
export default function AboutPage() {
  return (
    <PageShell maxWidth="max-w-2xl">
      <PageHeader
        eyebrow="About"
        title="Built by Rushikesh Sonu"
        backHref="/"
        backLabel="Home"
      />

      <div className="flex flex-col gap-6 text-[14px] leading-[1.7] text-[var(--color-fg)]">
        <p>
          I&apos;m Rushi. Senior data engineer with 5+ years of production
          scraping — built 500+ pipelines for clients across e-commerce,
          lead gen, real estate, and AI training data.
        </p>
        <p>
          The same problem broke every Monday morning: a site updated their
          DOM, my client&apos;s pipeline went dark, and I burned hours fixing
          nth-of-type selectors that didn&apos;t help anyone.
        </p>
        <p>
          Stealth-Scraper is what that experience looks like as a product.
          Visual where AI tools are opaque. Stateless-killing where API tools
          forget. Cloudflare-first where Playwright dies. Built so my old
          self could ship in 15 minutes instead of 15 hours.
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-[var(--color-border)] pt-6 text-[13px]">
          <a
            href="https://github.com/Rusheesonu/stealth-browser"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline"
          >
            GitHub
          </a>
          <span className="text-[var(--color-fg-subdued)]">·</span>
          <a
            href="https://x.com/rushikeshsonu"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline"
          >
            X / Twitter
          </a>
          <span className="text-[var(--color-fg-subdued)]">·</span>
          <Link
            href="mailto:support@stealthscraper.dev"
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline"
          >
            support@stealthscraper.dev
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
