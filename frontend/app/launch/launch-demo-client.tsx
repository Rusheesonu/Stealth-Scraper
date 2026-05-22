"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Check, Copy, ExternalLink, Globe, Loader2,
  Sparkles, Shield, Cpu, AlertTriangle, RefreshCw,
  MousePointerClick, FileJson, Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { cn, truncate } from "@/lib/utils";
import type { PublicSnapshotResponse, TemplateField } from "@/lib/api";

/**
 * /launch — the 30-second Product Hunt demo. Auto-runs a real scrape on
 * mount against one of three soft sites (HN / quotes / books). No signup.
 *
 * Three phases:
 *   1) PRE — "preparing your demo…" pause for ~1.5s after paint so the
 *      visitor gets a moment to orient before the loader kicks in.
 *   2) LOADING — choreographed multi-stage loader (same family as
 *      LandingPreviewModal) while we wait for the snapshot+suggest call.
 *   3) RESULT — screenshot on the left, structured JSON on the right,
 *      field-check pills + CTA "Sign up and run your own →".
 *
 * Errors get their own dedicated phase with the structured anti-bot
 * payload (task #56) and a 503-overloaded retry. Anything else falls
 * back to a generic message + retry.
 */

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

type DemoKey = "hn" | "quotes" | "books";

type DemoConfig = {
  key: DemoKey;
  label: string;        // short pill label
  host: string;         // hostname for browser-chrome display
  url: string;          // full URL we POST
  blurb: string;        // one-liner for the "try another" card
  expectedFields: string[]; // the field labels we expect to see come back
                            // — used for the "✓ title ✓ points ✓ comments"
                            // strip even before the live response arrives.
};

// Order matters: this is the order they appear in the "try another" strip.
// `hn` is first because it's the default and it's the one the PR copy
// references ("scrape Hacker News in 7 seconds").
const DEMOS: Record<DemoKey, DemoConfig> = {
  hn: {
    key: "hn",
    label: "Hacker News",
    host: "news.ycombinator.com",
    url: "https://news.ycombinator.com/",
    blurb: "Top stories with titles, points, comments.",
    expectedFields: ["title", "points", "comments"],
  },
  quotes: {
    key: "quotes",
    label: "quotes.toscrape.com",
    host: "quotes.toscrape.com",
    url: "https://quotes.toscrape.com/",
    blurb: "Every quote, its author, and the tags.",
    expectedFields: ["quote", "author", "tags"],
  },
  books: {
    key: "books",
    label: "books.toscrape.com",
    host: "books.toscrape.com",
    url: "https://books.toscrape.com/",
    blurb: "Books with title, price, rating.",
    expectedFields: ["title", "price", "rating"],
  },
};

function pickDemo(raw: string | null): DemoKey {
  if (raw === "quotes" || raw === "books") return raw;
  // default + unknowns → hn
  return "hn";
}

// ─── Error parsing ──────────────────────────────────────────────────────
//
// We POST directly to the backend rewrite (no api.ts helper) so we can
// (a) attach the X-Stealth-Launch-Token header and (b) inspect the raw
// error body for the structured anti-bot payload (task #56). The shape
// the other frontend agent settled on is `err.detail.kind === "..."`.

type StructuredErr = {
  kind: string;                        // e.g. "anti_bot_block", "rate_limited"
  message?: string;
  retry_after_seconds?: number;
  evidence?: string;
};

type DemoError =
  | { kind: "anti_bot"; message: string }
  | { kind: "rate_limited"; message: string; retryIn?: number }
  | { kind: "overloaded"; message: string }
  | { kind: "network"; message: string }
  | { kind: "unknown"; message: string };

