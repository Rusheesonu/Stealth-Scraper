"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ExternalLink, GitFork, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { api, type PublicTemplate } from "@/lib/api";
import { cn, truncate } from "@/lib/utils";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Featured templates strip — Jobs J5 partial. Sits on the landing page
 * right under the hero. Pulls the top-forked public templates from the
 * marketplace endpoint, renders them as a 3-col grid that mimics the
 * "App Store today" pattern.
 *
 * Empty state matters: pre-launch the marketplace IS empty. Instead of
 * hiding the section (which loses SEO + impression value), we render
 * curated "starter templates" cards as a soft seed — once real public
 * templates exist, those replace the seed.
 */

type SeedTemplate = {
  name: string;
  source_url: string;
  description: string;
  fields: { label: string; kind: string }[];
  category: string;
  seed: true;
};

const SEED_TEMPLATES: SeedTemplate[] = [
  {
    name: "Hacker News — Top Stories",
    source_url: "https://news.ycombinator.com",
    description: "Title, points, author, comment count for every story on the front page.",
    fields: [
      { label: "title", kind: "list" },
      { label: "points", kind: "list" },
      { label: "author", kind: "list" },
      { label: "comments", kind: "list" },
    ],
    category: "social",
    seed: true,
  },
  {
    name: "Books to Scrape — Catalog",
    source_url: "https://books.toscrape.com",
    description: "Every book on the page — title, price, rating, in-stock status.",
    fields: [
      { label: "title", kind: "list" },
      { label: "price", kind: "list" },
      { label: "rating", kind: "list" },
      { label: "in_stock", kind: "list" },
    ],
    category: "ecommerce",
    seed: true,
  },
  {
    name: "Quotes to Scrape — All Quotes",
    source_url: "https://quotes.toscrape.com",
    description: "Every quote, its author, and the tags associated with it.",
    fields: [
      { label: "quote", kind: "list" },
      { label: "author", kind: "list" },
      { label: "tags", kind: "list" },
    ],
    category: "content",
    seed: true,
  },
  {
    name: "Indie Hackers — Product Posts",
    source_url: "https://www.indiehackers.com/products",
    description: "Product cards with name, tagline, revenue, founder name.",
    fields: [
      { label: "name", kind: "list" },
      { label: "tagline", kind: "list" },
      { label: "revenue", kind: "list" },
      { label: "founder", kind: "list" },
    ],
    category: "startup",
    seed: true,
  },
  {
    name: "Product Hunt — Today's Launches",
    source_url: "https://www.producthunt.com",
    description: "Today's products — name, tagline, upvotes, maker handle.",
    fields: [
      { label: "name", kind: "list" },
      { label: "tagline", kind: "list" },
      { label: "upvotes", kind: "list" },
      { label: "maker", kind: "list" },
    ],
    category: "startup",
    seed: true,
  },
  {
    name: "Real Estate Listing — Zillow Card",
    source_url: "https://www.zillow.com/homes/",
    description: "Listing price, address, beds, baths, square footage from a search result.",
    fields: [
      { label: "price", kind: "list" },
      { label: "address", kind: "list" },
      { label: "beds", kind: "list" },
      { label: "baths", kind: "list" },
      { label: "sqft", kind: "list" },
    ],
    category: "real-estate",
    seed: true,
  },
];

type Card = (PublicTemplate & { seed?: false }) | SeedTemplate;

