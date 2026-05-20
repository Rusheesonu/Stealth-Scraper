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

  // Auto-advance loop. User clicks pause the auto-advance by setting
  // step to a value; we reset the interval each render based on the
  // current step.
  useEffect(() => {
    const t = setTimeout(() => {
      setStep(((step + 1) % 3) as Step);
    }, 3500);
    return () => clearTimeout(t);
  }, [step]);

  return (
    <section className="relative mx-auto max-w-5xl py-16 md:py-20">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.4, ease: APPLE_EASE }}
        className="mb-7 text-center"
      >
        <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
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
          <div className="font-mono text-[10px] text-[var(--color-fg-subdued)]">
            step {step + 1}/3
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr]">
          {/* Page area */}
          <div className="relative h-[300px] border-b border-[var(--color-border)] bg-[var(--color-bg)] p-5 md:border-b-0 md:border-r">
            <ul className="space-y-2.5">
              {SAMPLE_ROWS.map((row, i) => {
                const titleHighlighted = step >= 1 && i === 0;
                const pointsHighlighted = step >= 1 && i === 0;
                return (
                  <li key={i} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <div className="text-[12.5px] leading-[1.45] text-[var(--color-fg)]">
                      <motion.span
                        animate={titleHighlighted ? {
                          backgroundColor: "var(--color-accent-soft)",
                          boxShadow: "0 0 0 1px var(--color-accent-line) inset",
                        } : {
                          backgroundColor: "transparent",
                          boxShadow: "0 0 0 0px transparent inset",
                        }}
                        transition={{ duration: 0.25, ease: APPLE_EASE }}
                        className="rounded-sm px-0.5 py-px"
                      >
                        {row.title}
                      </motion.span>
                    </div>
                    <div className="mt-1.5 font-mono text-[10px] text-[var(--color-fg-muted)]">
                      <motion.span
                        animate={pointsHighlighted ? {
                          backgroundColor: "var(--color-info-soft)",
                          boxShadow: "0 0 0 1px color-mix(in srgb, var(--color-info) 25%, transparent) inset",
                        } : {
                          backgroundColor: "transparent",
                          boxShadow: "0 0 0 0px transparent inset",
                        }}
                        transition={{ duration: 0.25, ease: APPLE_EASE }}
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

            {/* Cursor — moves between steps */}
            <motion.div
              initial={false}
              animate={{
                left: step === 0 ? "60%" : step === 1 ? "32%" : "65%",
                top: step === 0 ? "55%" : step === 1 ? "22%" : "30%",
                scale: step === 1 ? [1, 0.85, 1] : 1,
              }}
              transition={{
                left: { duration: 0.5, ease: APPLE_EASE },
                top: { duration: 0.5, ease: APPLE_EASE },
                scale: { duration: 0.3, ease: APPLE_EASE, delay: 0.5 },
              }}
              className="pointer-events-none absolute"
            >
              <MousePointer2 className="h-4 w-4 fill-[var(--color-fg-strong)] text-[var(--color-fg-strong)]" />
            </motion.div>
          </div>

          {/* Sidebar area — shows fields appearing */}
          <div className="bg-[var(--color-ink-1)] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                {step < 2 ? "Fields" : "Recipe saved"}
              </div>
              <div className="font-mono text-[10px] text-[var(--color-fg-subdued)]">
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
                  <FieldRow color="var(--color-accent)" label="title" kind="list" delay={0} />
                  <FieldRow color="var(--color-info)" label="points" kind="list" delay={0.15} />

                  {step === 2 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.32, delay: 0.2, ease: APPLE_EASE }}
                      className="mt-3 rounded-md border border-[var(--color-accent-line)] bg-[var(--color-accent-faint)] p-2.5"
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3 text-[var(--color-accent)]" />
                        <div className="font-mono text-[10.5px] font-semibold text-[var(--color-fg-strong)]">
                          recipe saved
                        </div>
                      </div>
                      <pre className="overflow-hidden font-mono text-[10px] leading-[1.5] text-[var(--color-fg)]">
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
        <div className="border-t border-[var(--color-border)] bg-[var(--color-ink-1)] px-5 py-2.5 text-center font-mono text-[10.5px] text-[var(--color-fg-subdued)]">
          {step === 0 && "Paste a URL, get a snapshot. The whole page becomes clickable."}
          {step === 1 && "Click any element. The selector + a field appear instantly."}
          {step === 2 && "Save the recipe. Now run it from your SDK on any HN-shaped page."}
        </div>
      </motion.div>
    </section>
  );
}

function FieldRow({
  color, label, kind, delay,
}: { color: string; label: string; kind: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay, ease: APPLE_EASE }}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/15" style={{ background: color }} />
        <span className="truncate text-[12px] font-medium text-[var(--color-fg-strong)]">{label}</span>
        <span className="ml-auto inline-flex h-[16px] items-center rounded px-1.5 font-mono text-[9px] ring-1 ring-inset ring-[var(--color-border)] bg-[var(--color-ink-2)] text-[var(--color-fg-muted)]">
          {kind}
        </span>
      </div>
    </motion.div>
  );
}
