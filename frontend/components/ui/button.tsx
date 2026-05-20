"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button. Four variants, three sizes. Every variant uses the same radius
 * (md = 6px), same easing, same focus ring. No accent decoration on
 * non-primary variants — accent is reserved for the page's single primary
 * action.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5",
    "rounded-md font-medium tracking-[-0.005em]",
    "transition-[background,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "select-none",
  ].join(" "),
  {
    variants: {
      variant: {
        // Filled white-on-black (Apple-style). The single page-level CTA.
        primary:
          "bg-[var(--color-fg)] text-[var(--color-bg)] hover:bg-[var(--color-fg-strong)]",
        // Subtle accent fill — for "generate", "go" affirmative actions
        // that deserve to be felt but aren't THE primary CTA.
        accent:
          "bg-[var(--color-accent)] text-black hover:brightness-110",
        // Bordered, mostly used for confirmations + side actions.
        secondary:
          "bg-transparent text-[var(--color-fg)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)]",
        // No background, no border — text-only actions inside dense UI.
        ghost:
          "bg-transparent text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)]",
        // Destructive — bordered, muted fill on hover.
        danger:
          "bg-transparent text-[color:var(--color-danger)] border border-[color:var(--color-danger)]/30 hover:bg-[var(--color-danger-dim)] hover:border-[color:var(--color-danger)]/60",
      },
      size: {
        sm: "h-7 px-2.5 text-[12px]",
        md: "h-9 px-3.5 text-[13px]",
        lg: "h-11 px-5 text-[14px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";
