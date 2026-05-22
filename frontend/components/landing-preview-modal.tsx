"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check, Copy, ExternalLink, Edit3, Save, Globe, X,
  Loader2, Sparkles, Lock, AlertTriangle, Cpu, Search, Shield, Wand2,
  ShieldAlert, ArrowUpRight, RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PlanLimitText } from "@/components/plan-limit-text";
import { cn, truncate } from "@/lib/utils";
import type { AntiBotBlockDetail, PublicSnapshotResponse } from "@/lib/api";

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
  /** Structured anti-bot 422 detail. When set, takes precedence over
   *  `error` and renders the dedicated AntiBotBlock card. */
  antiBotBlock?: AntiBotBlockDetail | null;
  /** Optional handler for the anti-bot card's "Try a different URL"
   *  button. When provided, the button clears the form + closes the
   *  modal; otherwise it just closes. */
  onTryDifferentUrl?: () => void;
  onClose: () => void;
};

const PAGE_TYPE_LABELS: Record<PublicSnapshotResponse["page_type"], string> = {
  ecommerce_product: "product page",
  ecommerce_listing: "product listing",
  article: "article",
  social_feed: "feed",
  generic: "page",
};

export function LandingPreviewModal({
  open,
  url,
  preview,
  error,
  antiBotBlock,
  onTryDifferentUrl,
  onClose,
}: Props) {
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
              click out). max-h pegged so very tall results scroll inside.
              Sized for "this is the moment" theatre — wider than a normal
              modal because the loading + result phases both want lots of
              real estate to feel like real software, not a tooltip. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ duration: 0.28, ease: APPLE_EASE }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex w-full max-w-6xl max-h-[92vh] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-[var(--shadow-modal)]"
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
              {antiBotBlock ? (
                <AntiBotBlockPhase
                  key="anti-bot"
                  block={antiBotBlock}
                  onTryDifferentUrl={onTryDifferentUrl ?? onClose}
                />
              ) : error ? (
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
//
// Goal of this phase: justify the wait. First snapshot can take 10–15s
// (cold Chromium tab), which is forever in web-time. Without spectacle
// the visitor closes the tab thinking we hung. With spectacle the wait
// becomes the demo — they see what's happening, watch the schema get
// built in real time, and arrive at the result phase already convinced.

const LOADING_STAGES = [
  { icon: Globe,   text: "Opening a real Chromium browser",        from: 0.0, to: 0.18 },
  { icon: Shield,  text: "Bypassing bot detection",                from: 0.18, to: 0.38 },
  { icon: Cpu,     text: "Capturing page elements",                from: 0.38, to: 0.58 },
  { icon: Search,  text: "Detecting repeating patterns",           from: 0.58, to: 0.75 },
  { icon: Wand2,   text: "Asking AI which fields you want",        from: 0.75, to: 0.92 },
  { icon: Sparkles,text: "Extracting clean values",                from: 0.92, to: 1.0 },
];

// Mock fields revealed in the right-side "Discovered schema" panel as
// the scan progresses. We don't know the real fields until the LLM
// responds — these are realistic placeholders that match what the
// result phase commonly shows for listings (the most popular paste).
// Labels stay generic so they're plausible for any URL pasted.
const MOCK_DISCOVERED_FIELDS = [
  { label: "title",      kind: "list", matches: 10 },
  { label: "primary_value", kind: "list", matches: 10 },
  { label: "metadata",   kind: "list", matches: 8 },
  { label: "image_url",  kind: "list", matches: 10 },
];

// Selectors that float next to the currently-scanned mock card. These
// are intentionally generic shapes so they're believable for any site.
const MOCK_SELECTORS = [
  ".item .title",
  ".card .price",
  ".row .author",
  ".product img",
  ".entry .meta",
];

function LoadingPhase({ url }: { url: string }) {
  // Choreographed progress — runs ~12s worst case. Real snapshot can be
  // faster or slower; if real result arrives, the modal swaps to result
  // phase immediately (loader gets unmounted via AnimatePresence).
  const [t, setT] = useState(0);

  useEffect(() => {
    const TOTAL_MS = 12_000;
    const TICK_MS = 60;
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

  const activeStage =
    LOADING_STAGES.find((s) => t >= s.from && t < s.to)
    ?? LOADING_STAGES[LOADING_STAGES.length - 1];

  // Scanning highlight — cycles through 5 mock rows on the left panel.
  // Independent of overall progress so the scan keeps moving even after
  // t maxes at 0.97 (still gives "we're working" feedback to the user).
  const CARD_COUNT = 5;
  // ~3s per row → full cycle ~15s. Adjust if it feels too fast/slow.
  const activeCard = Math.floor((t * 18)) % CARD_COUNT;

  // Live counters — tick up with progress. tabular-nums in the renderer
  // keeps them from jiggling as digits change.
  const elementCount = Math.floor(t * 247);
  const patternCount = Math.min(4, Math.floor(t * 5));
  // Fields start being "discovered" once we cross into the AI stage.
  const fieldsFoundCount = Math.min(
    MOCK_DISCOVERED_FIELDS.length,
    Math.max(0, Math.floor((t - 0.35) * 7)),
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: APPLE_EASE }}
      className="relative flex min-h-[600px] flex-col p-6 md:p-8"
    >
      {/* Ambient backdrop — dotted grid + accent wash. Sets "this is a
          screen showing real software", not just a spinner on white. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        style={{
          backgroundImage: `radial-gradient(circle, color-mix(in srgb, var(--color-fg-subdued) 30%, transparent) 0.8px, transparent 0.8px)`,
          backgroundSize: "22px 22px",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{ background: "radial-gradient(ellipse at center, var(--color-accent-faint) 0%, transparent 65%)" }}
        aria-hidden
      />

      {/* ── Stage indicator — big, prominent, animated. The "headline" of
          the loading screen. Icon spins in place to signal life even when
          the stage text holds still between transitions. ── */}
      <div className="relative mx-auto mb-6 flex items-center gap-3">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeStage.text}
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            transition={{ duration: 0.32, ease: APPLE_EASE }}
            className="inline-flex items-center gap-3"
          >
            <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent-faint)] ring-1 ring-inset ring-[var(--color-accent-line)]">
              {/* Spinning ring around the icon — subtle, gives "active" feel */}
              <motion.span
                className="absolute inset-0 rounded-xl"
                style={{
                  borderTop: "2px solid var(--color-accent)",
                  borderRight: "2px solid transparent",
                  borderBottom: "2px solid transparent",
                  borderLeft: "2px solid transparent",
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                aria-hidden
              />
              <activeStage.icon className="h-5 w-5 text-[var(--color-accent)]" />
            </span>
            <div className="flex flex-col">
              <span className="text-[19px] font-semibold leading-[1.15] tracking-[-0.012em] text-[var(--color-fg-display)]">
                {activeStage.text}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                stage {LOADING_STAGES.indexOf(activeStage) + 1} of {LOADING_STAGES.length}
              </span>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Main two-column visualization ── */}
      <div className="relative grid flex-1 grid-cols-1 gap-5 md:grid-cols-[1.4fr_1fr]">

        {/* LEFT — mock browser with scanning highlights.
            5 generic placeholder "cards" with skeleton content. A
            colored bounding box hops between them in a loop, and a
            floating CSS-selector chip appears next to the active one.
            Conveys "we're inspecting elements" without needing the
            real page DOM (which we don't have yet anyway). */}
        <div className="relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
          {/* Browser chrome with real URL */}
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-3 py-2">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            </div>
            <div className="flex flex-1 items-center gap-1.5 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
              <Globe className="h-3 w-3 text-[var(--color-fg-subdued)]" />
              {truncate(url.replace(/^https?:\/\//, ""), 55)}
            </div>
            <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--color-accent)]">
              <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
              live
            </span>
          </div>

          {/* Scanning cards */}
          <div className="relative space-y-2 p-3">
            {Array.from({ length: CARD_COUNT }).map((_, i) => (
              <ScanningCard
                key={i}
                active={i === activeCard}
                selector={MOCK_SELECTORS[i % MOCK_SELECTORS.length]}
              />
            ))}

            {/* Sweeping horizontal accent line — adds constant motion
                even when the highlight isn't transitioning */}
            <motion.div
              initial={{ top: "0%" }}
              animate={{ top: ["0%", "100%"] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
              className="pointer-events-none absolute inset-x-3 h-px bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent opacity-60"
              style={{ filter: "blur(0.5px)" }}
              aria-hidden
            />
          </div>
        </div>

        {/* RIGHT — "Discovered schema" panel. Streams in fields one at a
            time as the scan progresses, mimicking a real schema-building
            session. Builds anticipation for the result phase. */}
        <div className="relative flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-ink-1)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
            <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Discovered schema
            </div>
            <div className="font-mono text-[11px] text-[var(--color-fg-muted)]">
              {fieldsFoundCount}/{MOCK_DISCOVERED_FIELDS.length}
            </div>
          </div>
          <div className="flex-1 space-y-2 p-3">
            {MOCK_DISCOVERED_FIELDS.map((f, i) => {
              const found = i < fieldsFoundCount;
              const scanning = i === fieldsFoundCount;
              return (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{
                    opacity: found ? 1 : scanning ? 0.85 : 0.28,
                    x: 0,
                  }}
                  transition={{ duration: 0.32, ease: APPLE_EASE }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md border bg-[var(--color-surface)] px-3 py-2 transition-colors",
                    found
                      ? "border-[var(--color-accent-line)]"
                      : "border-[var(--color-border)]",
                  )}
                >
                  <span className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-md",
                    found ? "bg-[var(--color-accent-faint)]" : "bg-[var(--color-ink-2)]",
                  )}>
                    {found ? (
                      <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                    ) : scanning ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-fg-muted)]" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-subdued)]" />
                    )}
                  </span>
                  <span className={cn(
                    "flex-1 font-mono text-[12.5px] font-medium",
                    found ? "text-[var(--color-fg-strong)]" : "text-[var(--color-fg-muted)]",
                  )}>
                    {f.label}
                  </span>
                  <Badge tone="muted" size="xs">{f.kind}</Badge>
                  {found && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.1, duration: 0.2 }}
                      className="font-mono text-[10.5px] text-[var(--color-accent)]"
                    >
                      ×{f.matches}
                    </motion.span>
                  )}
                </motion.div>
              );
            })}

            {fieldsFoundCount < MOCK_DISCOVERED_FIELDS.length && (
              <div className="flex items-center gap-1.5 pt-1 font-mono text-[11.5px] text-[var(--color-fg-muted)]">
                <span className="inline-flex h-1 w-1 animate-pulse rounded-full bg-[var(--color-fg-subdued)]" />
                scanning more elements…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom strip: stats + progress + caption ── */}
      <div className="relative mt-6 space-y-3">
        {/* Live stat counters — small but moving, completes the
            "real software is processing data" feel */}
        <div className="mx-auto flex max-w-lg items-center justify-center gap-5 font-mono text-[11.5px]">
          <StatCounter label="elements" value={elementCount} />
          <span className="text-[var(--color-fg-subdued)]">·</span>
          <StatCounter label="patterns" value={patternCount} />
          <span className="text-[var(--color-fg-subdued)]">·</span>
          <StatCounter label="fields" value={fieldsFoundCount} />
        </div>

        {/* Wider, gradient-tinted progress bar */}
        <div className="relative mx-auto h-1.5 w-full max-w-2xl overflow-hidden rounded-full bg-[var(--color-border)]">
          <motion.div
            className="h-full rounded-full"
            style={{
              background:
                "linear-gradient(90deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 70%, var(--color-fg-display)) 100%)",
            }}
            animate={{ width: `${Math.round(t * 100)}%` }}
            transition={{ duration: 0.25, ease: APPLE_EASE }}
          />
          {/* Shimmer overlay — moves left→right inside the filled bar */}
          <motion.div
            className="pointer-events-none absolute inset-y-0 w-24 -skew-x-12 opacity-60"
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)",
            }}
            animate={{ x: ["-100%", "500%"] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
            aria-hidden
          />
        </div>

        <p className="mx-auto max-w-md text-center text-[11.5px] leading-[1.55] text-[var(--color-fg-muted)]">
          First load can take 10–15s while we warm a fresh Chromium tab.
          Subsequent scrapes on this site are sub-second.
        </p>
      </div>
    </motion.div>
  );
}

