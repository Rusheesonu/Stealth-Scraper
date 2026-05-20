"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, ExternalLink, Edit3, Save, Lock, ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, truncate } from "@/lib/utils";
import type { PublicSnapshotResponse } from "@/lib/api";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Landing-page magic preview — the no-signup demo that proves the product
 * before the signup wall. Rendered inline below the URL form after the
 * visitor pastes a URL and we get a successful /public/snapshot-and-suggest
 * response.
 *
 * Anatomy:
 *   - Window-chrome panel (matches the static demo strip aesthetic)
 *   - Left pane: thumbnail screenshot + page type pill
 *   - Right pane: 3-5 auto-detected fields with live values
 *   - Footer: 3 CTAs (Edit in picker / Get code / Save template) — ALL
 *     trigger the signup flow, which is the whole point. The user has
 *     already seen the value; the signup feels earned.
 *   - Rate-limit microcopy ("2 of 3 free previews used this hour")
 */
type Props = {
  preview: PublicSnapshotResponse;
  originalUrl: string;
  onReset: () => void;
};

const PAGE_TYPE_LABELS: Record<PublicSnapshotResponse["page_type"], string> = {
  ecommerce_product: "looks like a product page",
  ecommerce_listing: "looks like a product listing",
  article: "looks like an article",
  social_feed: "looks like a feed",
  generic: "page detected",
};

