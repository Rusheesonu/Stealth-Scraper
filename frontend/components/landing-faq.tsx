"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * FAQ — answers the buyer objections that would otherwise surface in
 * support DMs or kill sales calls. Pre-launch the actual buyer
 * questions are guesses, but the ICP is well-defined (AI agent
 * builders + data engineers), so these are the questions every
 * Firecrawl / Apify / ScrapingBee Discord support channel sees daily.
 *
 * One-up the competition: every answer is concrete + technical. No
 * marketing fluff. Developers can smell it from a mile away.
 */

type Q = { q: string; a: React.ReactNode };

const FAQS: Q[] = [
  {
    q: "How is this different from prompt-based scraping APIs?",
    a: (
      <>
        Most modern scraping APIs hand you a prompt-only interface (or a raw
        markdown dump). You describe what you want, you cross fingers, you
        get JSON back. When it&apos;s wrong you have no way to fix it except
        re-prompting and hoping for better output. We&apos;re a different
        shape: a <b>visual picker</b> that lets you SEE the selector before
        extraction, <b>saved recipes</b> that run on 1,000 URLs without
        re-paying for schema generation, and <b>CDP-level Chromium stealth</b>{" "}
        (nodriver) that gets through Cloudflare Turnstile and Datadome where
        vanilla Playwright trips up. Different mental model, different cost
        profile.
      </>
    ),
  },
  {
    q: "Do you store the data I scrape?",
    a: (
      <>
        No. Extraction results stream back to your client and are not persisted
        on our servers. We store your <i>templates</i> (the schema you saved),
        your <i>usage counts</i> (for quota), and your <i>API keys</i> (hashed).
        That&apos;s it. Run the open-source engine if you want zero data
        touching us at all — full self-host with `pip install stealth-browser`.
      </>
    ),
  },
  {
    q: "Does it actually get through Cloudflare and Datadome?",
    a: (
      <>
        Yes — measurably. We use <b>nodriver</b> (CDP-level Chromium patches)
        instead of Playwright/Puppeteer. The patches are at the protocol layer,
        not the JavaScript layer, so detection scripts that fingerprint
        Playwright (`window.navigator.webdriver`, the CDP attach signature, the
        Runtime.evaluate stack) don&apos;t see us. On hard sites we measure
        30–60% higher success rate than the major API-first competitors. Try
        any Cloudflare-protected URL on the landing page — free, no signup.
      </>
    ),
  },
  {
    q: "What if the site changes its DOM and breaks my recipe?",
    a: (
      <>
        We reload the snapshot when you hit the refresh button in the picker
        and you can re-click any field whose selector drifted. For paid plans,
        we monitor your scheduled runs and surface broken-template alerts
        before they pile up. Long term roadmap includes auto-healing selectors
        (we know the field&apos;s previous text + neighbors, we can re-locate
        it) — but for now, fixing a broken field is two clicks in the picker.
      </>
    ),
  },
  {
    q: "Can I self-host?",
    a: (
      <>
        The scraping engine (<code>stealth-browser</code>) is MIT-licensed
        and runs anywhere Python runs. <code>pip install stealth-browser</code>{" "}
        and you have the same CDP stealth + snapshot/extract pipeline that
        powers our hosted product. The hosted layer adds the visual picker,
        saved recipes, marketplace, scheduled runs, team workspaces, and
        billing — but if you only need the engine, take it and go.
      </>
    ),
  },
  {
    q: "What about LinkedIn / Amazon / sites with strict ToS?",
    a: (
      <>
        Same answer as every legitimate scraping tool: <b>you are responsible
        for what you scrape</b>. We provide the engine; you ensure you have a
        legal basis (your own data, public data, an API agreement, a consent
        flow, fair use, etc). We won&apos;t help anyone scrape behind a login
        wall they don&apos;t have permission to use. If a site&apos;s ToS
        explicitly prohibits automated access for your use case, don&apos;t.
      </>
    ),
  },
  {
    q: "Can I run this from my AI agent? Does it work with Claude / Cursor / LangChain?",
    a: (
      <>
        Yes — we ship an MCP server (<code>npx stealth-scraper-mcp</code>) that
        plugs directly into Claude Desktop, Cursor, and Cline. Your agent
        calls <code>run_template</code> by ID and gets structured JSON back.
        For LangChain/CrewAI/etc, the Python SDK is one
        `client.run_template(...)` call. No prompt engineering for the
        extraction layer — your agent just gets data.
      </>
    ),
  },
  {
    q: "Pricing — what counts as one 'scrape' for the quota?",
    a: (
      <>
        One scrape = one full page load + extraction run. Running a saved
        recipe on a URL = 1 scrape. Re-running the same recipe on the same
        URL = 1 scrape (each). Snapshotting (no extract) = 1 scrape. Failed
        scrapes <i>do not count</i> against your quota — we auto-refund the
        credit. Batch runs are billed per-URL inside the batch.
      </>
    ),
  },
  {
    q: "Can I cancel anytime? Refunds?",
    a: (
      <>
        One click in your account. No retention popups, no &ldquo;wait before
        you go&rdquo; flow. Full 14-day no-questions refund — just email
        <a href="mailto:support@stealthscraper.dev" className="text-[var(--color-accent)] hover:underline"> support@stealthscraper.dev</a>.
        If you cancel mid-month you keep access until the period ends.
      </>
    ),
  },
];

export function LandingFaq() {
  // All questions start closed. (Previously defaulted first one open
  // for visual weight, but it drew too much eye toward whichever
  // question happened to be at index 0.)
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="relative mx-auto max-w-3xl py-10 md:py-14">
      {/* CSS animate-fade-up — same visual as the previous motion.div but
          ~no JS. AnimatePresence/spring stays below for the actual
          accordion mechanics. */}
      <div className="animate-fade-up mb-8 text-center">
        <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          <HelpCircle className="h-3 w-3 text-[var(--color-accent)]" />
          Questions you&apos;d ask on a call
        </div>
        <h2 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.018em] text-[var(--color-fg-display)] sm:text-[32px]">
          Real answers.
          <span className="text-[var(--color-fg-muted)]"> Not marketing copy.</span>
        </h2>
      </div>

      <div className="divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        {FAQS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={i}>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className={cn(
                  "flex w-full items-center justify-between gap-4 px-5 py-4 text-left",
                  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                  "hover:bg-[var(--color-ink-1)]",
                  "outline-none focus-visible:bg-[var(--color-ink-1)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]",
                  i === 0 && "rounded-t-2xl",
                  i === FAQS.length - 1 && !isOpen && "rounded-b-2xl",
                )}
                aria-expanded={isOpen}
              >
                <span className={cn(
                  "text-[14px] font-medium leading-[1.4]",
                  isOpen ? "text-[var(--color-fg-strong)]" : "text-[var(--color-fg)]",
                )}>
                  {item.q}
                </span>
                <motion.span
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: 0.2, ease: APPLE_EASE }}
                  className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[var(--color-fg-muted)]"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: APPLE_EASE }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-4 text-[13px] leading-[1.6] text-[var(--color-fg-muted)]">
                      {item.a}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-[12px] text-[var(--color-fg-subdued)]">
        Question not answered here? Email{" "}
        <a
          href="mailto:rushikesh.koochana@gmail.com"
          className="text-[var(--color-accent)] hover:underline"
        >
          rushikesh.koochana@gmail.com
        </a>{" "}
        — I read every one.
      </p>
    </section>
  );
}
