import Link from "next/link";
import { ExternalLink, ArrowRight } from "lucide-react";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * /marketplace — seed templates. The backend `/api/marketplace` endpoint
 * is not shipped yet (would 404 forever), so we ship a hand-curated set
 * of starter URLs that drop straight into the picker. No fake fork
 * counts, no fabricated descriptions — just real, well-known scrape
 * targets that demonstrate the product. When the backend lands we'll
 * swap this for a `fetch`.
 */
type SeedTemplate = {
  name: string;
  description: string;
  url: string;
  fields: string[];
};

const SEED_TEMPLATES: SeedTemplate[] = [
  {
    name: "Hacker News — top stories",
    description: "The classic. Front-page stories with title, points, comment count, and submitter.",
    url: "https://news.ycombinator.com",
    fields: ["title", "points", "comments", "submitter", "url"],
  },
  {
    name: "GitHub Trending",
    description: "Today's trending repos — name, description, stars gained, primary language.",
    url: "https://github.com/trending",
    fields: ["repo", "description", "stars", "language", "stars_today"],
  },
  {
    name: "books.toscrape.com",
    description: "A practice-friendly bookstore. Title, price, rating, and stock for every book on the page.",
    url: "https://books.toscrape.com",
    fields: ["title", "price", "rating", "in_stock"],
  },
  {
    name: "quotes.toscrape.com",
    description: "A simple quotes site. Quote text, author name, and tags.",
    url: "https://quotes.toscrape.com",
    fields: ["quote", "author", "tags"],
  },
  {
    name: "Product Hunt — today",
    description: "Today's launches — name, tagline, upvote count, maker.",
    url: "https://www.producthunt.com",
    fields: ["name", "tagline", "upvotes", "maker"],
  },
];

export const metadata = {
  title: "Marketplace",
  description:
    "Seed scrape templates you can try in the picker — Hacker News, GitHub trending, books.toscrape, and more.",
};

export default function MarketplacePage() {
  return (
    <PageShell maxWidth="max-w-5xl">
      <div>
        <PageHeader
          eyebrow="Marketplace"
          title="Starter scrape recipes"
          description="A small set of well-known targets to try in the picker. Click any card and we'll open it ready to extract — saved templates and forking land in the next release."
          backHref="/"
          backLabel="Home"
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {SEED_TEMPLATES.map((t) => (
            <Card key={t.url} density="comfortable" className="flex flex-col">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold tracking-tight text-[var(--color-fg-strong)]">
                    {t.name}
                  </div>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener"
                    className="mt-0.5 inline-flex items-center gap-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                  >
                    {trimmedHost(t.url)}
                    <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                  </a>
                </div>
              </div>

              <p className="mb-3 text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
                {t.description}
              </p>

              <div className="mb-4 flex flex-wrap gap-1">
                {t.fields.slice(0, 6).map((f) => (
                  <Badge key={f} tone="default" size="xs">{f}</Badge>
                ))}
              </div>

              <Link
                href={`/pick?url=${encodeURIComponent(t.url)}`}
                className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] font-medium text-[var(--color-fg)] transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]"
              >
                Try in picker
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

function trimmedHost(url: string): string {
  try { return new URL(url).host; } catch { return url.slice(0, 50); }
}