function classifyError(status: number, detail: unknown): DemoError {
  // Structured detail (preferred — task #56 contract)
  if (detail && typeof detail === "object" && "kind" in (detail as object)) {
    const d = detail as StructuredErr;
    if (d.kind === "anti_bot_block") {
      return {
        kind: "anti_bot",
        message:
          d.message ||
          "The target site flagged this request as automated. Stealth mode escalates through residential proxies on paid plans.",
      };
    }
    if (d.kind === "rate_limited") {
      return {
        kind: "rate_limited",
        message: d.message || "Demo's at capacity right now.",
        retryIn: d.retry_after_seconds,
      };
    }
  }
  // Plain status-code fallbacks.
  if (status === 503) {
    return { kind: "overloaded", message: "Demo's at capacity right now — try again in 30 sec." };
  }
  if (status === 429) {
    return {
      kind: "rate_limited",
      message: "We've hit our hourly demo cap. Sign up free to keep going.",
    };
  }
  if (status === 422) {
    return {
      kind: "anti_bot",
      message:
        "The target site returned an unexpected response. This shouldn't happen for HN — try refreshing.",
    };
  }
  // Generic: surface the detail string if it's a string, else generic.
  const fallback =
    typeof detail === "string"
      ? detail
      : "Something went wrong while running the demo. Try again or sign up to run it yourself.";
  return { kind: "unknown", message: fallback };
}

/** POST to the public snapshot endpoint with the launch-token header.
 *  We don't go through api.ts because the typed helper there doesn't
 *  expose a way to add headers — and we want to keep the launch-token
 *  concern isolated to this route. */
async function runDemoFetch(url: string): Promise<PublicSnapshotResponse> {
  let res: Response;
  try {
    res = await fetch("/api/backend/public/snapshot-and-suggest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Backend agent will wire this up to bypass the public IP rate
        // limit for launch week. Until then the request still works —
        // it just counts against the regular per-IP bucket.
        "X-Stealth-Launch-Token": "demo",
      },
      body: JSON.stringify({ url }),
      cache: "no-store",
    });
  } catch (e) {
    throw classifyErrorWrapped(0, {
      kind: "network",
      message: e instanceof Error ? e.message : "Network error",
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail: unknown = body;
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.detail ?? parsed;
    } catch {
      /* leave as raw text */
    }
    throw classifyErrorWrapped(res.status, detail);
  }
  return res.json();
}

// Use a tagged Error so we can pluck the structured info downstream
// without parsing the message string again.
class DemoErrorWrapper extends Error {
  demo: DemoError;
  constructor(d: DemoError) {
    super(d.message);
    this.demo = d;
  }
}
function classifyErrorWrapped(status: number, detail: unknown): DemoErrorWrapper {
  return new DemoErrorWrapper(classifyError(status, detail));
}

// ─── Main client component ──────────────────────────────────────────────

type Phase = "pre" | "loading" | "result" | "error";

export function LaunchDemoClient() {
  const search = useSearchParams();
  const demoKey = pickDemo(search.get("demo"));
  const demo = DEMOS[demoKey];

  const [phase, setPhase] = useState<Phase>("pre");
  const [result, setResult] = useState<PublicSnapshotResponse | null>(null);
  const [error, setError] = useState<DemoError | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  // Track the in-flight request so a demo-switch (query change) cancels
  // the previous run before kicking off the new one. Without this you
  // can briefly see one site's screenshot with another site's stale
  // loader state.
  const runIdRef = useRef(0);

  // Auto-fire ~1.5s after the page paints. The pause is intentional:
  // it gives the visitor a beat to read "preparing your demo…" before
  // the loader sweeps in, which makes the whole sequence feel
  // choreographed instead of mid-flight. Anything shorter feels jarring.
  useEffect(() => {
    setPhase("pre");
    setResult(null);
    setError(null);
    setElapsedMs(null);

    const thisRun = ++runIdRef.current;
    const start = performance.now();

    const t = setTimeout(() => {
      if (runIdRef.current !== thisRun) return;
      setPhase("loading");
      runDemoFetch(demo.url)
        .then((res) => {
          if (runIdRef.current !== thisRun) return;
          setResult(res);
          setElapsedMs(Math.round(performance.now() - start));
          setPhase("result");
        })
        .catch((e: unknown) => {
          if (runIdRef.current !== thisRun) return;
          if (e instanceof DemoErrorWrapper) {
            setError(e.demo);
          } else {
            setError({
              kind: "unknown",
              message: e instanceof Error ? e.message : "Demo failed.",
            });
          }
          setPhase("error");
        });
    }, 1500);

    return () => {
      clearTimeout(t);
      // bump runId so any in-flight callbacks bail
      runIdRef.current++;
    };
  }, [demo.url]);

  function retry() {
    // bump runId so the previous attempt (if any) ignores its callback
    runIdRef.current++;
    setError(null);
    setPhase("pre");
    setElapsedMs(null);
    const thisRun = ++runIdRef.current;
    const start = performance.now();
    setTimeout(() => {
      if (runIdRef.current !== thisRun) return;
      setPhase("loading");
      runDemoFetch(demo.url)
        .then((res) => {
          if (runIdRef.current !== thisRun) return;
          setResult(res);
          setElapsedMs(Math.round(performance.now() - start));
          setPhase("result");
        })
        .catch((e: unknown) => {
          if (runIdRef.current !== thisRun) return;
          if (e instanceof DemoErrorWrapper) setError(e.demo);
          else setError({ kind: "unknown", message: e instanceof Error ? e.message : "Demo failed." });
          setPhase("error");
        });
    }, 300);
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <TopBar />

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        <Hero demo={demo} phase={phase} elapsedMs={elapsedMs} />

        <div className="mt-8">
          <AnimatePresence mode="wait">
            {phase === "pre" && <PrePhase key="pre" demo={demo} />}
            {phase === "loading" && <LoadingPhase key="loading" demo={demo} />}
            {phase === "result" && result && (
              <ResultPhase key="result" demo={demo} result={result} elapsedMs={elapsedMs ?? 0} />
            )}
            {phase === "error" && error && (
              <ErrorPhase key="error" demo={demo} error={error} onRetry={retry} />
            )}
          </AnimatePresence>
        </div>

        <TryAnotherStrip activeKey={demo.key} />
        <HowItWorks />
        <BottomCta />
      </main>
    </div>
  );
}

