"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { LANGS, type Lang } from "./snippets";

/**
 * Keyboard-navigable segmented control for the six snippet languages.
 *
 * ARIA: implements the `tablist` pattern (left/right arrows move the
 * active tab; Home/End jump to ends). Each tab is `aria-selected` so a
 * screen reader can read the current state. The panel itself is
 * rendered by the page — we don't `id`-link it here because the page
 * only has one tab panel and the visual proximity makes it obvious.
 */
export function LangTabs({
  value,
  onChange,
}: {
  value: Lang;
  onChange: (next: Lang) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKey(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % LANGS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + LANGS.length) % LANGS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = LANGS.length - 1;
    else return;
    e.preventDefault();
    onChange(LANGS[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Snippet language"
      className="flex flex-wrap items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
    >
      {LANGS.map(({ id, label, iconText }, idx) => {
        const active = value === id;
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(e) => handleKey(e, idx)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium",
              "transition-[background,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-line)]",
              active
                ? "bg-[var(--color-elevated)] text-[var(--color-fg-strong)] ring-1 ring-[var(--color-border)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
            )}
          >
            <span
              className={cn(
                "inline-flex h-[18px] min-w-[1.125rem] items-center justify-center rounded-sm px-1 font-mono text-[11px]",
                active
                  ? "bg-[var(--color-accent-faint)] text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent-line)]"
                  : "bg-[var(--color-ink-2)] text-[var(--color-fg-muted)]",
              )}
            >
              {iconText}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
