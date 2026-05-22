"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MousePointer2, Sparkles, FileJson } from "lucide-react";
import { cn } from "@/lib/utils";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Animated 3-step demo that shows the click flow itself (not just the
 * outcome like the static hero demo). Solves the audit gap: 'static demo
 * shows result but not the click flow.'
 *
 * Auto-advances every 3.5s, loops. User can also click step tabs to jump.
 *
 * The animation isn't a video — it's a real React+framer composition,
 * which means it's:
 *   - ~6KB instead of a ~2MB GIF/video
 *   - perfectly sharp at any DPR
 *   - re-themeable on dark/light without re-encoding
 *   - editable when copy changes (no Loom re-record)
 *
 * Pattern stolen from Linear's homepage / Vercel's product loops.
 */

const SAMPLE_ROWS = [
  { title: "Show HN: A tool for AI agents to scrape any website", points: 412 },
  { title: "Cloudflare's new bot defense is breaking the open web", points: 287 },
  { title: "We replaced our Selenium farm with CDP patches", points: 198 },
];

type Step = 0 | 1 | 2;

export function ClickFlowDemo() {
  const [step, setStep] = useState<Step>(0);

  // Auto-advance loop. 2.5s per step — fast enough to keep attention,
  // slow enough to read the caption. Manual tab clicks restart the
  // timer so users can pause + study any step.
  useEffect(() => {
    const t = setTimeout(() => {
      setStep(((step + 1) % 3) as Step);
    }, 2500);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <section className="relative mx-auto max-w-5xl py-10 md:py-14">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.4, ease: APPLE_EASE }}
        className="mb-7 text-center"
      >
        <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          <MousePointer2 className="h-3 w-3 text-[var(--color-accent)]" />
          The 3-step flow
        </div>
        <h2 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.018em] text-[var(--color-fg-display)] sm:text-[32px]">
          Watch what 15 seconds looks like
          <span className="text-[var(--color-fg-muted)]"> when scraping is visual.</span>
        </h2>
      </motion.div>

      {/* Step tabs */}
      <div className="mb-4 flex items-center justify-center gap-1.5">
        {[
          { id: 0, label: "1. Snapshot the page" },
          { id: 1, label: "2. Click fields" },
          { id: 2, label: "3. Save the recipe" },
        ].map((s) => (
          <button
            key={s.id}
            onClick={() => setStep(s.id as Step)}
            className={cn(
              "rounded-full px-3 py-1 text-[11.5px] font-medium",
              "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              step === s.id
                ? "bg-[var(--color-fg-strong)] text-[var(--color-bg)]"
                : "bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] ring-1 ring-inset ring-[var(--color-border)]",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Stage */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ duration: 0.45, delay: 0.05, ease: APPLE_EASE }}
        className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]"
      >
        {/* Window chrome */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="mx-auto flex max-w-md items-center gap-1.5 rounded-md bg-[var(--color-surface)] px-3 py-1 font-mono text-[11px] text-[var(--color-fg-muted)]">
            news.ycombinator.com
          </div>
          <div className="font-mono text-[11px] text-[var(--color-fg-muted)]">
            step {step + 1}/3
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr]">
          {/* Page area — when the cursor clicks ONE title, the highlight
              animates across ALL matching titles in sequence, showing
              "list mode" — that's the wow moment. Same for points. */}
          <div className="relative h-[300px] border-b border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:border-b-0 md:border-r">
            <ul className="space-y-2.5">
              {SAMPLE_ROWS.map((row, i) => {
                // Cascading highlight: row 0 lights up first (where the cursor
                // clicked), then rows 1 + 2 light up sequentially with a 80ms
                // stagger. Shows the user "click one, get them all."
                const titleStagger = 0.5 + i * 0.08;
                const pointsStagger = 1.4 + i * 0.08;
                const titleHighlighted = step >= 1;
                const pointsHighlighted = step >= 1;
                return (
                  <li key={i} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <div className="text-[12.5px] leading-[1.45] text-[var(--color-fg)]">
                      <motion.span
                        initial={{
                          backgroundColor: "transparent",
                          boxShadow: "0 0 0 0px transparent inset",
                        }}
                        animate={titleHighlighted ? {
                          backgroundColor: "var(--color-accent-soft)",
                          boxShadow: "0 0 0 1px var(--color-accent-line) inset",
                        } : {
                          backgroundColor: "transparent",
                          boxShadow: "0 0 0 0px transparent inset",
                        }}
                        transition={{ duration: 0.22, delay: titleStagger, ease: APPLE_EASE }}
                        className="rounded-sm px-0.5 py-px"
                      >
                        {row.title}
                      </motion.span>
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
                      <motion.span
                        initial={{
                          backgroundColor: "transparent",
                          boxShadow: "0 0 0 0px transparent inset",
                        }}
                        animate={pointsHighlighted ? {
                          backgroundColor: "var(--color-info-soft)",
                          boxShadow: "0 0 0 1px color-mix(in srgb, var(--color-info) 25%, transparent) inset",
                        } : {
                          backgroundColor: "transparent",
                          boxShadow: "0 0 0 0px transparent inset",
                        }}
                        transition={{ duration: 0.22, delay: pointsStagger, ease: APPLE_EASE }}
                        className="rounded-sm px-0.5 py-px"
                      >
                        {row.points}
                      </motion.span>{" "}
                      points
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Floating "30 matches" badge that pops in when the click
                happens — communicates "this isn't one item, it's a
                whole list." This is the wow moment. */}
            <AnimatePresence>
              {step >= 1 && (
                <motion.div
                  key="matches-badge"
                  initial={{ opacity: 0, scale: 0.5, y: 4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{
                    duration: 0.35,
                    delay: 0.55,
                    ease: APPLE_EASE,
                  }}
                  className="pointer-events-none absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-[var(--color-fg-strong)] px-2.5 py-1 text-[10.5px] font-mono text-[var(--color-bg)] shadow-[var(--shadow-popover)]"
                >
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.62, type: "spring", stiffness: 400, damping: 18 }}
                    className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]"
                  />
                  found 30 matches
                </motion.div>
              )}
            </AnimatePresence>

            {/* Cursor — moves between steps. Faster motion (0.35s) +
                punchier click feedback. */}
            <motion.div
              initial={false}
              animate={{
                left: step === 0 ? "60%" : step === 1 ? "32%" : "65%",
                top: step === 0 ? "55%" : step === 1 ? "22%" : "30%",
                scale: step === 1 ? [1, 0.7, 1.05, 1] : 1,
              }}
              transition={{
                left: { duration: 0.35, ease: APPLE_EASE },
                top: { duration: 0.35, ease: APPLE_EASE },
                scale: { duration: 0.4, ease: APPLE_EASE, delay: 0.38, times: [0, 0.3, 0.6, 1] },
              }}
              className="pointer-events-none absolute z-10"
            >
              <MousePointer2 className="h-4 w-4 fill-[var(--color-fg-strong)] text-[var(--color-fg-strong)] drop-shadow-sm" />
            </motion.div>

            {/* Click ripple — expanding ring that fires when the cursor
                lands on the click target. macOS-style click visualization.
                Triggers only at step 1 (the click moment). */}
            <AnimatePresence>
              {step === 1 && (
                <motion.div
                  key="ripple"
                  initial={{ left: "32%", top: "22%", opacity: 0, scale: 0.3 }}
                  animate={{ opacity: [0, 0.75, 0], scale: [0.3, 2.4, 3.2] }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: 0.7,
                    delay: 0.42,
                    ease: APPLE_EASE,
                    times: [0, 0.3, 1],
                  }}
                  className="pointer-events-none absolute"
                >
                  <span className="block h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--color-accent)]" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Sidebar area — shows fields appearing */}
          <div className="bg-[var(--color-ink-1)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                {step < 2 ? "Fields" : "Recipe saved"}
              </div>
              <div className="font-mono text-[11px] text-[var(--color-fg-muted)]">
                {step === 0 ? "0 / 64" : step === 1 ? "2 / 64" : "2 / 64"}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {step === 0 && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: APPLE_EASE }}
                  className="flex h-[210px] flex-col items-center justify-center text-center"
                >
                  <div className="mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-ink-2)]">
                    <MousePointer2 className="h-3.5 w-3.5 text-[var(--color-fg-subdued)]" />
                  </div>
                  <p className="text-[11.5px] text-[var(--color-fg-muted)]">
                    No fields yet — click an element on the page.
                  </p>
                </motion.div>
              )}

              {step >= 1 && (
                <motion.div
                  key="fields"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: APPLE_EASE }}
                  className="space-y-1.5"
                >
                  {/* Field cards now show actual extracted text streaming
                      in row-by-row — proves the "click one, get the whole
                      list" promise concretely. This is what makes the
                      magic land. */}
                  <FieldRow
                    color="var(--color-accent)"
                    label="title"
                    kind="list"
                    valueDelay={0.7}
                    values={SAMPLE_ROWS.map((r) => r.title)}
                  />
                  <FieldRow
                    color="var(--color-info)"
                    label="points"
                    kind="list"
                    valueDelay={1.55}
                    values={SAMPLE_ROWS.map((r) => String(r.points))}
                  />

                  {step === 2 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.32, delay: 0.2, ease: APPLE_EASE }}
                      className="mt-3 rounded-md border border-[var(--color-accent-line)] bg-[var(--color-accent-faint)] p-2.5"
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3 text-[var(--color-accent)]" />
                        <div className="font-mono text-[11px] font-semibold text-[var(--color-fg-strong)]">
                          recipe saved
                        </div>
                      </div>
                      <pre className="overflow-hidden font-mono text-[11.5px] leading-[1.55] text-[var(--color-fg)]">
{`from stealth_scraper import Client
c = Client(api_key="ssk_...")
c.run_template("tpl_hn", url)`}
                      </pre>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Caption strip */}
        <div className="border-t border-[var(--color-border)] bg-[var(--color-ink-1)] px-5 py-2.5 text-center font-mono text-[11.5px] text-[var(--color-fg-muted)]">
          {step === 0 && "Paste a URL, get a snapshot. The whole page becomes clickable."}
          {step === 1 && "Click any element. The selector + a field appear instantly."}
          {step === 2 && "Save the recipe. Now run it from your SDK on any HN-shaped page."}
        </div>
      </motion.div>
    </section>
  );
}

