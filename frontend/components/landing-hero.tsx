"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, Loader2, Globe, Check, MousePointerClick, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LandingPreview } from "@/components/landing-preview";
import { api, type PublicSnapshotResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

const TRY_LINKS = [
  { label: "news.ycombinator.com", url: "https://news.ycombinator.com" },
  { label: "quotes.toscrape.com",  url: "https://quotes.toscrape.com" },
  { label: "books.toscrape.com",   url: "https://books.toscrape.com" },
];

const DESCRIBE_EXAMPLES = [
  { url: "https://news.ycombinator.com", desc: "Get the top 10 stories — title, points, comment count." },
  { url: "https://books.toscrape.com",   desc: "Get every book — title, price, rating, in-stock yes/no." },
  { url: "https://quotes.toscrape.com",  desc: "Get every quote, its author, and the tags on it." },
];

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

type Mode = "url" | "describe";

/**
 * Hero — landing's first viewport. Two equal modes pinned right above the
 * input area:
 *   [ Paste URL ]        — visual picker flow → /pick
 *   [ Describe in plain English ] — AI extract flow → /ai-extract
 *
 * Most people won't read body copy. They scan for affordances. The toggle
 * makes BOTH product entry points visible at once, no hunting.
 *
 * Visual:
 *   - Dotted-grid backdrop with fade-to-bottom mask gives the hero a place
 *     to sit (the URL form was floating in white space).
 *   - Faint accent radial wash behind the form (Apple-style ambient gradient,
 *     almost imperceptible, just enough to lift).
 *   - Static demo strip below shows page → JSON output without a click.
 *   - Motion: 60ms staggered fade-up on hero elements.
 */
export function LandingHero() {
  const [mode, setMode] = useState<Mode>("url");

  return (
    <section className="relative -mx-6 overflow-hidden px-6 pb-10 pt-8 md:pb-12 md:pt-10">
      {/* Dotted background grid */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] opacity-[0.55] [mask-image:linear-gradient(to_bottom,black_0%,black_60%,transparent_100%)]"
        style={{
          backgroundImage: `radial-gradient(circle, color-mix(in srgb, var(--color-fg-subdued) 35%, transparent) 0.8px, transparent 0.8px)`,
          backgroundSize: "22px 22px",
          backgroundPosition: "center -8px",
        }}
        aria-hidden
      />
      {/* Accent radial wash */}
      <div
        className="pointer-events-none absolute left-1/2 top-[210px] h-[320px] w-[680px] -translate-x-1/2 opacity-[0.55]"
        style={{ background: `radial-gradient(ellipse at center, var(--color-accent-faint) 0%, transparent 65%)` }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-3xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: APPLE_EASE }}
          className="mb-5 inline-flex"
        >
          <Badge tone="accent">
            <span className="font-mono">v2.0</span> · visual scraping for AI agents
          </Badge>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: APPLE_EASE }}
          className="text-[40px] font-semibold leading-[1.04] tracking-[-0.028em] text-[var(--color-fg-display)] sm:text-[52px]"
        >
          The visual scraper for AI agents.<br />
          <span className="bg-gradient-to-br from-[var(--color-fg-display)] to-[color-mix(in_srgb,var(--color-fg-display)_60%,var(--color-accent))] bg-clip-text text-transparent">
            Point, click, save, ship.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease: APPLE_EASE }}
          className="mx-auto mt-5 max-w-xl text-[15px] leading-[1.55] text-[var(--color-fg-muted)]"
        >
          Other scrapers ask you to prompt and pray. We let you{" "}
          <span className="text-[var(--color-fg)]">see what you&apos;re extracting</span>{" "}
          — click any element, save the recipe, run it forever. With selectors
          you can actually debug.
        </motion.p>

        {/* TAB TOGGLE — the centerpiece. Two modes, equal weight. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: APPLE_EASE }}
          className="mx-auto mt-7 max-w-xl"
        >
          <ModeToggle mode={mode} onChange={setMode} />

          <div className="mt-3">
            <AnimatePresence mode="wait" initial={false}>
              {mode === "url" ? (
                <motion.div
                  key="url"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: APPLE_EASE }}
                >
                  <UrlMode />
                </motion.div>
              ) : (
                <motion.div
                  key="describe"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: APPLE_EASE }}
                >
                  <DescribeMode />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      {/* Static demo strip — proves it works without a click. Tighter gap
          (mt-8 → was mt-14) so the demo lands inside the first viewport
          on most laptops instead of being pushed below the fold. */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.4, ease: APPLE_EASE }}
        className="relative mx-auto mt-8 max-w-5xl md:mt-10"
      >
        <DemoStrip />
      </motion.div>
    </section>
  );
}

