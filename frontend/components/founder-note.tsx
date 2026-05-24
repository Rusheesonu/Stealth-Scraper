"use client";

import { motion } from "framer-motion";
import { Quote } from "lucide-react";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * "From the founder" credibility block. For an unfunded solo founder
 * launching to AI builders, founder-market-fit is the single strongest
 * pre-launch trust signal you can ship. Pattern: Marc Lou (ShipFast),
 * Tony Dinh (TypingMind), Pieter Levels (NomadList) — they all lead
 * with their face + a one-line "I'm the guy who lived this pain."
 *
 * Photo is intentionally optional. If you don't have one yet, this
 * still works — the initials placeholder + the bio do the work. Replace
 * `photoUrl` with your real photo path when you have it (drop in
 * /public/founder.jpg or wherever).
 */

const FOUNDER = {
  name: "Rushi",
  role: "Founder, Stealth-Scraper",
  photoUrl: undefined as string | undefined, // → e.g. "/founder.jpg" once you have one
  pull: "I spent five years writing scrapers other people couldn't. This is the tool I wish I'd had on day one.",
  bio: [
    "I'm Rushi. Senior data engineer with 5+ years of production scraping — built 500+ pipelines for clients across e-commerce, lead gen, real estate, and AI training data.",
    "The same problem broke every Monday morning: a site updated their DOM, my client's pipeline went dark, and I burned hours fixing nth-of-type selectors that didn't help anyone.",
    "Stealth-Scraper is what that experience looks like as a product. Visual where AI tools are opaque. Stateless-killing where API tools forget. Cloudflare-first where Playwright dies. Built so my old self could ship in 15 minutes instead of 15 hours.",
  ],
  twitter: "https://x.com/stealthscraper",
  email: "rushikesh.koochana@gmail.com",
};

export function FounderNote() {
  return (
    <section className="relative mx-auto max-w-4xl py-10 md:py-14">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.4, ease: APPLE_EASE }}
        className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 md:p-10"
      >
        <Quote
          className="absolute right-8 top-8 h-10 w-10 text-[var(--color-fg-subdued)] opacity-15"
          aria-hidden
        />

        <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          From the founder
        </div>

        <blockquote className="relative max-w-2xl text-[20px] font-medium leading-[1.35] tracking-[-0.012em] text-[var(--color-fg-display)] sm:text-[20px]">
          &ldquo;{FOUNDER.pull}&rdquo;
        </blockquote>

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-[auto_1fr]">
          {/* Avatar */}
          <FounderAvatar name={FOUNDER.name} photoUrl={FOUNDER.photoUrl} />

          {/* Bio */}
          <div className="min-w-0">
            <div className="mb-0.5 text-[14px] font-semibold tracking-[-0.005em] text-[var(--color-fg-strong)]">
              {FOUNDER.name}
            </div>
            <div className="mb-3 font-mono text-[11px] text-[var(--color-fg-muted)]">
              {FOUNDER.role}
            </div>
            <div className="space-y-3 text-[15px] leading-[1.65] text-[var(--color-fg)]">
              {FOUNDER.bio.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3 text-[13px]">
              <a
                href={FOUNDER.twitter}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
              >
                @stealthscraper
              </a>
              <span className="text-[var(--color-fg-subdued)]">·</span>
              <a
                href={`mailto:${FOUNDER.email}`}
                className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
              >
                {FOUNDER.email}
              </a>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function FounderAvatar({ name, photoUrl }: { name: string; photoUrl?: string }) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-[var(--color-border)]"
      />
    );
  }
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[color-mix(in_srgb,var(--color-accent)_60%,var(--color-fg-strong))] text-[20px] font-semibold text-white ring-1 ring-[var(--color-border)]">
      {initials}
    </div>
  );
}