/** One row in the left-panel mock browser. When `active`, gets an accent
 *  ring + a floating CSS-selector chip in the top-right corner. */
function ScanningCard({ active, selector }: { active: boolean; selector: string }) {
  return (
    <div className="relative">
      {/* Highlight ring + selector chip — only mounted when active so
          AnimatePresence + layout transitions feel natural. */}
      <AnimatePresence>
        {active && (
          <motion.div
            layoutId="ss-scan-highlight"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: APPLE_EASE }}
            className="pointer-events-none absolute -inset-[3px] rounded-lg ring-2 ring-[var(--color-accent)]"
            style={{ boxShadow: "0 0 0 4px color-mix(in srgb, var(--color-accent) 18%, transparent)" }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.22, ease: APPLE_EASE }}
            className="absolute -top-2.5 right-2 z-10 inline-flex -translate-y-full items-center gap-1.5 rounded-md bg-[var(--color-fg-strong)] px-2 py-1 font-mono text-[10px] text-[var(--color-bg)] shadow-[var(--shadow-card)]"
          >
            <span className="text-[var(--color-accent)]">▸</span>
            {selector}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Placeholder content — skeleton bars of varying width, plus a
          row of tag-ish chips at the bottom. Doesn't need to match the
          real site; it just has to feel like "card content getting
          inspected". */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
        <div className="mb-2 h-2.5 w-2/3 rounded-sm bg-[var(--color-ink-2)]" />
        <div className="mb-1 h-1.5 w-full rounded-sm bg-[var(--color-ink-1)]" />
        <div className="mb-2 h-1.5 w-4/5 rounded-sm bg-[var(--color-ink-1)]" />
        <div className="flex gap-1.5">
          <span className="h-3 w-10 rounded-sm bg-[var(--color-info-soft)]" />
          <span className="h-3 w-8 rounded-sm bg-[var(--color-warning-soft)]" />
          <span className="h-3 w-12 rounded-sm bg-[var(--color-accent-soft)]" />
        </div>
      </div>
    </div>
  );
}

