"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * Signature component. The URL paste input that IS the hero affordance on
 * landing and the empty state on /pick.
 *
 * Apple touches:
 *  • Border lifts on focus (no glow blob).
 *  • Submit button presses inward on tap (motion whileTap).
 *  • Accent rim fades in when the field has a valid URL — feedback that
 *    the action is ready, not a static button that always looks the same.
 *  • Mono font for the URL (it's data, not prose).
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
  const [focused, setFocused] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let value = url.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) value = "https://" + value;
    setBusy(true);
    router.push(`/pick?url=${encodeURIComponent(value)}`);
  }

  const heightCls = size === "lg" ? "h-14" : "h-12";
  const textCls = size === "lg" ? "text-[14px]" : "text-[14px]";
  const btnCls = size === "lg" ? "h-10 px-4 text-[13px]" : "h-9 px-3.5 text-[13px]";

  const valid = url.trim().length > 0;

  return (
    <div className="w-full">
      <motion.form
        onSubmit={submit}
        animate={{
          // Three states, three borders: idle (light), hovered (medium),
          // focused (text-dark). One ring only — no inner shadow ever.
          borderColor: focused
            ? "var(--color-fg)"
            : "var(--color-border)",
        }}
        whileHover={focused ? undefined : { borderColor: "var(--color-border-strong)" }}
        transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
        className={cn(
          "relative flex items-center w-full rounded-xl border bg-[var(--color-surface)]",
          heightCls,
        )}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
        <motion.button
          type="submit"
          disabled={busy || !valid}
          whileTap={valid && !busy ? { scale: 0.96 } : undefined}
          animate={{
            backgroundColor: valid
              ? "var(--color-fg-strong)"
              : "var(--color-ink-4)",
            opacity: valid ? 1 : 0.55,
          }}
          transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
          className={cn(
            "mr-2 inline-flex items-center gap-1.5 rounded-md font-medium",
            "text-[var(--color-bg)]",
            "disabled:cursor-not-allowed",
            btnCls,
          )}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
          Snapshot
        </motion.button>
      </motion.form>
      {hint && (
        <div className="mt-3 text-center text-[13px] text-[var(--color-fg-subdued)]">
          {hint}
        </div>
      )}
    </div>
  );
}