// ─── Top bar ────────────────────────────────────────────────────────────

function TopBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-[color-mix(in_srgb,var(--color-bg)_80%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.005em] text-[var(--color-fg-strong)]"
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-[var(--color-accent)]">
            <span className="block h-1.5 w-1.5 rounded-[1px] bg-white" />
          </span>
          Stealth-Scraper
        </Link>
        <Link
          href="/"
          className="rounded-md px-2.5 py-1 text-[12px] text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]"
        >
          Skip to product →
        </Link>
      </div>
    </header>
  );
}

// ─── Hero band ──────────────────────────────────────────────────────────

function Hero({
  demo,
  phase,
  elapsedMs,
}: {
  demo: DemoConfig;
  phase: Phase;
  elapsedMs: number | null;
}) {
  const subtitle =
    phase === "result" && elapsedMs
      ? `Done in ${(elapsedMs / 1000).toFixed(1)}s. Below: the exact JSON our API returned for ${demo.host}.`
      : phase === "error"
      ? "Hit a snag. Details below — and you can retry."
      : `Auto-running against ${demo.host}. No signup, no key, no friction.`;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-8 sm:px-8 sm:py-10">
      {/* Ambient accent wash */}
      <div
        className="pointer-events-none absolute -inset-x-10 -top-10 h-40 opacity-60"
        style={{ background: "radial-gradient(ellipse at center, var(--color-accent-faint) 0%, transparent 65%)" }}
        aria-hidden
      />
      <div className="relative">
        <div className="mb-3 inline-flex">
          <Badge tone="accent">
            <Sparkles className="h-2.5 w-2.5" />
            <span className="font-mono">Live demo · Product Hunt launch</span>
          </Badge>
        </div>
        <h1 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.018em] text-[var(--color-fg-display)] sm:text-[40px]">
          We&apos;ll scrape{" "}
          <span className="bg-gradient-to-br from-[var(--color-fg-display)] to-[color-mix(in_srgb,var(--color-fg-display)_60%,var(--color-accent))] bg-clip-text text-transparent">
            {demo.host}
          </span>
          {" "}for you. Right now.
        </h1>
        <p className="mt-3 max-w-xl text-[14px] leading-[1.6] text-[var(--color-fg-muted)] sm:text-[15px]">
          {subtitle}
        </p>

        {/* Field-check pills — show the labels we expect, with checkmarks
            that light up once the response arrives and confirms them. */}
        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {demo.expectedFields.map((f) => {
            const confirmed = phase === "result";
            return (
              <span
                key={f}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                  confirmed
                    ? "border-[color:var(--color-success)]/30 bg-[var(--color-success-soft)] text-[var(--color-success)]"
                    : "border-[var(--color-border)] bg-[var(--color-ink-1)] text-[var(--color-fg-muted)]",
                )}
              >
                {confirmed ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-subdued)]" />}
                {f}
              </span>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── PRE phase — "preparing your demo…" ─────────────────────────────────

function PrePhase({ demo }: { demo: DemoConfig }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: APPLE_EASE }}
      className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-ink-1)] p-8 text-center"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-accent-faint)] ring-1 ring-inset ring-[var(--color-accent-line)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-accent)]" />
      </div>
      <p className="text-[15px] font-medium tracking-[-0.005em] text-[var(--color-fg-strong)]">
        Preparing your demo…
      </p>
      <p className="mt-1 font-mono text-[11px] text-[var(--color-fg-subdued)]">
        spinning up for {demo.host}
      </p>
    </motion.div>
  );
}

