"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * PageHeader — the canonical heading for every interior route.
 *
 * Solves the "dead-end navigation" problem: every page that isn't the
 * landing or product-canvas gets a back button. We prefer `backHref`
 * (a known destination, stable on direct-load) and fall back to
 * `router.back()` only when explicitly opted in via `useHistoryBack`.
 *
 * Anatomy:
 *   ← Back · eyebrow  |  Title (h1)  |  description (muted)  |  actions →
 *
 * Motion: title + eyebrow fade-up on mount. Single 280ms reveal — felt,
 * not seen. No staggered cascade that distracts from the content.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  backHref,
  backLabel,
  useHistoryBack = false,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  /** Preferred. A known route to navigate to (stable on direct-load / refresh). */
  backHref?: string;
  /** Label next to the arrow. Defaults to "Back". */
  backLabel?: string;
  /** Use router.back() instead of a fixed href. Only safe when we know
   *  there's history (e.g. modals opened from a list). Most pages should
   *  use backHref instead. */
  useHistoryBack?: boolean;
  actions?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const showBack = backHref || useHistoryBack;

  return (
    <motion.header
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className={cn("mb-10", className)}
    >
      {showBack && (
        <div className="mb-4">
          {backHref ? (
            <Link
              href={backHref}
              className={cn(
                "group inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5",
                "text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              )}
            >
              <ArrowLeft className="h-3 w-3 transition-transform duration-[var(--dur-fast)] group-hover:-translate-x-0.5" />
              {backLabel ?? "Back"}
            </Link>
          ) : (
            <button
              onClick={() => router.back()}
              className={cn(
                "group inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -ml-1.5",
                "text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              )}
            >
              <ArrowLeft className="h-3 w-3 transition-transform duration-[var(--dur-fast)] group-hover:-translate-x-0.5" />
              {backLabel ?? "Back"}
            </button>
          )}
        </div>
      )}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              {eyebrow}
            </div>
          )}
          <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--color-fg-strong)]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-xl text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </motion.header>
  );
}