function StatCounter({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums font-semibold text-[var(--color-fg-strong)]">
        {value}
      </span>
      <span className="text-[var(--color-fg-muted)]">{label}</span>
    </span>
  );
}

// ─── Phase 2: result ────────────────────────────────────────────────────

/**
 * Zip parallel list fields into per-item records — one JSON object per
 * row of extracted data. Far more compelling than "card per field" for
 * the no-signup preview: visitors immediately see the schema they'd get
 * back from the API. The shape is what the SDK would return.
 *
 * Behavior:
 *   - All-list schema (the common listing case) → N records, where N is
 *     the length of the longest list field (capped). Each record gets
 *     one value per field.
 *   - All-scalar schema (single-product / single-article) → one record
 *     with all scalars.
 *   - Mixed → scalars repeat in every record, list values index by row.
 */
const PREVIEW_RECORD_CAP = 8;

/** Same shape-zipping as buildRecords but UNCAPPED — used for "copy JSON"
 *  so the user gets the full extraction in their clipboard, not just the
 *  8 rows we render. */
function buildAllRecords(
  template: PublicSnapshotResponse["template"],
  sample_values: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!template.length) return [];
  let maxLen = 0;
  const entries = template.map((f) => {
    const v = sample_values[f.label];
    const isList = Array.isArray(v);
    if (isList) maxLen = Math.max(maxLen, (v as unknown[]).length);
    return { field: f, isList, value: v };
  });
  if (maxLen === 0) {
    const rec: Record<string, unknown> = {};
    entries.forEach(({ field, value }) => {
      if (value !== undefined) rec[field.label] = value;
    });
    return [rec];
  }
  const records: Record<string, unknown>[] = [];
  for (let i = 0; i < maxLen; i++) {
    const rec: Record<string, unknown> = {};
    entries.forEach(({ field, isList, value }) => {
      if (isList) {
        const arr = value as unknown[];
        if (i < arr.length) rec[field.label] = arr[i];
      } else {
        rec[field.label] = value;
      }
    });
    records.push(rec);
  }
  return records;
}