export function FeaturedTemplates() {
  const [items, setItems] = useState<Card[]>(SEED_TEMPLATES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const live = await api.marketplace.list();
        if (live && live.length > 0) {
          // Mix: live templates first, fill with seeds if fewer than 6.
          const tagged: Card[] = live.slice(0, 6).map((t) => ({ ...t, seed: false as const }));
          const remaining = Math.max(0, 6 - tagged.length);
          setItems([...tagged, ...SEED_TEMPLATES.slice(0, remaining)]);
        }
      } catch {
        // Backend down (Hetzner not yet up) → silently fall back to seed.
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  return (
    <section className="relative mx-auto max-w-6xl py-10 md:py-14">
      {/* CSS-only fade-up. Cards below keep framer-motion for the
          per-card staggered entrance — visually it's worth the cost. */}
      <div className="animate-fade-up mb-8 flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
            <Sparkles className="h-3 w-3 text-[var(--color-accent)]" />
            Template library
          </div>
          <h2 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.018em] text-[var(--color-fg-display)] sm:text-[32px]">
            Skip the setup.<br className="sm:hidden" />
            <span className="text-[var(--color-fg-muted)]"> Start with a recipe.</span>
          </h2>
          <p className="mt-2 max-w-xl text-[14px] leading-[1.6] text-[var(--color-fg)]">
            Browse community-shared extraction recipes. Fork any one, run it on
            any matching page, customize the selectors as needed.
          </p>
        </div>
        <Link
          href="/marketplace"
          className="hidden shrink-0 items-center gap-1 self-end text-[13px] text-[var(--color-accent)] hover:underline sm:inline-flex"
        >
          Browse all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.slice(0, 6).map((card, i) => (
          <TemplateCard key={"id" in card ? card.id : card.source_url} card={card} index={i} />
        ))}
      </div>

      <div className="mt-8 text-center sm:hidden">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1 text-[13px] text-[var(--color-accent)] hover:underline"
        >
          Browse all templates <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </section>
  );
}

function TemplateCard({ card, index }: { card: Card; index: number }) {
  const isSeed = "seed" in card && card.seed === true;
  const host = (() => {
    try {
      return new URL(card.source_url).host.replace(/^www\./, "");
    } catch {
      return card.source_url.slice(0, 40);
    }
  })();

  // Clicking a card triggers the no-signup magic preview flow — same as
  // pasting that URL in the hero. Doesn't require the user to be logged in.
  function previewUrl() {
    // Just bounce to root with the URL pre-filled in the hash so the
    // landing-hero's URL field auto-populates. Simple, no router needed.
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    // Fire a custom event the hero listens to. (See landing-hero useEffect.)
    window.dispatchEvent(new CustomEvent("ss:prefill-url", { detail: card.source_url }));
  }

  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.36, delay: index * 0.05, ease: APPLE_EASE }}
      onClick={previewUrl}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left transition-[border-color,background,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
        "hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)] hover:-translate-y-0.5",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold tracking-[-0.005em] text-[var(--color-fg-strong)]">
            {card.name}
          </h3>
          <div className="mt-0.5 inline-flex items-center gap-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
            {host}
            <ExternalLink className="h-2.5 w-2.5 opacity-50" />
          </div>
        </div>
        {!isSeed && "fork_count" in card && card.fork_count > 0 && (
          <Badge tone="muted" size="xs">
            <GitFork className="h-2.5 w-2.5" />
            {card.fork_count}
          </Badge>
        )}
        {isSeed && (
          <Badge tone="accent" size="xs">starter</Badge>
        )}
      </div>

      <p className="mb-3 line-clamp-2 text-[12.5px] leading-[1.55] text-[var(--color-fg)]">
        {"description" in card && card.description
          ? truncate(card.description, 110)
          : "Saved extraction recipe."}
      </p>

      <div className="flex flex-wrap gap-1">
        {card.fields.slice(0, 5).map((f, i) => (
          <span
            key={i}
            className="inline-flex items-center rounded px-2 py-0.5 font-mono text-[11px] leading-none ring-1 ring-inset ring-[var(--color-border)] bg-[var(--color-ink-2)] text-[var(--color-fg-muted)]"
          >
            {f.label}
          </span>
        ))}
        {card.fields.length > 5 && (
          <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">+{card.fields.length - 5}</span>
        )}
      </div>

      {/* Hover CTA */}
      <div className="mt-4 inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--color-fg-muted)] transition-colors duration-[var(--dur-fast)] group-hover:text-[var(--color-accent)]">
        Try this →
      </div>
    </motion.button>
  );
}
