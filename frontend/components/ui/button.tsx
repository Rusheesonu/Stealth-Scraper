"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button. Five variants, three sizes. Apple-style:
 *  • Filled charcoal CTAs (the iOS/macOS primary).
 *  • Soft accent for emerald affirmative actions.
 *  • Bordered + ghost for secondary work.
 *  • All variants share the same radius, easing, and focus chrome.
 *  • Tap-down press (96%) via framer-motion — feels physical, not flat.
 *
 * Accent stays reserved: don't sprinkle it across non-primary actions.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5",
    "rounded-md font-medium tracking-[-0.005em]",
    "transition-[background,border-color,color,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-line)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
  ].join(" "),
  {
    variants: {
      variant: {
        // Filled charcoal-on-white (Apple-style). The single page-level CTA.
        primary:
          "bg-[var(--color-fg-strong)] text-[var(--color-bg)] hover:bg-[var(--color-fg-display)]",
        // Soft accent fill — for affirmative actions that aren't THE CTA.
        accent:
          "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]",
        // Bordered — confirmations and side actions.
        secondary:
          "bg-[var(--color-surface)] text-[var(--color-fg)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]",
        // No background, no border — dense-UI text actions.
        ghost:
          "bg-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-ink-2)]",
        // Destructive — bordered, soft danger fill on hover.
        danger:
          "bg-transparent text-[color:var(--color-danger)] border border-[color:var(--color-danger)]/30 hover:bg-[var(--color-danger-soft)] hover:border-[color:var(--color-danger)]/60",
      },
      size: {
        sm: "h-7 px-2.5 text-[13px]",
        md: "h-9 px-3.5 text-[14px]",
        lg: "h-11 px-5 text-[15px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

type MotionButtonProps = Omit<HTMLMotionProps<"button">, "ref">;

export interface ButtonProps
  extends MotionButtonProps,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, disabled, ...props }, ref) => (
    <motion.button
      ref={ref}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.12, ease: [0.32, 0.72, 0, 1] }}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";