function buildRecords(
  template: PublicSnapshotResponse["template"],
  sample_values: Record<string, unknown>,
): { records: Record<string, unknown>[]; totalRecords: number } {
  if (!template.length) return { records: [], totalRecords: 0 };

  let maxLen = 0;
  const entries = template.map((f) => {
    const v = sample_values[f.label];
    const isList = Array.isArray(v);
    if (isList) maxLen = Math.max(maxLen, (v as unknown[]).length);
    return { field: f, isList, value: v };
  });

  // Pure-scalar schema: one record with everything.
  if (maxLen === 0) {
    const rec: Record<string, unknown> = {};
    entries.forEach(({ field, value }) => {
      if (value !== undefined) rec[field.label] = value;
    });
    return { records: [rec], totalRecords: 1 };
  }

  const totalRecords = maxLen;
  const shown = Math.min(maxLen, PREVIEW_RECORD_CAP);
  const records: Record<string, unknown>[] = [];
  for (let i = 0; i < shown; i++) {
    const rec: Record<string, unknown> = {};
    entries.forEach(({ field, isList, value }) => {
      if (isList) {
        const arr = value as unknown[];
        if (i < arr.length) rec[field.label] = arr[i];
      } else {
        // Scalars repeat in every record so each row is a complete object.
        rec[field.label] = value;
      }
    });
    records.push(rec);
  }
  return { records, totalRecords };
}

