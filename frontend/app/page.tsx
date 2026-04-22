import Link from "next/link";
import { Brand } from "@/components/brand";
import { UrlForm } from "@/components/url-form";
import { Badge } from "@/components/ui/badge";
import { MousePointerClick, Zap, Database, Download } from "lucide-react";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Grid + glow */}
      <div className="bg-grid absolute inset-0 opacity-60" />
      <div className="absolute left-1/2 top-0 h-[500px] w-[1000px] -translate-x-1/2 bg-emerald-500/10 blur-[120px]" />

      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Brand />
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/templates" className="text-[var(--color-muted)] hover:text-[var(--color-fg)]">
            Templates
          </Link>
          <Link
            href="https://github.com/Rusheesonu/Stealth-Scraper"
            className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            target="_blank"
          >
            GitHub
          </Link>
        </nav>
      </header>

      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-16 pb-24 text-center">
        <Badge tone="accent" className="mb-6">
          v2.0 — point & click
        </Badge>
        <h1 className="mx-auto max-w-3xl text-5xl font-semibold tracking-tight md:text-6xl">
          Scrape any website by{" "}
          <span className="text-[var(--color-accent)]">clicking</span> on it.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--color-muted)]">
          Paste a URL. We&apos;ll take a snapshot. You click the fields you want — title,
          price, image, anything. We save the recipe and run it on any matching page.{" "}
          <span className="text-[var(--color-fg)]">No XPath required.</span>
        </p>

        <div className="mx-auto mt-10 max-w-xl">
          <UrlForm />
        </div>

        <div className="mx-auto mt-6 flex max-w-xl flex-wrap items-center justify-center gap-2 text-xs text-[var(--color-muted)]">
          <span>Try:</span>
          <TryLink url="https://news.ycombinator.com" label="news.ycombinator.com" />
          <TryLink url="https://example.com" label="example.com" />
          <TryLink url="https://quotes.toscrape.com" label="quotes.toscrape.com" />
        </div>
      </section>

      <section className="relative z-10 mx-auto grid max-w-5xl grid-cols-1 gap-4 px-6 pb-24 md:grid-cols-4">
        <Feature icon={<MousePointerClick className="h-5 w-5" />} title="Click to pick">
          Hover-highlight and click any element on the screenshot. Label it. That&apos;s the
          whole config step.
        </Feature>
        <Feature icon={<Zap className="h-5 w-5" />} title="Playwright engine">
          Full JS-rendered page loads with stealth defaults. Works on SPAs, infinite
          scroll, and lazy images.
        </Feature>
        <Feature icon={<Database className="h-5 w-5" />} title="Save recipes">
          Each picker session becomes a saved template. Reuse it on 10 URLs or
          10,000 — same fields, one click.
        </Feature>
        <Feature icon={<Download className="h-5 w-5" />} title="JSON / CSV out">
          Export extracted data instantly. Or POST to the API and wire it into your
          pipeline.
        </Feature>
      </section>
    </main>
  );
}

function TryLink({ url, label }: { url: string; label: string }) {
  return (
    <Link
      href={`/pick?url=${encodeURIComponent(url)}`}
      className="rounded-full border border-[var(--color-border)] px-3 py-1 font-mono hover:border-emerald-800 hover:text-emerald-300"
    >
      {label}
    </Link>
  );
}

function Feature({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/40 p-5 backdrop-blur-sm">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-emerald-950/60 text-[var(--color-accent)]">
        {icon}
      </div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      <p className="text-xs text-[var(--color-muted)]">{children}</p>
    </div>
  );
}
