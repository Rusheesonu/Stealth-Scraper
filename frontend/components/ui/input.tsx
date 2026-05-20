"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input. Same radius + chrome as buttons (md = 6px). Defaults to UI font;
 * pass `mono` for URL/selector/ID fields. Focus state lifts the border to
 * `border-strong` rather than throwing on a glow.
 */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  mono?: boolean;
  /** Visual sizing — shadows the native HTML `size` attribute, which is character-count
      and never used in modern layouts. We need `Omit` because string ≠ number. */
  size?: "sm" | "md" | "lg";
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, mono = false, size = "md", ...props }, ref) => {
    const heightCls = size === "sm" ? "h-8 px-2.5 text-[12px]"
      : size === "lg" ? "h-12 px-4 text-[14px]"
      : "h-9 px-3 text-[13px]";
    return (
      <input
        ref={ref}
        className={cn(
          "flex w-full rounded-md bg-[var(--color-surface)] border border-[var(--color-border)]",
          "text-[var(--color-fg)] placeholder:text-[var(--color-fg-subdued)]",
          "transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "hover:border-[var(--color-border-strong)]",
          "focus:border-[var(--color-border-strong)] focus:outline-none focus:bg-[var(--color-elevated)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          mono && "font-mono tracking-[var(--tracking-mono)]",
          heightCls,
          className,
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(
  ({ className, mono = false, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "block w-full rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2.5 text-[13px]",
        "text-[var(--color-fg)] placeholder:text-[var(--color-fg-subdued)]",
        "transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:border-[var(--color-border-strong)]",
        "focus:border-[var(--color-border-strong)] focus:outline-none focus:bg-[var(--color-elevated)]",
        "resize-none",
        mono && "font-mono tracking-[var(--tracking-mono)]",
        className,
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";
