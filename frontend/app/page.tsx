import Link from "next/link";
import { Nav } from "@/components/nav";
import { UrlForm } from "@/components/url-form";
import { Badge } from "@/components/ui/badge";
import {
  MousePointerClick,
  Shield,
  Code,
  FileJson,
  AlertTriangle,
  FileX,
  Wrench,
  Check,
  ArrowRight,
} from "lucide-react";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Grid + glow */}
      <div className="bg-grid absolute inset-0 opacity-60" />
      <div className="absolute left-1/2 top-0 h-[500px] w-[1000px] -translate-x-1/2 bg-emerald-500/10 blur-[120px]" />

      <Nav />

      {/* HERO */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-16 pb-24 text-center">
        <Badge tone="accent" className="mb-6">
          Built for AI agents
        </Badge>
        <h1 className="mx-auto max-w-3xl text-5xl font-semibold tracking-tight md:text-6xl">
          Structured web data for{" "}
          <span className="text-[var(--color-accent)]">AI agents</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--color-muted)]">
          Click to define schemas — no XPath, no LLM-as-parser. Works on the
          toughest sites the rest of your stack can&apos;t reach.{" "}
          <span className="text-[var(--color-fg)]">Clean JSON, not markdown.</span>
        </p>

        <div className="mx-auto mt-10 max-w-xl">
          <UrlForm />
        </div>

        <div className="mx-auto mt-6 flex max-w-xl flex-wrap items-center justify-center gap-2 text-xs text-[var(--color-muted)]">
          <span>Try one:</span>
          <TryLink url="https://news.ycombinator.com" label="news.ycombinator.com" />
          <TryLink url="https://quotes.toscrape.com" label="quotes.toscrape.com" />
          <TryLink url="https://example.com" label="example.com" />
        </div>
      </section>

      {/* PROBLEM */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20 border-t border-[var(--color-border)]">
        <h2 className="mb-3 text-center text-3xl font-semibold tracking-tight">
          Why your agent&apos;s data pipeline keeps breaking
        </h2>
        <p className="mx-auto mb-12 max-w-2xl text-center text-[var(--color-muted)]">
          The web is full of anti-bot walls and unstructured HTML. Most tools
          weren&apos;t built for the schemas your agent actually needs.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Problem icon={<AlertTriangle />} title="Hard sites stop most scrapers">
            Cloudflare Turnstile, Datadome, Akamai — modern bot walls block
            most automation no matter how patched it is.
          </Problem>
          <Problem icon={<FileX />} title="Markdown ≠ schema">
            You scrape, then LLM-parse or hand-write extractors to get back to a
            real schema. Two systems, two failure modes, twice the cost.
          </Problem>
          <Problem icon={<Wrench />} title="DIY eats dev cycles">
            Selector maintenance, retries, lazy loaders, sticky banners — it&apos;s
            a second job. Your agent never ships.
          </Problem>
        </div>
      </section>

      {/* WHAT MAKES IT WORK */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20 border-t border-[var(--color-border)]">
        <h2 className="mb-3 text-center text-3xl font-semibold tracking-tight">
          Built by a data architect, for data pipelines
        </h2>
        <p className="mx-auto mb-12 max-w-2xl text-center text-[var(--color-muted)]">
          Four things that make Stealth-Scraper different from every other tool
          in your stack.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Feature icon={<MousePointerClick className="h-5 w-5" />} title="Click to pick">
            Visual schema picker. Hover, click, label. No XPath. No CSS
            selectors that break on the next deploy.
          </Feature>
          <Feature icon={<Shield className="h-5 w-5" />} title="CDP-level stealth">
            nodriver patches Chromium at the flag/CDP level — passes Cloudflare,
            Datadome, and Turnstile checks that defeat most other approaches.
          </Feature>
          <Feature icon={<Code className="h-5 w-5" />} title="API + templates">
            Save once, hit from your agent. Batch URLs, scheduled runs, REST API,
            row-aligned list extraction.
          </Feature>
          <Feature icon={<FileJson className="h-5 w-5" />} title="Schemas, not markdown">
            Every extraction returns clean structured fields. Ready for your
            vector DB, your DataFrame, your agent&apos;s context.
          </Feature>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 py-20 border-t border-[var(--color-border)]">
        <h2 className="mb-3 text-center text-3xl font-semibold tracking-tight">
          Pricing
        </h2>
        <p className="mx-auto mb-10 max-w-2xl text-center text-[var(--color-muted)]">
          Free to start. Pay as you grow. Cancel anytime.
        </p>
        <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <PricingCard
            name="Hobby"
            price="$29"
            features={["1,000 scrapes / mo", "Hard-site access", "Saved templates"]}
          />
          <PricingCard
            name="Pro"
            price="$99"
            features={["10,000 scrapes / mo", "REST API", "Scheduled runs"]}
            highlight
          />
          <PricingCard
            name="Business"
            price="$299"
            features={["100,000 scrapes / mo", "Team seats", "Priority support"]}
          />
        </div>
        <div className="text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-accent)] hover:underline"
          >
            See full pricing <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* CTA STRIP */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 py-20 border-t border-[var(--color-border)] text-center">
        <h2 className="mb-3 text-3xl font-semibold tracking-tight">
          Stop fighting Cloudflare. Start shipping your agent.
        </h2>
        <p className="mb-8 text-[var(--color-muted)]">
          100 scrapes / month free. No credit card. Sign up with your email.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-zinc-900 hover:opacity-90"
        >
          Get started — free <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      {/* FOOTER */}
      <footer className="relative z-10 mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-[var(--color-border)] px-6 py-10 text-xs text-[var(--color-muted)] md:flex-row">
        <div>© 2026 Stealth-Scraper</div>
        <nav className="flex items-center gap-6">
          <Link href="/pricing" className="hover:text-[var(--color-fg)]">
            Pricing
          </Link>
          <Link href="/login" className="hover:text-[var(--color-fg)]">
            Sign in
          </Link>
          <Link
            href="https://github.com/Rusheesonu/Stealth-Scraper"
            target="_blank"
            className="hover:text-[var(--color-fg)]"
          >
            GitHub
          </Link>
        </nav>
      </footer>
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

function Problem({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/40 p-6 backdrop-blur-sm">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-zinc-900 text-zinc-500 [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </div>
      <h3 className="mb-2 text-base font-semibold">{title}</h3>
      <p className="text-sm text-[var(--color-muted)]">{children}</p>
    </div>
  );
}

function PricingCard({
  name,
  price,
  features,
  highlight,
}: {
  name: string;
  price: string;
  features: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-6 ${
        highlight
          ? "border-[var(--color-accent)] bg-emerald-500/5"
          : "border-[var(--color-border)] bg-[var(--color-panel)]/40"
      } backdrop-blur-sm`}
    >
      <div className="mb-2 text-sm text-[var(--color-muted)]">{name}</div>
      <div className="mb-5">
        <span className="text-3xl font-semibold">{price}</span>
        <span className="ml-1 text-sm text-[var(--color-muted)]">/ mo</span>
      </div>
      <ul className="space-y-2 text-sm">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-[var(--color-accent)]" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
