import Link from "next/link";
import {
  ArrowRight, Check, Sparkles, MousePointerClick, Shield, Code, FileJson,
  AlertTriangle, FileX, Wrench,
} from "lucide-react";
import { PageShell } from "@/components/nav";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle, Section } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LandingHero } from "@/components/landing-hero";

/**
 * Landing. Hero IS the URL paste input + a static demo strip showing
 * what comes back — product demonstrates itself in the first viewport.
 * No carousel, no feature grid above the fold.
 */

export default function Home() {
  return (
    <PageShell maxWidth="max-w-6xl" vPadding="flush">
      <LandingHero />
      <ProblemSection />
      <FeaturesSection />
      <AiExtractCta />
      <PricingTeaser />
      <CtaStrip />
    </PageShell>
  );
}

function ProblemSection() {
  const problems = [
    { icon: AlertTriangle, title: "Hard sites stop most scrapers", body: "Cloudflare Turnstile, Datadome, Akamai — modern bot walls block most automation no matter how patched." },
    { icon: FileX,         title: "Markdown ≠ schema",             body: "You scrape, then LLM-parse or hand-write extractors to get a real schema. Two systems, two failure modes." },
    { icon: Wrench,        title: "DIY eats dev cycles",           body: "Selector maintenance, retries, lazy loaders, sticky banners — a second job. Your agent never ships." },
  ];
  return (
    <Section eyebrow="The problem" title="Why your agent's data pipeline keeps breaking">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {problems.map((p) => (
          <Card key={p.title} density="comfortable">
            <p.icon className="mb-3 h-4 w-4 text-[var(--color-fg-subdued)]" />
            <CardTitle className="mb-2">{p.title}</CardTitle>
            <p className="text-[13px] leading-[1.6] text-[var(--color-fg-muted)]">{p.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function FeaturesSection() {
  const features = [
    { icon: MousePointerClick, title: "Click to pick",           body: "Visual schema picker. Hover, click, label. No XPath. No CSS selectors that break on the next deploy." },
    { icon: Shield,            title: "CDP-level stealth",       body: "nodriver patches Chromium at the flag/CDP level — passes Cloudflare, Datadome, Turnstile checks others can't reach." },
    { icon: Code,              title: "API + SDKs + MCP server", body: "Python, TypeScript, MCP. Drop into your AI agent or RAG pipeline in one line." },
    { icon: FileJson,          title: "Schemas, not markdown",   body: "Every extraction returns clean structured fields. Row-aligned lists. Ready for vector DB, DataFrame, agent context." },
  ];
  return (
    <Section eyebrow="What's different" title="Built by a data architect, for data pipelines">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <Card key={f.title} density="compact">
            <f.icon className="mb-3 h-4 w-4 text-[var(--color-accent)]" />
            <div className="mb-1.5 text-[14px] font-semibold tracking-tight text-[var(--color-fg-strong)]">{f.title}</div>
            <p className="text-[12px] leading-[1.55] text-[var(--color-fg-muted)]">{f.body}</p>
          </Card>
        ))}
      </div>
    </Section>
  );
}

function AiExtractCta() {
  return (
    <Section eyebrow="AI extract" title="One sentence in. Working scraper out.">
      <Link
        href="/ai-extract"
        className="group block overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]"
      >
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="border-b border-[var(--color-border)] p-8 md:border-b-0 md:border-r">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">You write</div>
            <p className="font-mono text-[13px] leading-[1.55] text-[var(--color-fg)]">
              &quot;Get every product title, price, rating, and review count from this Target page.&quot;
            </p>
          </div>
          <div className="p-8">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">You get (in &lt;1s)</div>
            <div className="space-y-1.5">
              {["product_title", "price", "rating", "review_count"].map((label) => (
                <div key={label} className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-[var(--color-accent)]" />
                  <code className="font-mono text-[12px] text-[var(--color-fg)]">{label}</code>
                </div>
              ))}
            </div>
            <div className="mt-4 inline-flex items-center gap-1 text-[12px] text-[var(--color-accent)] group-hover:underline underline-offset-2">
              Try AI extract <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </div>
      </Link>
    </Section>
  );
}

function PricingTeaser() {
  const tiers = [
    { name: "Free",      price: "$0",   features: ["100 scrapes/mo", "Soft sites"] },
    { name: "Hobby",     price: "$29",  features: ["1,000 scrapes/mo", "Hard sites"] },
    { name: "Pro",       price: "$99",  features: ["10,000 scrapes/mo", "API + SDKs", "Scheduled runs"], highlight: true },
    { name: "Business",  price: "$299", features: ["100,000 scrapes/mo", "Team seats", "Priority"] },
  ];
  return (
    <Section eyebrow="Pricing" title="Pay as you grow. Cancel anytime.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiers.map((t) => (
          <Card
            key={t.name}
            density="comfortable"
            className={t.highlight ? "border-[color:var(--color-accent)]/40 ring-1 ring-[color:var(--color-accent)]/20" : ""}
          >
            <div className="mb-1 flex items-baseline justify-between">
              <div className="text-[14px] font-semibold tracking-tight">{t.name}</div>
              {t.highlight && <Badge tone="accent" size="xs">popular</Badge>}
            </div>
            <div className="mb-4 flex items-baseline gap-1">
              <span className="text-[28px] font-semibold tracking-tight text-[var(--color-fg-strong)]">{t.price}</span>
              <span className="text-[12px] text-[var(--color-fg-muted)]">/mo</span>
            </div>
            <ul className="space-y-1.5 text-[12px] text-[var(--color-fg-muted)]">
              {t.features.map((f) => (
                <li key={f} className="flex items-center gap-1.5"><Check className="h-3 w-3 text-[var(--color-accent)]" />{f}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <div className="mt-6 text-center">
        <Link href="/pricing" className="inline-flex items-center gap-1 text-[13px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
          See full pricing <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </Section>
  );
}

function CtaStrip() {
  return (
    <section className="relative -mx-6 overflow-hidden px-6 py-16 text-center">
      {/* Subtle accent wash to lift the final CTA off the page — Apple-style
          ambient gradient, not a banner block. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 mx-auto h-[200px] max-w-2xl -translate-y-1/2 opacity-60"
        style={{ background: "radial-gradient(ellipse at center, var(--color-accent-faint) 0%, transparent 70%)" }}
        aria-hidden
      />
      <div className="relative">
        <h2 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-[var(--color-fg-strong)]">
          Stop fighting Cloudflare.<br />Start shipping your agent.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[14px] text-[var(--color-fg-muted)]">
          100 scrapes / month free. No credit card. Sign up with your email.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/login?mode=signup">
            <Button variant="primary" size="lg">Get started — free <ArrowRight className="h-4 w-4" /></Button>
          </Link>
          <Link href="/ai-extract">
            <Button variant="secondary" size="lg"><Sparkles className="h-4 w-4" />Try AI extract</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
