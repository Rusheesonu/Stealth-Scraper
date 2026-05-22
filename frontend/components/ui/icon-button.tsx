"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * IconButton — the canonical icon-only button primitive.
 *
 * Pre-launch audit (May 22) flagged "no IconButton primitive" — every
 * close/copy/dismiss button was hand-rolled with one of three ad-hoc
 * className patterns (`h-8 w-8` vs `p-1.5` vs `p-1`), giving the same
 * gesture three different visual treatments across modals and panels.
 *
 * Now: one primitive, three sizes, one hover treatment, one focus ring.
 * Every icon-only action site uses this.
 *
 * Usage:
 *   <IconButton aria-label="Close" onClick={onClose}>
 *     <X className="h-4 w-4" />
 *   </IconButton>
 *
 *   <IconButton aria-label="Copy" size="sm" tone="quiet" onClick={copy}>
 *     <Copy className="h-3.5 w-3.5" />
 *   </IconButton>
 *
 * Accessibility:
 *   • `aria-label` is REQUIRED (TypeScript-enforced via Required<>).
 *   • Focus ring uses the accent token; visible at 2px against any
 *     background.
 *   • Children should be a single icon at ~h-4 w-4 (md), h-3.5 w-3.5 (sm),
 *     h-3 w-3 (xs).
 */

type IconButtonSize = "xs" | "sm" | "md";
type IconButtonTone = "default" | "quiet" | "danger";

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Required for screen readers — there's no visible text. */
  "aria-label": string;
  size?: IconButtonSize;
  tone?: IconButtonTone;
};

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  // 24×24 — table-row inline actions
  xs: "h-6 w-6",
  // 28×28 — toolbar buttons
  sm: "h-7 w-7",
  // 32×32 — modal-corner Close, panel-header actions (default)
  md: "h-8 w-8",
};

const TONE_CLASSES: Record<IconButtonTone, string> = {
  // default — muted icon, hover surface, accent focus
  default:
    "text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]",
  // quiet — softer baseline, ideal inside already-busy chrome (toolbars)
  quiet:
    "text-[var(--color-fg-subdued)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]",
  // danger — destructive actions (delete row). Subtle until hover.
  danger:
    "text-[var(--color-fg-muted)] hover:bg-[color:var(--color-warning)]/12 hover:text-[var(--color-warning)]",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { className, size = "md", tone = "default", children, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          // base layout: square tap target, centered child
          "inline-flex items-center justify-center rounded-md",
          // transitions — match the rest of the product's vocabulary
          "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          // focus ring — accent, visible against any surface
          "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
          // disabled state — half opacity, no hover
          "disabled:pointer-events-none disabled:opacity-50",
          SIZE_CLASSES[size],
          TONE_CLASSES[tone],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
