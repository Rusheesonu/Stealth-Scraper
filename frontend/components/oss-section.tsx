"use client";

import { motion } from "framer-motion";
import { Star, GitBranch, Scale, ArrowRight, Terminal } from "lucide-react";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * OSS section — the "open source at the core" trust signal. Replaces
 * the bare GitHub link in the footer with a contextual on-page section
 * that explains the open vs hosted split, mentions the MIT license,
 * and gives a single intentional link out to the engine repo.
 *
 * Pattern matches what Linear, Vercel, Resend, Cal.com do: keep the
 * source-code link gated behind a section that ALSO carries the
 * positioning message, so the click is a conscious one — not a
 * "wait what's this random GitHub link in the footer" leak.
 */

const STATS = [
  { icon: Star,      label: "MIT licensed",       sub: "use it commercially, anywhere" },
  { icon: GitBranch, label: "Self-hostable",      sub: "the engine runs without our API" },
  { icon: Terminal,  label: "Active development", sub: "we ship to it every week" },
];

export function OssSection() {
  return (
    <section className="relative mx-auto max-w-5xl py-10 md:py-14">
      {/* CSS-only fade-up for the outer card. The stats column below
          still uses framer-motion because it does a staggered reveal
          based on viewport intersection. */}
      <div className="animate-fade-up relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {/* Subtle accent wash on the right side */}
        <div
          className="pointer-events-none absolute -right-32 top-1/2 h-[280px] w-[480px] -translate-y-1/2 opacity-50"
          style={{ background: "radial-gradient(ellipse at center, var(--color-accent-faint) 0%, transparent 65%)" }}
          aria-hidden
        />

        <div className="relative grid grid-cols-1 gap-8 p-8 md:grid-cols-[1.2fr_1fr] md:p-10">
          {/* Left — narrative */}
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              <Scale className="h-3 w-3 text-[var(--color-accent)]" />
              Open source at the core
            </div>
            <h2 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.018em] text-[var(--color-fg-display)] sm:text-[28px]">
              The hard part is open source.
            </h2>
            <p className="mt-4 max-w-md text-[16px] leading-[1.6] text-[var(--color-fg)]">
              The scraping engine — CDP-level Chromium patches, anti-bot stealth,
              the bits that get you through Cloudflare — is{" "}
              <span className="font-semibold text-[var(--color-fg-strong)]">MIT-licensed</span> and on
              GitHub. Self-host the engine. Use the hosted product for the visual
              picker, saved recipes, marketplace, and team features.
            </p>

            <a
              href="https://github.com/Rusheesonu/stealth-browser"
              target="_blank"
              rel="noreferrer"
              className="group mt-5 inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 text-[14px] font-medium text-[var(--color-fg)] transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]"
            >
              <GithubIcon className="h-3.5 w-3.5" />
              <span>stealth-browser</span>
              <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">/ on GitHub</span>
              <ArrowRight className="ml-1 h-3 w-3 text-[var(--color-fg-subdued)] transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* Right — stats */}
          <div className="relative">
            <div className="space-y-2">
              {STATS.map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, x: 8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.32, delay: 0.1 + i * 0.06, ease: APPLE_EASE }}
                  className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3"
                >
                  <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-faint)] ring-1 ring-inset ring-[var(--color-accent-line)]">
                    <s.icon className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-[var(--color-fg-strong)]">{s.label}</div>
                    <div className="mt-0.5 text-[14px] leading-[1.5] text-[var(--color-fg-muted)]">{s.sub}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Open vs hosted breakdown — dense bottom strip */}
        <div className="relative grid grid-cols-1 gap-px border-t border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2">
          <div className="bg-[var(--color-ink-1)] p-5">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Open · stealth-browser
            </div>
            <ul className="space-y-2 text-[14px] leading-[1.55] text-[var(--color-fg)]">
              <li className="flex items-start gap-2"><Dot /> Stealth Chromium runtime (nodriver + CDP patches)</li>
              <li className="flex items-start gap-2"><Dot /> Snapshot + element collection engine</li>
              <li className="flex items-start gap-2"><Dot /> Selector resolver (CSS + XPath + transforms)</li>
              <li className="flex items-start gap-2"><Dot /> Self-host with `pip install` or Docker</li>
            </ul>
          </div>
          <div className="bg-[var(--color-ink-1)] p-5">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Hosted · stealthscraper.dev
            </div>
            <ul className="space-y-2 text-[14px] leading-[1.55] text-[var(--color-fg)]">
              <li className="flex items-start gap-2"><Dot accent /> Visual point-and-click picker</li>
              <li className="flex items-start gap-2"><Dot accent /> Saved recipes + template marketplace</li>
              <li className="flex items-start gap-2"><Dot accent /> Scheduled scrapes, webhooks, API keys</li>
              <li className="flex items-start gap-2"><Dot accent /> Team workspaces, billing, support</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Dot({ accent }: { accent?: boolean }) {
  return (
    <span className={`mt-1.5 inline-block h-1 w-1 flex-shrink-0 rounded-full ${
      accent ? "bg-[var(--color-accent)]" : "bg-[var(--color-fg-subdued)]"
    }`} />
  );
}

/** GitHub Octocat — inline SVG so no asset round-trip + colors via currentColor. */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