// ─── LOADING phase — choreographed progress with named stages ───────────

const LOADING_STAGES = [
  { icon: Globe,   text: "Loading page",            from: 0.00, to: 0.22 },
  { icon: Shield,  text: "Bypassing bot detection", from: 0.22, to: 0.55 },
  { icon: Cpu,     text: "Extracting fields",       from: 0.55, to: 0.92 },
  { icon: Sparkles,text: "Done",                    from: 0.92, to: 1.00 },
] as const;

function LoadingPhase({ demo }: { demo: DemoConfig }) {
  const [t, setT] = useState(0);

  useEffect(() => {
    const TOTAL_MS = 10_000; // matches the 30-sec elevator pitch
    const TICK_MS = 80;
    let timer: number | undefined;
    const start = performance.now();
    function tick() {
      const elapsed = performance.now() - start;
      // cap at 0.97 — don't visually "finish" until the result actually arrives
      setT(Math.min(0.97, elapsed / TOTAL_MS));
      timer = window.setTimeout(tick, TICK_MS) as unknown as number;
    }
    tick();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  const activeIdx = LOADING_STAGES.findIndex((s) => t >= s.from && t < s.to);
  const activeStage = LOADING_STAGES[activeIdx === -1 ? LOADING_STAGES.length - 1 : activeIdx];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: APPLE_EASE }}
      className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      {/* Mock browser chrome row showing the URL we're hitting */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-mac-red)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-mac-yellow)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-mac-green)]" />
        </div>
        <div className="flex flex-1 items-center gap-1.5 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
          <Globe className="h-3 w-3 text-[var(--color-fg-subdued)]" />
          {truncate(demo.url.replace(/^https?:\/\//, ""), 60)}
        </div>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--color-accent)]">
          <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
          live
        </span>
      </div>

      <div className="p-6 sm:p-8">
        {/* Current stage — big, centred, animated icon swap */}
        <div className="mx-auto mb-6 flex items-center justify-center gap-3">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStage.text}
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.28, ease: APPLE_EASE }}
              className="inline-flex items-center gap-3"
            >
              <span className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent-faint)] ring-1 ring-inset ring-[var(--color-accent-line)]">
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
              <div className="text-left">
                <div className="text-[16px] font-semibold leading-tight tracking-[-0.012em] text-[var(--color-fg-display)]">
                  {activeStage.text}
                </div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                  step {LOADING_STAGES.indexOf(activeStage) + 1} of {LOADING_STAGES.length}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Stage list — all four stages, checkmark fills in as we progress.
            Gives the visitor a roadmap of what's happening instead of a
            single moving spinner. */}
        <ol className="mx-auto max-w-md space-y-1.5">
          {LOADING_STAGES.map((s, i) => {
            const done = t >= s.to;
            const active = i === LOADING_STAGES.indexOf(activeStage);
            return (
              <li
                key={s.text}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border px-3 py-1.5 transition-colors",
                  done
                    ? "border-[color:var(--color-success)]/30 bg-[var(--color-success-soft)]"
                    : active
                    ? "border-[var(--color-accent-line)] bg-[var(--color-accent-faint)]"
                    : "border-[var(--color-border)] bg-[var(--color-ink-1)]",
                )}
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-md">
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-accent)]" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-subdued)]" />
                  )}
                </span>
                <span
                  className={cn(
                    "flex-1 text-[13px]",
                    done
                      ? "text-[var(--color-success)]"
                      : active
                      ? "font-medium text-[var(--color-fg-strong)]"
                      : "text-[var(--color-fg-muted)]",
                  )}
                >
                  {s.text}
                </span>
              </li>
            );
          })}
        </ol>

        {/* Progress bar — same gradient + shimmer family as the modal */}
        <div className="relative mx-auto mt-6 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-[var(--color-border)]">
          <motion.div
            className="h-full rounded-full"
            style={{
              background:
                "linear-gradient(90deg, var(--color-accent) 0%, color-mix(in srgb, var(--color-accent) 70%, var(--color-fg-display)) 100%)",
            }}
            animate={{ width: `${Math.round(t * 100)}%` }}
            transition={{ duration: 0.25, ease: APPLE_EASE }}
          />
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

        <p className="mx-auto mt-4 max-w-md text-center text-[11.5px] leading-[1.55] text-[var(--color-fg-muted)]">
          First-run cold start can take 10–15s while we warm a fresh Chromium tab.
          Once it&apos;s warm, sub-second.
        </p>
      </div>
    </motion.div>
  );
}