function ResultPhase({
  preview, originalUrl, onClose,
}: { preview: PublicSnapshotResponse; originalUrl: string; onClose: () => void }) {
  const { screenshot, template, sample_values, page_type, rate_limit } = preview;
  const [copied, setCopied] = useState(false);

  const { records, totalRecords } = useMemo(
    () => buildRecords(template, sample_values),
    [template, sample_values],
  );

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
    // Copy the FULL extraction (uncapped) so the user gets every row,
    // not just the preview-visible ones. Build from raw sample_values
    // straight from the API response.
    const fullRecords = buildAllRecords(template, sample_values);
    const payload = fullRecords.length === 1 ? fullRecords[0] : fullRecords;
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
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

          {/* JSON records — one block per item, syntax-highlighted. This
              shows the schema the API would actually return, which is far
              more compelling for the technical audience than per-field
              cards. "One block per product" feel. */}
          <div className="overflow-y-auto p-5 md:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                <span>Live extraction</span>
                <span>·</span>
                <span className="text-[var(--color-accent)]">
                  {totalRecords} {totalRecords === 1 ? "record" : "records"}
                </span>
              </div>
              <button
                onClick={copyJson}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-[10.5px] text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-1)] hover:text-[var(--color-fg)]"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "copied" : "copy all"}
              </button>
            </div>

            {template.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] p-5 text-center text-[12.5px] text-[var(--color-fg-muted)]">
                We grabbed the page but couldn&apos;t auto-pick fields. Open in
                the picker and click what you want.
              </div>
            ) : (
              <div className="space-y-2.5">
                {records.map((rec, i) => (
                  <JsonRecord key={i} record={rec} index={i} />
                ))}
                {totalRecords > records.length && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.1 + records.length * 0.05 }}
                    className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-ink-1)] px-3 py-2.5 text-center font-mono text-[11px] text-[var(--color-fg-muted)]"
                  >
                    <Lock className="h-3 w-3 text-[var(--color-fg-subdued)]" />
                    <span>
                      +{totalRecords - records.length} more rows —{" "}
                      <Link
                        href="/login?mode=signup"
                        className="font-medium text-[var(--color-accent)] hover:underline"
                      >
                        sign up free to unlock
                      </Link>
                    </span>
                  </motion.div>
                )}
              </div>
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

/** One extracted record rendered as syntax-highlighted JSON. */
function JsonRecord({ record, index }: { record: Record<string, unknown>; index: number }) {
  const entries = Object.entries(record);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: 0.05 + index * 0.05, ease: APPLE_EASE }}
      className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
    >
      {/* Tiny header strip — record index + accent dot. Makes each card
          feel like a "row" not just a block of code. */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-3 py-1.5">
        <div className="flex items-center gap-1.5 font-mono text-[11.5px] text-[var(--color-fg-muted)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          <span>record {String(index + 1).padStart(2, "0")}</span>
        </div>
        <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">
          {entries.length} {entries.length === 1 ? "field" : "fields"}
        </span>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-[1.65] text-[var(--color-fg)]">
        <span className="text-[var(--color-fg-subdued)]">{"{"}</span>
        {"\n"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {"  "}
            <span className="text-[var(--color-accent)]">&quot;{k}&quot;</span>
            <span className="text-[var(--color-fg-subdued)]">: </span>
            <JsonValue value={v} />
            {i < entries.length - 1 && <span className="text-[var(--color-fg-subdued)]">,</span>}
            {"\n"}
          </span>
        ))}
        <span className="text-[var(--color-fg-subdued)]">{"}"}</span>
      </pre>
    </motion.div>
  );
}

