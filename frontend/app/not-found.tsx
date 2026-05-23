import Link from "next/link";
import type { Metadata } from "next";
import { PageShell } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The page you were looking for doesn't exist.",
};

/**
 * Branded 404 — same shell as the rest of the app so it doesn't feel like
 * you've fallen off the side of the product. Three clear ways back in
 * (home, marketplace, docs) — no clever 404 art, just signposting.
 */
export default function NotFound() {
  return (
    <PageShell maxWidth="max-w-2xl">
      <div className="flex flex-col items-start gap-10 py-16">
        <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          404 · not found
        </div>

        <div className="flex flex-col gap-4">
          <h1 className="text-[44px] font-semibold leading-[1.05] tracking-[-0.028em] text-[var(--color-fg-display)] sm:text-[52px]">
            Page not found.
          </h1>
          <p className="max-w-md text-[16px] leading-[1.6] text-[var(--color-fg-muted)]">
            The URL you followed doesn&apos;t match anything we serve. It may
            have moved, or never existed. Here&apos;s where you probably wanted
            to go.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/">
            <Button variant="primary" size="md">Back to home</Button>
          </Link>
          <Link href="/marketplace">
            <Button variant="secondary" size="md">Marketplace</Button>
          </Link>
          <Link href="https://github.com/Rusheesonu/stealth-browser#readme" target="_blank" rel="noreferrer">
            <Button variant="ghost" size="md">Docs</Button>
          </Link>
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-[var(--color-border)] pt-6 text-[13px] text-[var(--color-fg-muted)]">
          <Brand showText={false} />
          <span className="font-mono">
            Still lost? Email{" "}
            <a
              href="mailto:support@stealthscraper.dev"
              className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline"
            >
              support@stealthscraper.dev
            </a>
            .
          </span>
        </div>
      </div>
    </PageShell>
  );
}
