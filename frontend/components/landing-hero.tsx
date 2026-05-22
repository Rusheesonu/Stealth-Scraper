"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, Loader2, Globe, Check, MousePointerClick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LandingPreviewModal } from "@/components/landing-preview-modal";
import { SLABanner } from "@/components/sla-banner";
import { ReviewBlock } from "@/components/review-block";
import { api, ApiError, type AntiBotBlockDetail, type PublicSnapshotResponse } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { getCohort, COHORT_COPY, type Cohort } from "@/lib/referrer";

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
function CohortHero() {
  const [cohort, setCohort] = useState<Cohort>("generic");
  useEffect(() => {
    // SSR returns 'generic'; re-evaluate after mount.
    setCohort(getCohort());
  }, []);
  const copy = COHORT_COPY[cohort];
  return (
    <>
      <motion.h1
        key={cohort}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.06, ease: APPLE_EASE }}
        className="text-[40px] font-semibold leading-[1.04] tracking-[-0.028em] text-[var(--color-fg-display)] sm:text-[52px]"
      >
        {copy.headline}
      </motion.h1>
      <motion.p
        key={cohort + "-sub"}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.12, ease: APPLE_EASE }}
        className="mx-auto mt-5 max-w-xl text-[15.5px] leading-[1.6] text-[var(--color-fg)]"
      >
        {copy.subhead}
      </motion.p>
    </>
  );
}

export function LandingHero({ authed = false }: { authed?: boolean } = {}) {
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
            {authed ? (
              <>
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                Welcome back · pick up where you left off
              </>
            ) : (
              <>
                <span className="font-mono">v2.0</span> · visual scraping for AI agents
              </>
            )}
          </Badge>
        </motion.div>

        <CohortHero />

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.18, ease: APPLE_EASE }}
          className="mx-auto mt-5 flex justify-center"
        >
          <SLABanner variant="hero" />
        </motion.div>

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
        className="relative mx-auto mt-14 max-w-5xl md:mt-16"
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
 * URL mode — single mono input.
 *
 * Behavior depends on auth state:
 *   - LOGGED OUT visitors → "Magic First Snapshot" (Jobs J1). Submit
 *     opens the dramatic preview modal which fires the public
 *     no-auth endpoint, shows live extraction inline, and only the
 *     follow-up CTAs (Edit / Save / Get code) push to signup. This is
 *     the wow moment for first-time landers.
 *   - LOGGED IN users → straight to the picker. The modal is the
 *     unlocking-the-product moment, not the daily flow. Once you're
 *     signed in we get out of your way — submit hops directly to
 *     /pick?url=... and you keep your scrape budget. Old flow.
 */
