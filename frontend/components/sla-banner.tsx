"use client";

/**
 * Reliability SLA banner — B1 in PRODUCT_FEATURES_15.md.
 *
 * "If a scrape fails, you don't pay." Single biggest trust signal we
 * can ship before PH launch. Render on landing + pricing.
 */

import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** "hero" = compact line for landing; "feature" = bigger card for pricing. */
  variant?: "hero" | "feature";
  className?: string;
};

export function SLABanner({ variant = "hero", className }: Props) {
  if (variant === "hero") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-4 py-1.5 text-[13px] font-mono text-emerald-700 dark:text-emerald-300",
          className,
        )}
      >
        <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
        Reliability SLA: failed scrapes auto-refund — you never pay for a blocked page
      </div>
    );
  }
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/5 to-emerald-500/10 p-6",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
        </div>
        <div className="space-y-2">
          <h3 className="text-[18px] font-semibold tracking-tight text-[var(--color-fg-strong)]">
            Reliability SLA — failed scrapes don&apos;t cost a credit.
          </h3>
          <p className="text-[15px] leading-[1.6] text-[var(--color-fg)]">
            If a scrape hits an anti-bot wall, returns empty, or errors out —
            we auto-refund the credit within minutes. View your refund
            history at any time in <span className="font-mono text-[var(--color-fg-strong)]">Settings → Refunds</span>.
            Nobody else does this. Firecrawl, Apify, Bright Data all charge
            for failures.
          </p>
        </div>
      </div>
    </div>
  );
}
