"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { PageShell } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";

/**
 * Global error boundary — catches anything thrown below the root layout.
 *
 * Next.js calls this with `error` (the thrown thing) and `reset` (a
 * function to retry the segment). We pipe `reset` into a "Try again"
 * button and offer two safety nets — status page (for outages) and
 * email (for real bugs that need a human).
 *
 * We log to console; PostHog / Sentry can hook in later via `useEffect`.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface in browser console so users can paste the digest when reporting.
    console.error("[stealth-scraper] runtime error:", error);
  }, [error]);

  return (
    <PageShell maxWidth="max-w-2xl">
      <div className="flex flex-col items-start gap-10 py-16">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-[color:var(--color-danger)]">
          <AlertTriangle className="h-3.5 w-3.5" />
          500 · runtime error
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-[40px] font-semibold leading-[1.08] tracking-[-0.028em] text-[var(--color-fg-display)]">
            Something broke.
          </h1>
          <p className="max-w-md text-[14px] leading-[1.55] text-[var(--color-fg-muted)]">
            We hit an unexpected error rendering this page. Try again — it&apos;s
            usually transient. If it keeps happening, check status or reach
            out and we&apos;ll fix it.
          </p>
          {error.digest && (
            <p className="font-mono text-[11px] text-[var(--color-fg-subdued)]">
              digest: <span className="text-[var(--color-fg-muted)]">{error.digest}</span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="md" onClick={() => reset()}>
            Try again
          </Button>
          <Link href="https://status.stealthscraper.dev" target="_blank" rel="noreferrer">
            <Button variant="secondary" size="md">Check status</Button>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="md">Back to home</Button>
          </Link>
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-[var(--color-border)] pt-6 text-[11px] text-[var(--color-fg-subdued)]">
          <Brand showText={false} />
          <span className="font-mono">
            Report this:{" "}
            <a
              href={`mailto:support@stealthscraper.dev?subject=Runtime%20error${error.digest ? `%20(${error.digest})` : ""}`}
              className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline"
            >
              support@stealthscraper.dev
            </a>
          </span>
        </div>
      </div>
    </PageShell>
  );
}