/** Render a single JSON value with subtle color coding by type. Truncates
 *  long strings and array previews so a wall of text doesn't blow up the
 *  layout — the user signs up to see full content. */
function JsonValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-[var(--color-warning)]">null</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-[var(--color-info)]">{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="text-[var(--color-info)]">{value}</span>;
  }
  if (Array.isArray(value)) {
    const shown = value.slice(0, 5);
    return (
      <span>
        <span className="text-[var(--color-fg-subdued)]">[</span>
        {shown.map((v, i) => (
          <span key={i}>
            <JsonValue value={v} />
            {i < shown.length - 1 && <span className="text-[var(--color-fg-subdued)]">, </span>}
          </span>
        ))}
        {value.length > 5 && (
          <span className="text-[var(--color-fg-subdued)]">
            , … +{value.length - 5}
          </span>
        )}
        <span className="text-[var(--color-fg-subdued)]">]</span>
      </span>
    );
  }
  // string
  const s = String(value);
  const trimmed = truncate(s, 220);
  return (
    <span className="text-[var(--color-success)]">
      &quot;{trimmed}&quot;
    </span>
  );
}

function BigValueDisplay({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div className="font-mono text-[12.5px] text-[var(--color-warning)]">
        null
        <span className="ml-1 text-[11px] text-[var(--color-fg-subdued)]">
          (open in picker to fix)
        </span>
      </div>
    );
  }
  if (Array.isArray(value)) {
    // Heuristic: short array items (tags, keywords) get no truncation —
    // they're meant to be scannable. Long items (quote text, post bodies)
    // get a generous limit (was 100 → 220) so the user can actually read
    // what we extracted instead of seeing "…" mid-word.
    const allShort = value.every((v) => String(v ?? "").length <= 32);
    const shown = value.slice(0, allShort ? 8 : 4);
    return (
      <div className={cn(allShort ? "flex flex-wrap gap-1.5" : "space-y-1.5")}>
        {shown.map((v, i) => {
          const text = String(v ?? "");
          if (allShort) {
            return (
              <span
                key={i}
                className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-ink-1)] px-1.5 py-0.5 font-mono text-[11.5px] text-[var(--color-fg)]"
              >
                {text}
              </span>
            );
          }
          return (
            <div
              key={i}
              className="break-words font-mono text-[12.5px] leading-[1.55] text-[var(--color-fg)]"
            >
              <span className="text-[var(--color-fg-subdued)]">{i + 1}.</span>{" "}
              {truncate(text, 220)}
            </div>
          );
        })}
        {value.length > shown.length && (
          <div className="font-mono text-[11px] text-[var(--color-fg-subdued)]">
            … +{value.length - shown.length} more
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="break-words font-mono text-[13.5px] leading-[1.6] text-[var(--color-fg)]">
      {truncate(String(value), 340)}
    </div>
  );
}

// ─── Anti-bot block phase ───────────────────────────────────────────────
//
// Renders the structured 422 anti_bot_block detail returned by
// /public/snapshot-and-suggest when a vendor (Cloudflare, DataDome,
// PerimeterX…) intercepted us before the real page loaded. We get a
// vendor name, a human message and a remediation suggestion from the
// backend — surface them as a designed card, not raw JSON.
//
// Visual: feels like part of the product (matches LoadingPhase ambient
// backdrop + card primitives), not an OS-level alert. Headline is
// vendor-specific so it reads like a diagnosis, not an error.

/** Capitalize vendor strings like "cloudflare" → "Cloudflare". Leaves
 *  acronyms / mixed-case vendors alone. */
function formatVendor(vendor: string): string {
  if (!vendor) return "A bot manager";
  if (vendor.length <= 3) return vendor.toUpperCase();
  return vendor.charAt(0).toUpperCase() + vendor.slice(1);
}