export function LandingPreview({ preview, originalUrl, onReset }: Props) {
  const { screenshot, template, sample_values, page_type, title, rate_limit } = preview;
  const [copied, setCopied] = useState(false);

  // Build the "edit in picker" URL — uses the same handoff flow we built
  // for the AI extract page. Picker reads localStorage on mount and
  // pre-fills the fields with an accent ring so the user knows what
  // came from this preview.
  function openInPicker() {
    try {
      localStorage.setItem(
        "picker_ai_prefill",
        JSON.stringify({ url: originalUrl, fields: template }),
      );
    } catch {}
    const norm = encodeURIComponent(originalUrl);
    window.location.href = `/login?next=${encodeURIComponent(`/pick?url=${norm}&prefill=ai`)}`;
  }

  function copyJson() {
    const out: Record<string, unknown> = {};
    template.forEach((f) => {
      out[f.label] = sample_values[f.label] ?? null;
    });
    navigator.clipboard.writeText(JSON.stringify(out, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.4, ease: APPLE_EASE }}
      className="relative mx-auto mt-8 max-w-4xl"
    >
      {/* Subtle "AI-detected page type" eyebrow above the panel */}
      <div className="mb-3 flex items-center justify-between gap-3 text-[11px]">
        <div className="flex items-center gap-1.5 text-[var(--color-fg-muted)]">
          <Sparkles className="h-3 w-3 text-[var(--color-accent)]" />
          <span>{PAGE_TYPE_LABELS[page_type]} — auto-picked {template.length} field{template.length === 1 ? "" : "s"}</span>
        </div>
        <button
          onClick={onReset}
          className="font-mono text-[10.5px] text-[var(--color-fg-subdued)] hover:text-[var(--color-fg)]"
        >
          try another url
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]">
        {/* Window chrome */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mx-auto flex max-w-md items-center gap-1.5 truncate rounded-md bg-[var(--color-surface)] px-3 py-1 font-mono text-[11px] text-[var(--color-fg-muted)]">
              {truncate(originalUrl.replace(/^https?:\/\//, ""), 60)}
            </div>
          </div>
          <Badge tone="success" size="sm">
            <Check className="h-2.5 w-2.5" /> Live
          </Badge>
        </div>

        {/* Two-pane content */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.05fr]">
          {/* Left — screenshot thumbnail */}
          <div className="relative h-[280px] overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-ink-1)] md:border-b-0 md:border-r">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt={title || "page screenshot"}
              className="block h-full w-full object-cover object-top"
              draggable={false}
            />
            {/* Subtle bottom-fade so the truncated screenshot doesn't feel chopped */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--color-ink-1)] to-transparent" />
          </div>

          {/* Right — fields with sample values */}
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                Auto-detected fields
              </div>
              <button
                onClick={copyJson}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-1)] hover:text-[var(--color-fg)]"
                title="Copy as JSON"
              >
                {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                {copied ? "copied" : "json"}
              </button>
            </div>
            {template.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-center text-[12px] text-[var(--color-fg-muted)]">
                We grabbed the page but couldn&apos;t auto-pick fields. Open in
                the picker and click what you want.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {template.map((f, i) => {
                  const value = sample_values[f.label];
                  return (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: 0.1 + i * 0.05, ease: APPLE_EASE }}
                      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5"
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-semibold text-[var(--color-accent)]">
                          {f.label}
                        </span>
                        <Badge tone="muted" size="xs">{f.kind}</Badge>
                      </div>
                      <ValueDisplay value={value} kind={f.kind} />
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Footer CTAs — every one of these requires signup. By the time
            the user clicks one they've already seen value, so the signup
            wall doesn't feel like a wall, it feels like a save action. */}
        <div className="grid grid-cols-1 gap-2 border-t border-[var(--color-border)] bg-[var(--color-ink-1)] p-3 sm:grid-cols-3">
          <CtaButton
            icon={<Edit3 className="h-3.5 w-3.5" />}
            label="Edit in picker"
            subtitle="customize selectors"
            onClick={openInPicker}
            primary
          />
          <CtaButton
            icon={<Save className="h-3.5 w-3.5" />}
            label="Save as template"
            subtitle="reuse on similar pages"
            onClick={openInPicker}
          />
          <CtaButton
            icon={<ExternalLink className="h-3.5 w-3.5" />}
            label="Get code snippet"
            subtitle="python / typescript / curl"
            onClick={openInPicker}
          />
        </div>
      </div>

      {/* Rate limit microcopy */}
      <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-[var(--color-fg-subdued)]">
        <Lock className="h-3 w-3" />
        <span>
          {rate_limit.remaining} of {rate_limit.limit} free previews left this hour ·{" "}
          <Link href="/login?mode=signup" className="font-medium text-[var(--color-accent)] hover:underline">
            sign up free for unlimited
          </Link>
        </span>
      </div>
    </motion.div>
  );
}

function CtaButton({
  icon, label, subtitle, onClick, primary,
}: {
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-[border-color,background,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        primary
          ? "border-[var(--color-fg-strong)] bg-[var(--color-fg-strong)] text-[var(--color-bg)] hover:bg-[var(--color-fg-display)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]",
      )}
    >
      <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-md", primary ? "bg-white/15" : "bg-[var(--color-ink-2)]")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium leading-none">{label}</span>
        <span className={cn("mt-1 block text-[10.5px] leading-none", primary ? "text-white/70" : "text-[var(--color-fg-muted)]")}>
          {subtitle}
        </span>
      </span>
      <ArrowRight className={cn(
        "h-3 w-3 shrink-0 transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5",
        primary ? "text-white/80" : "text-[var(--color-fg-subdued)]",
      )} />
    </button>
  );
}

/**
 * Render a single field's extracted value. Truncates long scalars, expands
 * arrays into first-N rows.
 */
function ValueDisplay({ value, kind }: { value: unknown; kind: string }) {
  if (value === null || value === undefined) {
    return (
      <div className="font-mono text-[11px] text-[var(--color-warning)]">
        null
        <span className="ml-1 text-[10px] text-[var(--color-fg-subdued)]">
          (selector matched no element — edit in picker to fix)
        </span>
      </div>
    );
  }
  if (Array.isArray(value)) {
    const shown = value.slice(0, 3);
    return (
      <div className="space-y-0.5">
        {shown.map((v, i) => (
          <div key={i} className="truncate font-mono text-[11px] text-[var(--color-fg)]">
            <span className="text-[var(--color-fg-subdued)]">{i}.</span>{" "}
            {truncate(String(v), 70)}
          </div>
        ))}
        {value.length > 3 && (
          <div className="font-mono text-[10px] text-[var(--color-fg-subdued)]">
            … +{value.length - 3} more
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="break-words font-mono text-[11.5px] leading-[1.5] text-[var(--color-fg)]">
      {truncate(String(value), 140)}
    </div>
  );
}
