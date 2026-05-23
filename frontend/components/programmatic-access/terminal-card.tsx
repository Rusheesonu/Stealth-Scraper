"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Terminal-styled snippet card.
 *
 * Black bg (`#0a0a0a`), JetBrains Mono via the global `font-mono`
 * stack, soft scrollbar, top bar with faux macOS traffic lights + a
 * compact filename label + a copy button. The body is a plain `<pre>`
 * — no syntax highlighter, intentional. Six languages, no dependency,
 * still readable.
 *
 * Copy contract: clipboard receives the EXACT `code` prop, never the
 * masked variant. Caller is responsible for passing the unmasked text.
 *
 * A11y:
 *  • `aria-label` on the copy button always says what it'll do.
 *  • `<pre>` is keyboard-scrollable (tabindex="0").
 */
export function TerminalCard({
  label,
  code,
  language,
}: {
  /** Label for the top bar — e.g. "curl", "snippet.py". */
  label: string;
  /** The full snippet text — exactly what lands on the clipboard. */
  code: string;
  /** Optional hint for screen readers — "Copy curl snippet". */
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can fail in iframes / insecure contexts. Swallow —
      // user can still select-all-copy from the <pre>.
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {/* Title bar — traffic lights, label, copy. */}
      <div className="flex items-center justify-between border-b border-[#1f1f1f] bg-[#0f0f0f] px-3 py-2">
        <div className="flex items-center gap-2">
          {/* Faux macOS dots — purely decorative, hidden from a11y tree. */}
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#3a3a3a]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#3a3a3a]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#3a3a3a]" />
          </div>
          <span className="ml-1 font-mono text-[11px] tracking-[0.02em] text-[#737373]">
            {label}
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy ${language ?? label} snippet`}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px]",
            "transition-[background,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-line)]",
            copied
              ? "border-[#10b981]/40 bg-[#10b981]/10 text-[#34d399]"
              : "border-[#262626] bg-[#161616] text-[#a3a3a3] hover:border-[#3a3a3a] hover:bg-[#1c1c1c] hover:text-[#e5e5e5]",
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>

      {/* Snippet body. tabindex makes it focusable so the scroll is
          reachable from the keyboard. The `font-mono` token resolves to
          JetBrains Mono via the global stack. */}
      <pre
        tabIndex={0}
        className={cn(
          "terminal-scroll overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-[1.65] text-[#e5e5e5]",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#3a3a3a]",
        )}
      >
        {code}
      </pre>
    </div>
  );
}