function FieldRow({
  color, label, kind, valueDelay, values,
}: {
  color: string;
  label: string;
  kind: string;
  valueDelay: number;
  values: string[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, delay: Math.max(0, valueDelay - 0.15), ease: APPLE_EASE }}
      className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      {/* Header row — name + kind chip */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-2.5 py-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/15" style={{ background: color }} />
        <span className="truncate text-[12px] font-medium text-[var(--color-fg-strong)]">{label}</span>
        <span className="ml-auto inline-flex h-[18px] items-center rounded px-1.5 font-mono text-[10px] ring-1 ring-inset ring-[var(--color-border)] bg-[var(--color-ink-2)] text-[var(--color-fg-muted)]">
          {kind}
        </span>
      </div>

      {/* Streaming values — each row appears with a 120ms stagger so the
          user SEES the data flowing in row-by-row. This is what sells the
          'click one element, get the whole list' magic. */}
      <ul className="space-y-px px-2.5 py-1.5">
        {values.slice(0, 3).map((v, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{
              duration: 0.22,
              delay: valueDelay + i * 0.12,
              ease: APPLE_EASE,
            }}
            className="truncate font-mono text-[11px] leading-[1.55] text-[var(--color-fg)]"
          >
            <span className="text-[var(--color-fg-muted)]">{i}.</span>{" "}
            {v.length > 38 ? v.slice(0, 38) + "…" : v}
          </motion.li>
        ))}
        <motion.li
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22, delay: valueDelay + 0.5, ease: APPLE_EASE }}
          className="font-mono text-[10.5px] text-[var(--color-fg-muted)]"
        >
          … +27 more
        </motion.li>
      </ul>
    </motion.div>
  );
}
