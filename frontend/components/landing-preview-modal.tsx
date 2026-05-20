"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, Copy, ExternalLink, Edit3, Save, Globe, X,
  Loader2, Sparkles, Lock, AlertTriangle, Cpu, Search, Shield, Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, truncate } from "@/lib/utils";
import type { PublicSnapshotResponse } from "@/lib/api";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Full-screen-ish modal for the magic-snapshot demo. Replaces the inline
 * preview because:
 *   - Inline gave the demo the worst real estate on the page (cramped
 *     by the hero's narrow container)
 *   - Loading time (10-15s on cold start) became dead air. In a modal
 *     it becomes a dramatic 'something cool is happening' moment.
 *   - The modal becomes the screenshot — demo videos look 10x better
 *     because the result fills the frame instead of being a corner.
 *
 * Two phases:
 *   Phase 1 — LOADING: scraping animation with status messages cycling
 *     through real backend steps (load page → bypass bots → detect →
 *     extract). The messages are choreographed timing, not real progress
 *     events (the backend doesn't stream those yet), but they reflect
 *     what's actually happening in roughly the right order.
 *   Phase 2 — RESULT: large preview. Screenshot on left, big field
 *     cards with actual extracted values on right, three CTAs at bottom.
 *     Same content as the old inline version, just with breathing room
 *     and impact.
 */

type Props = {
  open: boolean;
  url: string;
  /** When set, we're in result-phase. When null, we're loading. */
  preview: PublicSnapshotResponse | null;
  /** Friendly error to show inside the modal (so we don't kick the user
   *  back to the form and lose context). Null = no error. */
  error: string | null;
  onClose: () => void;
};

const PAGE_TYPE_LABELS: Record<PublicSnapshotResponse["page_type"], string> = {
  ecommerce_product: "product page",
  ecommerce_listing: "product listing",
  article: "article",
  social_feed: "feed",
  generic: "page",
};

export function LandingPreviewModal({ open, url, preview, error, onClose }: Props) {
  // Lock body scroll while open + ESC to close. (Same pattern as the
  // generic Modal primitive in motion-primitives.tsx — but reimplemented
  // here so we can size the modal differently and host the two-phase UI.)
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: APPLE_EASE }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8"
          onClick={onClose}
        >
          {/* Backdrop — heavier than other modals because this IS the
              focus moment. Dark, slightly blurred. */}
          <div
            className="absolute inset-0"
            style={{
              background: "color-mix(in srgb, var(--color-ink-9) 48%, transparent)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          />

          {/* Modal body — large, not full-screen (so user feels they can
              click out). max-h pegged so very tall results scroll inside. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.28, ease: APPLE_EASE }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-full max-w-5xl max-h-[88vh] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-[var(--shadow-modal)]"
          >
            {/* Close button — top right */}
            <button
              onClick={onClose}
              aria-label="Close preview"
              className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
            >
              <X className="h-4 w-4" />
            </button>

            <AnimatePresence mode="wait">
              {error ? (
                <ErrorPhase key="error" error={error} onClose={onClose} />
              ) : !preview ? (
                <LoadingPhase key="loading" url={url} />
              ) : (
                <ResultPhase key="result" preview={preview} originalUrl={url} onClose={onClose} />
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Phase 1: loading ────────────────────────────────────────────────────

const LOADING_STAGES = [
  { icon: Globe,   text: "Opening a real Chromium…",        from: 0.0, to: 0.18 },
  { icon: Shield,  text: "Bypassing bot detection…",        from: 0.18, to: 0.38 },
  { icon: Cpu,     text: "Capturing page elements…",        from: 0.38, to: 0.58 },
  { icon: Search,  text: "Detecting repeating patterns…",   from: 0.58, to: 0.75 },
  { icon: Wand2,   text: "Asking AI which fields you want…", from: 0.75, to: 0.92 },
  { icon: Sparkles,text: "Extracting clean values…",        from: 0.92, to: 1.0 },
];

function LoadingPhase({ url }: { url: string }) {
  // Choreographed progress — runs ~12s worst case. Real snapshot can be
  // faster or slower; if real result arrives, the modal swaps to result
  // phase immediately (loader gets unmounted via AnimatePresence).
  const [t, setT] = useState(0);

  useEffect(() => {
    const TOTAL_MS = 12_000;
    const TICK_MS = 80;
    let raf: number;
    const start = performance.now();
    function tick() {
      const elapsed = performance.now() - start;
      const next = Math.min(0.97, elapsed / TOTAL_MS);  // cap at 97% — never "finish" until result arrives
      setT(next);
      if (next < 0.97) raf = window.setTimeout(tick, TICK_MS) as unknown as number;
    }
    tick();
    return () => clearTimeout(raf);
  }, []);

  const activeStage = LOADING_STAGES.find((s) => t >= s.from && t < s.to) ?? LOADING_STAGES[LOADING_STAGES.length - 1];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: APPLE_EASE }}
      className="relative flex min-h-[440px] flex-col items-center justify-center p-10 md:p-14"
    >
      {/* Subtle ambient accent wash */}
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{ background: "radial-gradient(ellipse at center, var(--color-accent-faint) 0%, transparent 60%)" }}
        aria-hidden
      />

      {/* Top mini browser chrome — anchors the visual to "we're scraping a real page" */}
      <div className="relative mb-8 w-full max-w-md overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-3 py-1.5">
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
            <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
            <span className="h-2 w-2 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex flex-1 items-center gap-1.5 truncate font-mono text-[10.5px] text-[var(--color-fg-muted)]">
            <Globe className="h-2.5 w-2.5 text-[var(--color-fg-subdued)]" />
            {truncate(url.replace(/^https?:\/\//, ""), 50)}
          </div>
        </div>
        {/* Animated "scan line" inside the chrome — simulates extraction */}
        <div className="relative h-16 overflow-hidden bg-[var(--color-ink-1)]">
          {/* Skeleton rows */}
          <div className="space-y-1.5 px-3 py-2">
            <div className="h-1.5 w-3/4 rounded-sm bg-[var(--color-ink-2)]" />
            <div className="h-1.5 w-1/2 rounded-sm bg-[var(--color-ink-2)]" />
            <div className="h-1.5 w-5/6 rounded-sm bg-[var(--color-ink-2)]" />
          </div>
          {/* Sweeping accent line */}
          <motion.div
            initial={{ y: -4, opacity: 0 }}
            animate={{ y: [0, 64, 0], opacity: [0, 1, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent"
          />
        </div>
      </div>

      {/* Stage label — the entertaining bit */}
      <div className="relative flex items-center gap-2.5">
        <AnimatePresence mode="wait">
          <motion.span
            key={activeStage.text}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: APPLE_EASE }}
            className="inline-flex items-center gap-2.5"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-accent-faint)] ring-1 ring-inset ring-[var(--color-accent-line)]">
              <activeStage.icon className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            </span>
            <span className="text-[15px] font-medium tracking-[-0.005em] text-[var(--color-fg-strong)]">
              {activeStage.text}
            </span>
          </motion.span>
        </AnimatePresence>
      </div>

      {/* Progress bar — visual confirmation that something IS happening */}
      <div className="relative mt-8 h-1 w-full max-w-md overflow-hidden rounded-full bg-[var(--color-border)]">
        <motion.div
          className="h-full rounded-full bg-[var(--color-accent)]"
          animate={{ width: `${Math.round(t * 100)}%` }}
          transition={{ duration: 0.25, ease: APPLE_EASE }}
        />
      </div>

      {/* Footer caption — context + reassurance */}
      <p className="relative mt-6 max-w-md text-center text-[11.5px] leading-[1.55] text-[var(--color-fg-muted)]">
        First load can take 10–15s while we warm a fresh Chromium tab. Subsequent
        scrapes on this site are sub-second.
      </p>
    </motion.div>
  );
}

// ─── Phase 2: result ────────────────────────────────────────────────────

function ResultPhase({
  preview, originalUrl, onClose,
}: { preview: PublicSnapshotResponse; originalUrl: string; onClose: () => void }) {
  const { screenshot, template, sample_values, page_type, rate_limit } = preview;
  const [copied, setCopied] = useState(false);

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
    template.forEach((f) => { out[f.label] = sample_values[f.label] ?? null; });
    navigator.clipboard.writeText(JSON.stringify(out, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: APPLE_EASE }}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      {/* Header band */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 pr-12">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone="success" size="sm">
            <Check className="h-2.5 w-2.5" /> Live
          </Badge>
          <Badge tone="accent" size="sm">
            <Sparkles className="h-2.5 w-2.5" />
            {PAGE_TYPE_LABELS[page_type]} · auto-picked {template.length} fields
          </Badge>
          <span className="truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
            {truncate(originalUrl.replace(/^https?:\/\//, ""), 50)}
          </span>
        </div>
      </div>

      {/* Body — two panes, scrollable inside */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="grid w-full grid-cols-1 md:grid-cols-[1fr_1.15fr]">
          {/* Screenshot — bigger now that we have the real estate */}
          <div className="relative overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-ink-1)] md:border-b-0 md:border-r">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt="page screenshot"
              className="block h-full max-h-[60vh] w-full object-cover object-top"
              draggable={false}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--color-ink-1)] to-transparent" />
          </div>

          {/* Fields — big enough to actually read this time */}
          <div className="overflow-y-auto p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                Auto-detected fields
              </div>
              <button
                onClick={copyJson}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10.5px] text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-1)] hover:text-[var(--color-fg)]"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "copied" : "copy json"}
              </button>
            </div>

            {template.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] p-5 text-center text-[12.5px] text-[var(--color-fg-muted)]">
                We grabbed the page but couldn&apos;t auto-pick fields. Open in
                the picker and click what you want.
              </div>
            ) : (
              <ul className="space-y-2">
                {template.map((f, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 + i * 0.06, ease: APPLE_EASE }}
                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3"
                  >
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <span className="font-mono text-[13px] font-semibold text-[var(--color-accent)]">
                        {f.label}
                      </span>
                      <Badge tone="muted" size="xs">{f.kind}</Badge>
                    </div>
                    <BigValueDisplay value={sample_values[f.label]} />
                  </motion.li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Footer — CTAs */}
      <div className="flex-shrink-0 border-t border-[var(--color-border)] bg-[var(--color-ink-1)] p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
        <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-[var(--color-fg-subdued)]">
          <Lock className="h-3 w-3" />
          <span>
            {rate_limit.remaining} of {rate_limit.limit} free previews left this hour ·{" "}
            <Link href="/login?mode=signup" className="font-medium text-[var(--color-accent)] hover:underline">
              sign up free for unlimited
            </Link>
          </span>
        </div>
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
    </button>
  );
}

function BigValueDisplay({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div className="font-mono text-[12px] text-[var(--color-warning)]">
        null
        <span className="ml-1 text-[10.5px] text-[var(--color-fg-subdued)]">
          (open in picker to fix)
        </span>
      </div>
    );
  }
  if (Array.isArray(value)) {
    const shown = value.slice(0, 4);
    return (
      <div className="space-y-1">
        {shown.map((v, i) => (
          <div key={i} className="truncate font-mono text-[12px] text-[var(--color-fg)]">
            <span className="text-[var(--color-fg-subdued)]">{i}.</span>{" "}
            {truncate(String(v), 100)}
          </div>
        ))}
        {value.length > 4 && (
          <div className="font-mono text-[10.5px] text-[var(--color-fg-subdued)]">
            … +{value.length - 4} more
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="break-words font-mono text-[13px] leading-[1.55] text-[var(--color-fg)]">
      {truncate(String(value), 220)}
    </div>
  );
}

// ─── Error phase ────────────────────────────────────────────────────────

function ErrorPhase({ error, onClose }: { error: string; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: APPLE_EASE }}
      className="flex min-h-[360px] flex-col items-center justify-center p-10 text-center"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-danger-soft)] ring-1 ring-inset ring-[color:var(--color-danger)]/30">
        <AlertTriangle className="h-5 w-5 text-[var(--color-danger)]" />
      </div>
      <h3 className="text-[16px] font-semibold tracking-[-0.005em] text-[var(--color-fg-strong)]">
        Couldn&apos;t snapshot that page
      </h3>
      <p className="mt-1.5 max-w-md text-[12.5px] leading-[1.55] text-[var(--color-fg-muted)]">
        {error}
      </p>
      <button
        onClick={onClose}
        className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-fg-strong)] px-4 text-[13px] font-medium text-[var(--color-bg)] hover:bg-[var(--color-fg-display)]"
      >
        Try another URL
      </button>
    </motion.div>
  );
}