function UrlMode() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [preview, setPreview] = useState<PublicSnapshotResponse | null>(null);
  const [submittedUrl, setSubmittedUrl] = useState<string>("");
  const [error, setError] = useState<string>("");
  // Anti-bot 422 — structured detail from the backend. When set, the
  // modal renders the dedicated AntiBotBlock card instead of the generic
  // error phase. Null = no anti-bot block.
  const [antiBotBlock, setAntiBotBlock] = useState<AntiBotBlockDetail | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  // null while we resolve the session on mount; bool thereafter. We
  // disable submit during the resolve window (tiny — usually <50ms) so
  // we don't accidentally fire the wrong flow.
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);

  // Resolve auth state once on mount, and subscribe so logging in
  // mid-session (e.g. via another tab) flips us to the direct flow
  // without a refresh.
  useEffect(() => {
    const supabase = createClient();
    let mounted = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (mounted) setIsSignedIn(!!user);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => { if (mounted) setIsSignedIn(!!session?.user); },
    );
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

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
  // Disable while we don't yet know auth — prevents a brief "fire the
  // wrong flow" window during the initial getUser() resolution.
  const canSubmit = valid && isSignedIn !== null;
  const normalizedUrl = (() => {
    const t = url.trim();
    if (!t) return "";
    return /^https?:\/\//i.test(t) ? t : "https://" + t;
  })();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    // Logged-in users: skip the modal entirely. They already get the
    // wow moment every day — give them the fast path. Direct push to
    // the picker, where they have the full toolset + plan-aware UX.
    if (isSignedIn) {
      setBusy(true);
      router.push(`/pick?url=${encodeURIComponent(normalizedUrl)}`);
      return;
    }

    // Logged-out: open the modal IMMEDIATELY — visitor sees the loading
    // animation start, not a frozen button. The snapshot request fires
    // in parallel; modal swaps loader → result when it resolves.
    setBusy(true);
    setError("");
    setAntiBotBlock(null);
    setPreview(null);
    setSubmittedUrl(normalizedUrl);
    setModalOpen(true);
    try {
      const res = await api.publicSnapshotAndSuggest(normalizedUrl);
      setPreview(res);
    } catch (e) {
      // Anti-bot soft block (status 422 with structured detail). This is
      // the high-visibility case for the launch — render a friendly card
      // instead of a wall of JSON. Detail is preserved through ApiError.
      if (
        e instanceof ApiError &&
        e.status === 422 &&
        e.detail &&
        typeof e.detail === "object" &&
        (e.detail as { kind?: string }).kind === "anti_bot_block"
      ) {
        setAntiBotBlock(e.detail as AntiBotBlockDetail);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("429")) {
          setError("You've used your free previews for this hour. Sign up free for unlimited.");
        } else if (msg.toLowerCase().includes("plan limit")) {
          // Surface the backend's plain-text message; the modal turns
          // /pricing into a real link via PlanLimitText.
          setError(msg.replace(/^Plan limit:\s*/i, ""));
        } else if (msg.includes("502") || msg.toLowerCase().includes("snapshot failed")) {
          setError("Couldn't reach that page. Either the site is blocking bots, or the URL is wrong.");
        } else {
          setError(msg);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function closeModal() {
    setModalOpen(false);
    // Delay state reset so the exit animation can play before the
    // content disappears. Matches modal exit duration (~280ms).
    setTimeout(() => {
      setPreview(null);
      setError("");
      setAntiBotBlock(null);
      setSubmittedUrl("");
    }, 320);
  }

  // Anti-bot card's primary action: clear the form so the visitor can
  // try a different URL without remembering to close the modal first.
  function tryDifferentUrl() {
    setUrl("");
    closeModal();
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
          disabled={busy || !canSubmit}
          whileTap={canSubmit && !busy ? { scale: 0.96 } : undefined}
          animate={{
            backgroundColor: canSubmit ? "var(--color-fg-strong)" : "var(--color-ink-4)",
            opacity: canSubmit ? 1 : 0.55,
          }}
          transition={{ duration: 0.16, ease: APPLE_EASE }}
          className="mr-2 inline-flex h-10 items-center gap-1.5 rounded-md px-4 font-medium text-[13px] text-[var(--color-bg)] disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
          {/* Logged-in users see a verb that matches what happens (they
              jump to the picker, not a public preview). Logged-out get
              the conversion-friendly "Try free". */}
          {busy ? (isSignedIn ? "Opening…" : "Working…") : (isSignedIn ? "Open in picker" : "Try free")}
        </motion.button>
      </motion.form>

      {/* Loading + error states now live INSIDE the modal — see
          LandingPreviewModal. The form stays clean. */}

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

      {/* Magic-snapshot modal — opens instantly on submit, shows the
          dramatic loading animation while the snapshot runs, swaps to
          result phase when it lands. Replaces the old inline preview
          (which was cramped + hid the URL form). */}
      <LandingPreviewModal
        open={modalOpen}
        url={submittedUrl}
        preview={preview}
        error={error}
        antiBotBlock={antiBotBlock}
        onTryDifferentUrl={tryDifferentUrl}
        onClose={closeModal}
      />
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
          <div className="font-mono text-[11.5px] text-[var(--color-fg-muted)]">
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
  // Only show 2 rows to keep the static demo compact — the third row
  // pushed the demo below the fold on most laptop viewports. The
  // animated ClickFlowDemo lower on the page does the heavy lifting
  // for "see how it actually works"; this strip just proves "look,
  // the output is real JSON."
  const sample = [
    { title: "Show HN: A tool for AI agents to scrape any website", points: 412, comments: 87, by: "rushi_k" },
    { title: "Cloudflare's new bot defense is breaking the open web", points: 287, comments: 142, by: "datapunk" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]">
      {/* Window chrome — tighter (py-2 vs py-2.5) */}
      <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-ink-1)] px-3.5 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1">
          <div className="mx-auto flex max-w-md items-center gap-1.5 rounded-md bg-[var(--color-surface)] px-3 py-0.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
            <Globe className="h-3 w-3 text-[var(--color-fg-subdued)]" />
            news.ycombinator.com
          </div>
        </div>
        <div className="font-mono text-[11px] text-[var(--color-fg-muted)]">3 fields · 30 rows</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr]">
        {/* Left: page with highlighted selectors — tighter spacing,
            only 2 rows shown + cleaner overflow indicator. */}
        <div className="border-b border-[var(--color-border)] p-4 md:border-b-0 md:border-r">
          <div className="mb-2.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
            Page · clicked fields
          </div>
          <div className="space-y-1.5">
            {sample.map((row, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.6 + i * 0.05, ease: APPLE_EASE }}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5"
              >
                <div className="text-[12px] leading-[1.4] text-[var(--color-fg)]">
                  <span className="rounded-sm bg-[var(--color-accent-soft)] px-0.5 py-px ring-1 ring-[var(--color-accent-line)]">
                    {row.title}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-[var(--color-fg-muted)]">
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
            <div className="pt-0.5 text-center font-mono text-[11px] text-[var(--color-fg-muted)]">
              … 28 more
            </div>
          </div>
        </div>

        {/* Right: clean JSON */}
        <div className="bg-[var(--color-ink-1)] p-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Output · clean JSON
            </div>
            <div className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--color-accent)]">
              <Check className="h-3 w-3" /> 200 OK · 1.2s
            </div>
          </div>
          <pre className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 font-mono text-[12px] leading-[1.6] text-[var(--color-fg)]">
{`[
  {
    "title": "Show HN: A tool for AI agents...",
    "points": 412,
    "comments": 87,
    "by": "rushi_k"
  },
  … 29 more
]`}
          </pre>
        </div>
      </div>
    </div>
  );
}
