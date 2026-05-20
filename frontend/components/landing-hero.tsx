"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, Globe, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { UrlForm } from "@/components/url-form";

const TRY_LINKS = [
  { label: "news.ycombinator.com", url: "https://news.ycombinator.com" },
  { label: "quotes.toscrape.com",  url: "https://quotes.toscrape.com" },
  { label: "books.toscrape.com",   url: "https://books.toscrape.com" },
];

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Hero — the landing's first viewport. Three jobs:
 *   1. Tell you what this is (badge + headline).
 *   2. Give you the primary affordance (URL field).
 *   3. Show, don't tell: a static demo strip directly below proves the
 *      product works without you having to do anything.
 *
 * The dotted-grid background gives the hero structural texture so the
 * URL field has something to sit against (no more floating in white space).
 * Motion is intentional: hero elements fade-up in a 60ms cascade.
 */
export function LandingHero() {
  return (
    <section className="relative -mx-6 overflow-hidden px-6 pb-12 pt-10 md:pb-16 md:pt-14">
      {/* Subtle dotted background grid — gives the hero a sense of place. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-[0.55] [mask-image:linear-gradient(to_bottom,black_0%,black_60%,transparent_100%)]"
        style={{
          backgroundImage: `radial-gradient(circle, color-mix(in srgb, var(--color-fg-subdued) 35%, transparent) 0.8px, transparent 0.8px)`,
          backgroundSize: "22px 22px",
          backgroundPosition: "center -8px",
        }}
        aria-hidden
      />
      {/* Soft accent wash behind the URL form, mimics Apple's hero gradients
          (very subtle — almost imperceptible, just enough to lift). */}
      <div
        className="pointer-events-none absolute left-1/2 top-[210px] h-[280px] w-[640px] -translate-x-1/2 opacity-[0.5]"
        style={{
          background: `radial-gradient(ellipse at center, var(--color-accent-faint) 0%, transparent 65%)`,
        }}
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
            <span className="font-mono">v2.0</span> · structured web data for AI agents
          </Badge>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: APPLE_EASE }}
          className="text-[40px] font-semibold leading-[1.04] tracking-[-0.028em] text-[var(--color-fg-display)] sm:text-[52px]"
        >
          Describe a page.<br />
          <span className="bg-gradient-to-br from-[var(--color-fg-display)] to-[color-mix(in_srgb,var(--color-fg-display)_60%,var(--color-accent))] bg-clip-text text-transparent">
            Get structured data.
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease: APPLE_EASE }}
          className="mx-auto mt-5 max-w-xl text-[15px] leading-[1.55] text-[var(--color-fg-muted)]"
        >
          Click the fields you want — or describe them in plain English. We load
          any page in a real browser, get past Cloudflare and Datadome, and
          return clean JSON. No XPath, no markdown to re-parse.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: APPLE_EASE }}
          className="mx-auto mt-8 max-w-xl"
        >
          <UrlForm
            size="lg"
            autoFocus
            placeholder="https://news.ycombinator.com"
            hint={
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5">
                <span>Try</span>
                {TRY_LINKS.map((t) => (
                  <Link
                    key={t.url}
                    href={`/pick?url=${encodeURIComponent(t.url)}`}
                    className="rounded-md border border-transparent px-1.5 py-0.5 font-mono text-[var(--color-fg-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
                  >
                    {t.label}
                  </Link>
                ))}
              </div>
            }
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.28, ease: APPLE_EASE }}
          className="mt-5 flex flex-wrap items-center justify-center gap-1.5 text-[12px] text-[var(--color-fg-subdued)]"
        >
          <Sparkles className="h-3 w-3 text-[var(--color-accent)]" />
          <span>Or</span>
          <Link href="/ai-extract" className="font-medium text-[var(--color-accent)] hover:underline underline-offset-2">
            describe what you want in plain English
          </Link>
          <span>— faster for one-offs.</span>
        </motion.div>
      </div>

      {/* Demo strip — proves the product without a click. Renders below the
          hero on the same panel so the eye flows from "type URL" into "see
          what comes back". Mock data, but the structure is real. */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.4, ease: APPLE_EASE }}
        className="relative mx-auto mt-14 max-w-5xl"
      >
        <DemoStrip />
      </motion.div>
    </section>
  );
}

/**
 * Static demo strip. Two panes: "what you click" (URL bar mock) and "what
 * you get back" (JSON output). Window chrome makes it feel real, not like
 * an ad. Same primitives as the actual product — same fonts, same radius,
 * same colors — so screenshotting just the demo would still look like the app.
 */
function DemoStrip() {
  const sample = [
    { title: "Show HN: A tool for AI agents to scrape any website", points: 412, comments: 87, by: "rushi_k" },
    { title: "Cloudflare's new bot defense is breaking the open web", points: 287, comments: 142, by: "datapunk" },
    { title: "We replaced our Selenium farm with CDP patches", points: 198, comments: 64, by: "stealthbuild" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]">
      {/* Window chrome — three Apple-style dots + URL bar */}
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
        {/* Left: the page, with highlighted selectors */}
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

        {/* Right: clean JSON output */}
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