function AntiBotBlockPhase({
  block,
  onTryDifferentUrl,
}: {
  block: AntiBotBlockDetail;
  onTryDifferentUrl: () => void;
}) {
  const vendorLabel = formatVendor(block.vendor);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: APPLE_EASE }}
      className="relative flex min-h-[420px] flex-col items-center justify-center p-8 md:p-10"
    >
      {/* Ambient backdrop — same pattern as LoadingPhase, but with a
          warning-tinted wash instead of accent so the card reads as
          "heads up" without screaming "error". */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]"
        style={{
          backgroundImage: `radial-gradient(circle, color-mix(in srgb, var(--color-fg-subdued) 30%, transparent) 0.8px, transparent 0.8px)`,
          backgroundSize: "22px 22px",
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse at center, color-mix(in srgb, var(--color-warning) 12%, transparent) 0%, transparent 60%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex w-full max-w-lg flex-col items-center text-center">
        {/* Icon — bordered tile, warning palette. Matches the Loading
            stage indicator visual language so the modal feels coherent
            between phases. */}
        <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-warning-soft)] ring-1 ring-inset ring-[color:var(--color-warning)]/30">
          <ShieldAlert className="h-6 w-6 text-[var(--color-warning)]" />
        </span>

        <Badge tone="muted" size="sm" className="mb-3">
          <span className="font-mono uppercase tracking-wider">
            {block.is_behavioral ? "behavioral challenge" : "bot wall"}
          </span>
          {" · "}
          <span className="font-mono">{block.vendor}</span>
        </Badge>

        <h3 className="text-[20px] font-semibold leading-[1.2] tracking-[-0.012em] text-[var(--color-fg-display)]">
          {vendorLabel} blocked this site
        </h3>

        <p className="mt-2 max-w-md text-[13.5px] leading-[1.6] text-[var(--color-fg-muted)]">
          {block.message ||
            `${vendorLabel}'s bot manager intercepted the request before the real page loaded.`}
        </p>

        {/* Suggestion callout — accent-tinted card, distinct from the
            message paragraph so the actionable advice doesn't blur with
            the diagnosis. */}
        {block.suggestion && (
          <div className="mt-5 w-full rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-faint)] p-3.5 text-left">
            <div className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-accent)]">
              <Sparkles className="h-3 w-3" />
              How to get past this
            </div>
            <p className="text-[12.5px] leading-[1.55] text-[var(--color-fg)]">
              {block.suggestion}
            </p>
          </div>
        )}

        {/* Action row — primary "Try a different URL" (clears form +
            closes), secondary "Upgrade to Pro" (residential proxies are
            paywalled). Both buttons feel like product, not alert. */}
        <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row">
          <button
            onClick={onTryDifferentUrl}
            className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-[13px] font-medium text-[var(--color-fg)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Try a different URL
          </button>
          <Link
            href="/pricing?reason=anti-bot"
            className="group inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--color-fg-strong)] px-4 text-[13px] font-medium text-[var(--color-bg)] hover:bg-[var(--color-fg-display)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Upgrade to Pro
            <ArrowUpRight className="h-3.5 w-3.5 opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </Link>
        </div>

        <p className="mt-3 text-[11px] leading-[1.5] text-[var(--color-fg-subdued)]">
          Pro plans include residential proxies that solve most anti-bot
          walls automatically.
        </p>
      </div>
    </motion.div>
  );
}

// ─── Error phase ────────────────────────────────────────────────────────

function ErrorPhase({ error, onClose }: { error: string; onClose: () => void }) {
  // Detect plan-limit specifically so we can give a more useful headline
  // + a primary CTA that actually upgrades, not just dismisses. Pattern
  // matches both the backend's "free plan limit" wording and our own
  // upper-cased "Plan limit:" prefix from api.ts.
  const lower = error.toLowerCase();
  const isPlanLimit =
    lower.includes("plan limit") ||
    lower.includes("scrapes this month") ||
    lower.includes("/pricing");

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
        {isPlanLimit ? "You're out of free scrapes" : "Couldn't snapshot that page"}
      </h3>
      <PlanLimitText
        text={error}
        className="mt-1.5 max-w-md text-[13px] leading-[1.6] text-[var(--color-fg-muted)]"
      />
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {isPlanLimit && (
          <Link
            href="/pricing"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-fg-strong)] px-4 text-[13px] font-medium text-[var(--color-bg)] hover:bg-[var(--color-fg-display)]"
          >
            See pricing
          </Link>
        )}
        <button
          onClick={onClose}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-[13px] font-medium",
            isPlanLimit
              ? "border border-[var(--color-border)] text-[var(--color-fg)] hover:bg-[var(--color-ink-1)]"
              : "bg-[var(--color-fg-strong)] text-[var(--color-bg)] hover:bg-[var(--color-fg-display)]",
          )}
        >
          {isPlanLimit ? "Close" : "Try another URL"}
        </button>
      </div>
    </motion.div>
  );
}
