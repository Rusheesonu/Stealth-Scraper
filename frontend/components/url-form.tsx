"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Signature component. The URL paste input that IS the hero affordance on
 * landing and the empty state on /pick. Inline submit button on the right.
 * Mono font for the URL. Generous height. Border lifts on focus, not glow.
 */
export function UrlForm({
  size = "lg",
  autoFocus = false,
  placeholder = "https://...",
  hint,
}: {
  size?: "md" | "lg";
  autoFocus?: boolean;
  placeholder?: string;
  hint?: React.ReactNode;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let value = url.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) value = "https://" + value;
    setBusy(true);
    router.push(`/pick?url=${encodeURIComponent(value)}`);
  }

  const heightCls = size === "lg" ? "h-14" : "h-12";
  const textCls = size === "lg" ? "text-[15px]" : "text-[14px]";
  const btnCls = size === "lg" ? "h-10 px-4 text-[13px]" : "h-9 px-3.5 text-[12px]";

  return (
    <div className="w-full">
      <form
        onSubmit={submit}
        className={cn(
          "group relative flex items-center w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]",
          "transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "focus-within:border-[var(--color-border-strong)] focus-within:bg-[var(--color-elevated)]",
          heightCls,
        )}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={placeholder}
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          className={cn(
            "flex-1 bg-transparent pl-5 pr-2 font-mono tracking-[var(--tracking-mono)]",
            "text-[var(--color-fg)] placeholder:text-[var(--color-fg-subdued)]",
            "focus:outline-none",
            textCls,
          )}
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className={cn(
            "mr-2 inline-flex items-center gap-1.5 rounded-md font-medium",
            "bg-[var(--color-fg)] text-[var(--color-bg)]",
            "hover:bg-[var(--color-fg-strong)]",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "transition-[background,opacity] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            btnCls,
          )}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
          Snapshot
        </button>
      </form>
      {hint && (
        <div className="mt-3 text-center text-[12px] text-[var(--color-fg-subdued)]">
          {hint}
        </div>
      )}
    </div>
  );
}