/**
 * Segmented control. iOS / macOS pattern: pill background, sliding thumb
 * (via layoutId), active label gets the strong color.
 */
function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const options: { id: Mode; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { id: "url",      icon: MousePointerClick, label: "Paste URL" },
    { id: "describe", icon: Sparkles,          label: "Describe in plain English" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Extraction mode"
      className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-card)]"
    >
      {options.map(({ id, icon: Icon, label }) => {
        const active = mode === id;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium",
              "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              active
                ? "text-[var(--color-fg-strong)]"
                : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
            )}
          >
            {active && (
              <motion.span
                layoutId="mode-toggle-thumb"
                className="absolute inset-0 -z-0 rounded-full bg-[var(--color-ink-2)] ring-1 ring-[var(--color-border)]"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <Icon className={cn("relative z-10 h-3.5 w-3.5", active && id === "describe" && "text-[var(--color-accent)]")} />
            <span className="relative z-10">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * URL mode — single mono input. Magic First Snapshot (Jobs J1):
 * paste URL → see live preview inline without signup → only the
 * "save/export/edit" CTAs trigger the signup flow.
 */
function UrlMode() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [preview, setPreview] = useState<PublicSnapshotResponse | null>(null);
  const [submittedUrl, setSubmittedUrl] = useState<string>("");
  const [error, setError] = useState<string>("");

  // Listen for prefill events from the featured-templates strip below.
  // When a user clicks a template card, that card scrolls to top and
  // dispatches ss:prefill-url with the source URL — we populate the
  // field so the user can hit Try free in one motion.
  useEffect(() => {
    function onPrefill(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string") setUrl(detail);
    }
    window.addEventListener("ss:prefill-url", onPrefill);
    return () => window.removeEventListener("ss:prefill-url", onPrefill);
  }, []);

  const valid = url.trim().length > 0;
  const normalizedUrl = (() => {
    const t = url.trim();
    if (!t) return "";
    return /^https?:\/\//i.test(t) ? t : "https://" + t;
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const res = await api.publicSnapshotAndSuggest(normalizedUrl);
      setPreview(res);
      setSubmittedUrl(normalizedUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Rate-limit copy is friendlier than the raw 429 message.
      if (msg.includes("429")) {
        setError("You've used your free previews for this hour. Sign up free for unlimited.");
      } else if (msg.includes("502") || msg.toLowerCase().includes("snapshot failed")) {
        setError("Couldn't reach that page. Either the site is blocking bots, or the URL is wrong.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPreview(null);
    setError("");
    setSubmittedUrl("");
  }

  // If a preview is up, show ONLY the preview — collapsing the form means
  // the page doesn't feel cluttered. User can hit "try another url" inside
  // the preview to come back to the form.
  if (preview) {
    return (
      <LandingPreview
        preview={preview}
        originalUrl={submittedUrl}
        onReset={reset}
      />
    );
  }

  return (
    <div>
      <motion.form
        onSubmit={submit}
        animate={{
          borderColor: focused ? "var(--color-fg)" : "var(--color-border)",
        }}
        whileHover={focused ? undefined : { borderColor: "var(--color-border-strong)" }}
        transition={{ duration: 0.16, ease: APPLE_EASE }}
        className="relative flex h-14 items-center w-full rounded-xl border bg-[var(--color-surface)]"
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="https://news.ycombinator.com"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          disabled={busy}
          className="flex-1 bg-transparent pl-5 pr-2 font-mono text-[15px] tracking-[var(--tracking-mono)] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subdued)] focus:outline-none disabled:opacity-50"
        />
        <motion.button
          type="submit"
          disabled={busy || !valid}
          whileTap={valid && !busy ? { scale: 0.96 } : undefined}
          animate={{
            backgroundColor: valid ? "var(--color-fg-strong)" : "var(--color-ink-4)",
            opacity: valid ? 1 : 0.55,
          }}
          transition={{ duration: 0.16, ease: APPLE_EASE }}
          className="mr-2 inline-flex h-10 items-center gap-1.5 rounded-md px-4 font-medium text-[13px] text-[var(--color-bg)] disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          {busy ? "Working…" : "Try free"}
        </motion.button>
      </motion.form>

      {/* Loading hint — first load takes 10-15s warming the browser */}
      <AnimatePresence>
        {busy && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: APPLE_EASE }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] text-[var(--color-fg-muted)]">
              <div className="h-1 w-1 animate-pulse rounded-full bg-[var(--color-accent)]" />
              <span>Warming a real Chromium, taking a snapshot, asking AI to pick fields…</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: APPLE_EASE }}
            className="mt-3 flex items-start gap-2 rounded-lg border border-[color:var(--color-danger)]/30 bg-[var(--color-danger-soft)] p-2.5 text-[12px] text-[var(--color-fg)]"
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0 text-[color:var(--color-danger)]" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-[12px] text-[var(--color-fg-subdued)]">
        <span>Try</span>
        {TRY_LINKS.map((t) => (
          <button
            key={t.url}
            onClick={() => { setUrl(t.url); }}
            disabled={busy}
            className="rounded-md border border-transparent px-1.5 py-0.5 font-mono text-[var(--color-fg-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Describe mode — URL + natural-language description in one panel.
 * Submit hands off to /ai-extract with both prefilled, which auto-fires
 * generation so it feels like one continuous flow.
 */
function DescribeMode() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const valid = url.trim().length > 0 && desc.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    setBusy(true);
    const qs = new URLSearchParams({ url: u, description: desc.trim() });
    router.push(`/ai-extract?${qs.toString()}`);
  }

  return (
    <div>
      <motion.form
        onSubmit={submit}
        animate={{
          borderColor: focused ? "var(--color-fg)" : "var(--color-border)",
        }}
        whileHover={focused ? undefined : { borderColor: "var(--color-border-strong)" }}
        transition={{ duration: 0.16, ease: APPLE_EASE }}
        className="relative w-full overflow-hidden rounded-xl border bg-[var(--color-surface)]"
      >
        {/* URL row */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
          <Globe className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-fg-subdued)]" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="https://news.ycombinator.com"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="flex-1 bg-transparent font-mono text-[13px] tracking-[var(--tracking-mono)] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subdued)] focus:outline-none"
          />
        </div>

        {/* Description row */}
        <div className="px-4 pt-3 pb-2">
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="What do you want to extract? e.g. Get every story's title, points, and comment count."
            rows={2}
            autoFocus
            maxLength={500}
            className="block w-full resize-none bg-transparent text-left text-[14px] leading-[1.5] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subdued)] focus:outline-none"
          />
        </div>

        {/* Footer row with submit */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-ink-1)] px-3 py-2">
          <div className="font-mono text-[10.5px] text-[var(--color-fg-subdued)]">
            {desc.length}/500
          </div>
          <motion.button
            type="submit"
            disabled={busy || !valid}
            whileTap={valid && !busy ? { scale: 0.96 } : undefined}
            animate={{
              backgroundColor: valid ? "var(--color-accent)" : "var(--color-ink-4)",
              opacity: valid ? 1 : 0.5,
            }}
            transition={{ duration: 0.16, ease: APPLE_EASE }}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 font-medium text-[12.5px] text-white disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate scraper
          </motion.button>
        </div>
      </motion.form>

      {/* Example chips — one-click prefill */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-left">
        <span className="mr-1 text-[11.5px] text-[var(--color-fg-subdued)]">Try</span>
        {DESCRIBE_EXAMPLES.map((ex) => (
          <button
            key={ex.url}
            type="button"
            onClick={() => { setUrl(ex.url); setDesc(ex.desc); }}
            className="group inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)] hover:text-[var(--color-fg)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
          >
            <Sparkles className="h-2.5 w-2.5 text-[var(--color-accent)]" />
            <span className="font-mono">{new URL(ex.url).host.replace(/^www\./, "")}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Static demo strip. Two panes: "what you click" + "what you get back".
 * Window chrome makes it look real. Mock data, real component primitives.
 */
function DemoStrip() {
  const sample = [
    { title: "Show HN: A tool for AI agents to scrape any website", points: 412, comments: 87, by: "rushi_k" },
    { title: "Cloudflare's new bot defense is breaking the open web", points: 287, comments: 142, by: "datapunk" },
    { title: "We replaced our Selenium farm with CDP patches", points: 198, comments: 64, by: "stealthbuild" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]">
      {/* Window chrome */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1">
          <div className="mx-auto flex max-w-md items-center gap-1.5 rounded-md bg-[var(--color-surface)] px-3 py-1 font-mono text-[11px] text-[var(--color-fg-muted)]">
            <Globe className="h-3 w-3 text-[var(--color-fg-subdued)]" />
            news.ycombinator.com
          </div>
        </div>
        <div className="font-mono text-[10px] text-[var(--color-fg-subdued)]">3 fields · 30 rows</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr]">
        {/* Left: page with highlighted selectors */}
        <div className="border-b border-[var(--color-border)] p-5 md:border-b-0 md:border-r">
          <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
            Page · clicked fields
          </div>
          <div className="space-y-2">
            {sample.map((row, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.6 + i * 0.05, ease: APPLE_EASE }}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-3"
              >
                <div className="text-[12px] leading-[1.45] text-[var(--color-fg)]">
                  <span className="rounded-sm bg-[var(--color-accent-soft)] px-0.5 py-px ring-1 ring-[var(--color-accent-line)]">
                    {row.title}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-[var(--color-fg-muted)]">
                  <span>
                    <span className="rounded-sm bg-[var(--color-info-soft)] px-0.5 py-px ring-1 ring-[color:var(--color-info)]/20">
                      {row.points}
                    </span>{" "}
                    points
                  </span>
                  <span className="text-[var(--color-fg-subdued)]">·</span>
                  <span>
                    by{" "}
                    <span className="rounded-sm bg-[var(--color-warning-soft)] px-0.5 py-px ring-1 ring-[color:var(--color-warning)]/20">
                      {row.by}
                    </span>
                  </span>
                </div>
              </motion.div>
            ))}
            <div className="pt-1 text-center font-mono text-[10px] text-[var(--color-fg-subdued)]">
              … 27 more rows
            </div>
          </div>
        </div>

        {/* Right: clean JSON */}
        <div className="bg-[var(--color-ink-1)] p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Output · clean JSON
            </div>
            <div className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--color-accent)]">
              <Check className="h-2.5 w-2.5" /> 200 OK · 1.2s
            </div>
          </div>
          <pre className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-[10.5px] leading-[1.6] text-[var(--color-fg)]">
{`[
  {
    "title": "Show HN: A tool for AI agents to scrape any website",
    "points": 412,
    "comments": 87,
    "by": "rushi_k"
  },
  {
    "title": "Cloudflare's new bot defense is breaking the open web",
    "points": 287,
    "comments": 142,
    "by": "datapunk"
  },
  …
]`}
          </pre>
        </div>
      </div>
    </div>
  );
}
