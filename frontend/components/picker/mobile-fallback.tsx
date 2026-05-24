"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Github,
  Laptop,
  Layers,
  Loader2,
  Mail,
  MousePointerClick,
} from "lucide-react";

import { Brand } from "@/components/brand";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

// Demo video CTA removed until a real demo lands. Previously hardcoded
// a placeholder YouTube URL that turned out to be a rickroll on the
// live site (caught by the May-22 pre-launch audit). When the real
// demo ships, restore a single primary `FallbackCta` with the URL.

/**
 * Mobile fallback for the visual picker. Rendered on touch-primary
 * devices (`(pointer: coarse)`) where click + drag is unreliable and
 * the picker UX falls apart on small screens.
 *
 * Goals (in order):
 *   1. Don't show a broken picker on phones. PH launch brings ~40%
 *      mobile traffic.
 *   2. Keep the visitor on the funnel — offer a demo video, a saved
 *      template, or "open in desktop later" reminder so they don't
 *      bounce.
 *   3. Capture intent — pre-filled email signup so we can ping them
 *      when the mobile flow lands.
 *
 * Visual: Apple-minimal vertical stack with generous spacing. No
 * crammed chrome — this is a "soft no" moment, not an error page.
 */
export function MobileFallback() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* Ambient dotted backdrop — same family as the landing hero so
          this doesn't feel like a different product. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[480px] opacity-[0.45] [mask-image:linear-gradient(to_bottom,black_0%,black_60%,transparent_100%)]"
        style={{
          backgroundImage: `radial-gradient(circle, color-mix(in srgb, var(--color-fg-subdued) 30%, transparent) 0.8px, transparent 0.8px)`,
          backgroundSize: "22px 22px",
        }}
        aria-hidden
      />

      {/* Top brand row — keeps the user oriented (this is still our
          product, not a 404). */}
      <div className="relative mx-auto flex w-full max-w-md items-center justify-between px-5 pt-6">
        <Link href="/" aria-label="Stealth Scraper home">
          <Brand />
        </Link>
        <Link
          href="/"
          className="font-mono text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          ← back home
        </Link>
      </div>

      <div className="relative mx-auto flex w-full max-w-md flex-col items-center px-5 pb-16 pt-12 text-center">
        {/* Icon tile — generous tap target sized, ambient accent halo
            behind it so the page has a focal point. */}
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: APPLE_EASE }}
          className="relative mb-7"
        >
          <span
            className="absolute inset-0 -z-10 rounded-3xl blur-2xl"
            style={{
              background:
                "radial-gradient(ellipse at center, var(--color-accent-faint) 0%, transparent 70%)",
            }}
            aria-hidden
          />
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface)] ring-1 ring-[var(--color-border)] shadow-[var(--shadow-card)]">
            <MousePointerClick className="h-7 w-7 text-[var(--color-accent)]" />
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05, ease: APPLE_EASE }}
          className="text-[28px] font-semibold leading-[1.15] tracking-[-0.018em] text-[var(--color-fg-display)]"
        >
          The picker needs a mouse
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: APPLE_EASE }}
          className="mt-3 max-w-sm text-[14px] leading-[1.6] text-[var(--color-fg-muted)]"
        >
          The visual picker uses click + drag, which doesn&apos;t work great
          on touch screens yet. We&apos;re shipping a mobile-friendly version
          soon.
        </motion.p>

        {/* CTA stack — three vertical actions, generous spacing. The
            primary is now the marketplace (the visitor can still get a
            product moment from saved templates without the picker), the
            secondary is the OSS engine repo (something concrete for the
            engineer cohort), the tertiary is purely informational. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: APPLE_EASE }}
          className="mt-8 flex w-full flex-col gap-2.5"
        >
          <FallbackCta
            href="/marketplace"
            icon={<Layers className="h-4 w-4" />}
            label="Try a saved template"
            sub="browse community recipes — no picker needed"
            primary
          />
          <FallbackCta
            href="https://github.com/Rusheesonu/stealth-browser"
            external
            icon={<Github className="h-4 w-4" />}
            label="Star the open-source engine"
            sub="the MIT-licensed core that powers the picker"
          />
          <FallbackCta
            icon={<Laptop className="h-4 w-4" />}
            label="Open in desktop"
            sub="visit stealthscraper.dev on a desktop browser"
            // No href — this is a text-only instruction. The CTA renders
            // as a non-interactive informational card so the user reads
            // the instruction without expecting a tap to do something.
            informational
          />
        </motion.div>

        {/* Email signup — optimistic UI, posts to /api/mobile-notify if
            it exists, otherwise falls back to localStorage so we never
            lose the intent. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.28, ease: APPLE_EASE }}
          className="mt-8 w-full"
        >
          <NotifyForm />
        </motion.div>
      </div>
    </main>
  );
}

function FallbackCta({
  href,
  external,
  icon,
  label,
  sub,
  primary,
  informational,
}: {
  href?: string;
  external?: boolean;
  icon: React.ReactNode;
  label: string;
  sub: string;
  primary?: boolean;
  informational?: boolean;
}) {
  const body = (
    <span
      className={[
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-[border-color,background,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        primary
          ? "border-[var(--color-fg-strong)] bg-[var(--color-fg-strong)] text-[var(--color-bg)]"
          : informational
            ? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)]"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]",
      ].join(" ")}
    >
      <span
        className={[
          "inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg",
          primary ? "bg-white/15" : "bg-[var(--color-ink-2)]",
        ].join(" ")}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={[
            "block text-[14px] font-medium leading-tight",
            primary ? "" : "text-[var(--color-fg)]",
          ].join(" ")}
        >
          {label}
        </span>
        <span
          className={[
            "mt-1 block text-[13px] leading-[1.45]",
            primary ? "text-white/80" : "text-[var(--color-fg-muted)]",
          ].join(" ")}
        >
          {sub}
        </span>
      </span>
      {!informational && (
        <ArrowRight
          className={[
            "h-4 w-4 flex-shrink-0",
            primary ? "text-white/70" : "text-[var(--color-fg-subdued)]",
          ].join(" ")}
        />
      )}
    </span>
  );

  if (informational || !href) {
    return <div>{body}</div>;
  }
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
  }
  return <Link href={href}>{body}</Link>;
}

/**
 * Email capture for "notify me when mobile lands". Optimistic — we
 * show success immediately so the visitor doesn't feel like the form
 * is broken if the stub endpoint isn't deployed yet. We POST to
 * /api/mobile-notify (best-effort, fire-and-forget) AND we always
 * persist to localStorage so we can replay later if we want.
 */
function NotifyForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    // Cheap validation — full RFC 5322 is overkill for a notify form.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("That email doesn't look right.");
      return;
    }
    setError(null);
    setState("submitting");

    // Always persist locally so we never lose the intent even if the
    // network request fails. Cheap insurance.
    try {
      const key = "mobile_notify_emails";
      const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(existing) && !existing.includes(trimmed)) {
        existing.push(trimmed);
        localStorage.setItem(key, JSON.stringify(existing));
      }
    } catch {
      // localStorage disabled / quota / private window — silently ignore.
    }

    // Best-effort POST to the stub route. If it doesn't exist we still
    // succeed (optimistic UI) — the localStorage record is the source
    // of truth for replay.
    try {
      await fetch("/api/mobile-notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, source: "picker-mobile-fallback" }),
      }).catch(() => {});
    } catch {
      // ignore — optimistic UI
    }

    setState("done");
  }

  if (state === "done") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--color-success-dim)] bg-[var(--color-success-dim)] px-4 py-3 text-[13px] text-[var(--color-success)]">
        <Check className="h-4 w-4" />
        <span>Got it — we&apos;ll email you when mobile is ready.</span>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 focus-within:border-[var(--color-fg)]">
        <Mail className="h-4 w-4 flex-shrink-0 text-[var(--color-fg-subdued)]" />
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          disabled={state === "submitting"}
          className="flex-1 bg-transparent text-[14px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subdued)] focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={state === "submitting" || !email}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--color-fg-strong)] px-3 text-[13px] font-medium text-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "submitting" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              Notify me <ArrowRight className="h-3 w-3" />
            </>
          )}
        </button>
      </div>
      {error ? (
        <p className="text-[13px] text-[var(--color-danger)]">{error}</p>
      ) : (
        <p className="text-[13px] leading-[1.5] text-[var(--color-fg-muted)]">
          One email when mobile lands. No marketing — promise.
        </p>
      )}
    </form>
  );
}