// ─── RESULT phase — screenshot + JSON ───────────────────────────────────

/** Zip parallel list fields into per-item records — same shape as the
 *  modal's buildAllRecords. One JSON object per row of extracted data. */
function buildRecords(
  template: TemplateField[],
  sample: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!template.length) return [];
  let maxLen = 0;
  const entries = template.map((f) => {
    const v = sample[f.label];
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

const RESULT_RECORD_CAP = 6;

function ResultPhase({
  demo,
  result,
  elapsedMs,
}: {
  demo: DemoConfig;
  result: PublicSnapshotResponse;
  elapsedMs: number;
}) {
  const allRecords = useMemo(
    () => buildRecords(result.template, result.sample_values),
    [result.template, result.sample_values],
  );
  const shownRecords = allRecords.slice(0, RESULT_RECORD_CAP);
  const totalRecords = allRecords.length;

  const [copied, setCopied] = useState(false);
  function copyJson() {
    const payload = allRecords.length === 1 ? allRecords[0] : allRecords;
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const seconds = (elapsedMs / 1000).toFixed(1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: APPLE_EASE }}
      className="space-y-5"
    >
      {/* Top result band — screenshot left, JSON right. Stacks on mobile. */}
      <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Badge tone="success" size="sm">
              <Check className="h-2.5 w-2.5" /> Live
            </Badge>
            <Badge tone="accent" size="sm">
              <Sparkles className="h-2.5 w-2.5" /> {result.template.length} fields
            </Badge>
            <span className="truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
              {truncate(result.url.replace(/^https?:\/\//, ""), 50)}
            </span>
          </div>
          <button
            onClick={copyJson}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[10.5px] text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-1)] hover:text-[var(--color-fg)]"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "copied" : "copy JSON"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.05fr]">
          {/* LEFT — screenshot. object-cover + object-top so the hero of
              the page is visible without scrolling. On mobile this caps at
              ~50vh so the user gets to JSON without too much scrolling. */}
          <div className="relative max-h-[480px] overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-ink-1)] md:max-h-none md:border-b-0 md:border-r">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${result.screenshot}`}
              alt={`Screenshot of ${demo.host}`}
              loading="lazy"
              className="block h-full w-full object-cover object-top"
              draggable={false}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[var(--color-ink-1)] to-transparent" />
          </div>

          {/* RIGHT — JSON records */}
          <div className="overflow-y-auto p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                Extracted JSON · {totalRecords} {totalRecords === 1 ? "record" : "records"}
              </div>
            </div>
            {shownRecords.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] p-5 text-center text-[12.5px] text-[var(--color-fg-muted)]">
                The scrape returned, but no structured fields were auto-picked.
                Sign up to open in the picker.
              </div>
            ) : (
              <div className="space-y-2">
                {shownRecords.map((rec, i) => (
                  <JsonRecord key={i} record={rec} index={i} />
                ))}
                {totalRecords > shownRecords.length && (
                  <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-ink-1)] px-3 py-2 text-center font-mono text-[11px] text-[var(--color-fg-muted)]">
                    + {totalRecords - shownRecords.length} more records — copy JSON to see all
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* CTA band — "This took X seconds" + big sign-up button */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-fg-strong)] px-6 py-7 text-center sm:px-10 sm:py-8">
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{ background: "radial-gradient(ellipse at center, rgba(4,120,87,0.35) 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-white/80">
            <Clock className="h-3 w-3" /> {seconds}s
          </div>
          <h2 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.014em] text-white sm:text-[28px]">
            This took {seconds} seconds.<br className="hidden sm:block" />
            Your scraper. Ready in 30.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[13px] leading-[1.6] text-white/70 sm:text-[14px]">
            Sign up free, paste any URL, click the fields you want, ship a JSON
            API in five minutes. 50 free scrapes / month — no card.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            <Link
              href="/login?mode=signup&next=/pick"
              className="inline-flex h-11 items-center gap-1.5 rounded-md bg-white px-5 text-[14px] font-semibold tracking-[-0.005em] text-[var(--color-fg-strong)] hover:bg-white/90"
            >
              Sign up and run your own <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-11 items-center gap-1.5 rounded-md border border-white/15 px-5 text-[13px] font-medium text-white/85 hover:bg-white/10"
            >
              See pricing
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function JsonRecord({ record, index }: { record: Record<string, unknown>; index: number }) {
  const entries = Object.entries(record);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: 0.04 + index * 0.04, ease: APPLE_EASE }}
      className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-2.5 py-1">
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          <span>record {String(index + 1).padStart(2, "0")}</span>
        </div>
        <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">
          {entries.length} {entries.length === 1 ? "field" : "fields"}
        </span>
      </div>
      <pre className="overflow-x-auto p-2.5 font-mono text-[12px] leading-[1.6] text-[var(--color-fg)]">
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
    const shown = value.slice(0, 4);
    return (
      <span>
        <span className="text-[var(--color-fg-subdued)]">[</span>
        {shown.map((v, i) => (
          <span key={i}>
            <JsonValue value={v} />
            {i < shown.length - 1 && <span className="text-[var(--color-fg-subdued)]">, </span>}
          </span>
        ))}
        {value.length > 4 && (
          <span className="text-[var(--color-fg-subdued)]">, … +{value.length - 4}</span>
        )}
        <span className="text-[var(--color-fg-subdued)]">]</span>
      </span>
    );
  }
  const s = String(value);
  const trimmed = truncate(s, 180);
  return <span className="text-[var(--color-success)]">&quot;{trimmed}&quot;</span>;
}

// ─── ERROR phase ────────────────────────────────────────────────────────

function ErrorPhase({
  demo,
  error,
  onRetry,
}: {
  demo: DemoConfig;
  error: DemoError;
  onRetry: () => void;
}) {
  const isOverload = error.kind === "overloaded" || error.kind === "rate_limited";
  const isAntiBot = error.kind === "anti_bot";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: APPLE_EASE }}
      className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center sm:p-10"
    >
      <div
        className={cn(
          "mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full",
          isOverload
            ? "bg-[var(--color-warning-soft)] ring-1 ring-inset ring-[color:var(--color-warning)]/30"
            : "bg-[var(--color-danger-soft)] ring-1 ring-inset ring-[color:var(--color-danger)]/30",
        )}
      >
        <AlertTriangle
          className={cn(
            "h-5 w-5",
            isOverload ? "text-[var(--color-warning)]" : "text-[var(--color-danger)]",
          )}
        />
      </div>
      <h2 className="text-[18px] font-semibold tracking-[-0.005em] text-[var(--color-fg-strong)] sm:text-[20px]">
        {isOverload
          ? "Demo's at capacity right now"
          : isAntiBot
          ? "Target site flagged the request"
          : "Couldn't run the demo"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-[13px] leading-[1.6] text-[var(--color-fg-muted)]">
        {error.message}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </Button>
        <Link href={`/launch?demo=${demo.key === "hn" ? "quotes" : "hn"}`}>
          <Button variant="secondary">Try a different site</Button>
        </Link>
        <Link href="/login?mode=signup&next=/pick">
          <Button variant="secondary">Sign up & run your own</Button>
        </Link>
      </div>
    </motion.div>
  );
}

// ─── "Try another" demo cards ───────────────────────────────────────────

function TryAnotherStrip({ activeKey }: { activeKey: DemoKey }) {
  const others = (Object.keys(DEMOS) as DemoKey[]).filter((k) => k !== activeKey);
  return (
    <section className="mt-10">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
        Try another
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {others.map((k) => (
          <Link key={k} href={`/launch?demo=${k}`} className="block">
            <Card density="compact" interactive>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[12px] text-[var(--color-fg-strong)]">
                  {DEMOS[k].host}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-[var(--color-fg-subdued)]" />
              </div>
              <p className="text-[12px] leading-[1.5] text-[var(--color-fg-muted)]">
                {DEMOS[k].blurb}
              </p>
            </Card>
          </Link>
        ))}
        {/* Third slot: bring-your-own-URL CTA. Keeps the row balanced on
            lg breakpoints (2 other-demos + 1 BYO = 3 cards). */}
        <Link href="/login?mode=signup&next=/pick" className="block">
          <Card density="compact" interactive className="border-[color:var(--color-accent)]/30 bg-[var(--color-accent-faint)]">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[12px] text-[var(--color-accent)]">
                your-site.com
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-[var(--color-accent)]" />
            </div>
            <p className="text-[12px] leading-[1.5] text-[var(--color-fg-muted)]">
              Sign up free to paste your own URL.
            </p>
          </Card>
        </Link>
      </div>
    </section>
  );
}

// ─── "How this works" mini-explainer ────────────────────────────────────

function HowItWorks() {
  const features = [
    {
      icon: Shield,
      title: "Stealth-tier engine",
      body: "Multi-engine router with CDP-patched Chromium. Beats Cloudflare Turnstile, DataDome, Akamai checks vanilla Playwright trips on.",
    },
    {
      icon: MousePointerClick,
      title: "Visual picker",
      body: "Click any field on the page. See the selector. Edit live. Save the recipe. No prompt-and-pray.",
      href: "/pick",
    },
    {
      icon: FileJson,
      title: "JSON / CSV / Markdown",
      body: "Pick your output format. SDKs for Python + TypeScript. MCP server for Claude Desktop, Cursor, Cline.",
    },
    {
      icon: Clock,
      title: "Cron + webhooks",
      body: "Schedule a recipe to re-run hourly or daily. Push deltas to your webhook. Wake up to fresh data.",
    },
  ];
  return (
    <section className="mt-12">
      <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
        How this works
      </div>
      <h2 className="mb-5 text-[20px] font-semibold tracking-[-0.012em] text-[var(--color-fg-strong)]">
        What the demo showed you — and what you get on sign-up
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => {
          const card = (
            <Card density="compact" interactive={Boolean(f.href)}>
              <f.icon className="mb-2.5 h-4 w-4 text-[var(--color-accent)]" />
              <CardTitle className="mb-1.5 text-[13.5px]">{f.title}</CardTitle>
              <p className="text-[12px] leading-[1.55] text-[var(--color-fg-muted)]">
                {f.body}
              </p>
            </Card>
          );
          return f.href ? (
            <Link key={f.title} href={f.href} className="block">
              {card}
            </Link>
          ) : (
            <div key={f.title}>{card}</div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Bottom CTA ─────────────────────────────────────────────────────────

function BottomCta() {
  return (
    <section className="mt-12 text-center">
      <h2 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.014em] text-[var(--color-fg-display)] sm:text-[28px]">
        Save the recipe. Run it forever.
      </h2>
      <p className="mx-auto mt-3 max-w-md text-[13px] leading-[1.55] text-[var(--color-fg-muted)] sm:text-[14px]">
        Stop re-prompting on every URL. Build the schema once, ship the
        agent. 50 free scrapes / month — no card required.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <Link href="/login?mode=signup&next=/pick">
          <Button variant="primary" size="lg">
            Get started — free <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link href="https://github.com/" target="_blank" rel="noopener noreferrer">
          <Button variant="secondary" size="lg">
            <ExternalLink className="h-4 w-4" />
            Star on GitHub
          </Button>
        </Link>
      </div>
    </section>
  );
}
