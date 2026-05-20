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
import { FeaturedTemplates } from "@/components/featured-templates";
import { ClickFlowDemo } from "@/components/click-flow-demo";
import { SdkPreview } from "@/components/sdk-preview";
import { OssSection } from "@/components/oss-section";
import { FounderNote } from "@/components/founder-note";
import { LandingFaq } from "@/components/landing-faq";

/**
 * Landing. Hero IS the URL paste input + a static demo strip showing
 * what comes back — product demonstrates itself in the first viewport.
 * No carousel, no feature grid above the fold.
 */

export default function Home() {
  return (
    <PageShell maxWidth="max-w-6xl" vPadding="flush">
      <LandingHero />
      <FeaturedTemplates />
      <ClickFlowDemo />
      <ProblemSection />
      <FeaturesSection />
      <SdkPreview />
      <AiExtractCta />
      <OssSection />
      <FounderNote />
      <PricingTeaser />
      <LandingFaq />
      <CtaStrip />
    </PageShell>
  );
}

function ProblemSection() {
  const problems = [
    {
      icon: FileX,
      title: "Prompt-and-pray doesn't scale",
      body: "Black-box AI scrapers look magical until you need to debug. Wrong field? Re-prompt. Schema drifted? Re-prompt. You can't fix what you can't see.",
    },
    {
      icon: Wrench,
      title: "Every API call is stateless",
      body: "Most scraping APIs are one-shot. No saved recipe. You re-extract from scratch on every URL — paying for the same schema generation again and again.",
    },
    {
      icon: AlertTriangle,
      title: "Cloudflare hates your Playwright",
      body: "Modern bot walls (Cloudflare, Datadome, Akamai) block most automation. Most APIs use vanilla Playwright. We use nodriver — CDP-patched, undetectable.",
    },
  ];
  return (
    <Section eyebrow="The problem" title="Why scrapers built for AI agents keep failing">
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
    {
      icon: MousePointerClick,
      title: "Visual picker, not prompts",
      body: "Click any field on the page. See the selector. See the value before extraction. Edit live. Save when ready.",
    },
    {
      icon: FileJson,
      title: "Recipes you save and reuse",
      body: "Define a schema once. Run it on 1,000 URLs. Share with your team. Fork community templates. Version your selectors like code.",
    },
    {
      icon: Shield,
      title: "Through any bot wall",
      body: "CDP-level Chromium patches via nodriver — passes Cloudflare Turnstile, Datadome, Akamai checks that vanilla Playwright trips on.",
    },
    {
      icon: Code,
      title: "Drop into your stack",
      body: "REST API, Python + TypeScript SDKs, MCP server for Claude Desktop / Cursor / Cline. One line of code to integrate.",
    },
  ];
  return (
    <Section eyebrow="The different shape" title="What you get that prompt-only scrapers can't ship">
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
    <Section
      eyebrow="AI assist (for when typing's faster than clicking)"
      title="Describe it. We draft the schema. You open it in the picker to verify."
    >
      <Link
        href="/ai-extract"
        className="group block overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]"
      >
        <div className="grid grid-cols-1 md:grid-cols-3">
          <div className="border-b border-[var(--color-border)] p-7 md:border-b-0 md:border-r">
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">You write</div>
            <p className="font-mono text-[12.5px] leading-[1.55] text-[var(--color-fg)]">
              &quot;Get every product&apos;s title, price, rating, and review count.&quot;
            </p>
          </div>
          <div className="border-b border-[var(--color-border)] p-7 md:border-b-0 md:border-r">
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">AI drafts (1s)</div>
            <div className="space-y-1">
              {["product_title", "price", "rating", "review_count"].map((label) => (
                <div key={label} className="flex items-center gap-2">
                  <Check className="h-3 w-3 flex-shrink-0 text-[var(--color-accent)]" />
                  <code className="font-mono text-[11.5px] text-[var(--color-fg)]">{label}</code>
                </div>
              ))}
            </div>
          </div>
          <div className="p-7">
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">You verify in the picker</div>
            <p className="mb-3 text-[12.5px] leading-[1.55] text-[var(--color-fg-muted)]">
              Open the AI draft in the visual picker. Confirm selectors, edit
              what&apos;s off, save the recipe. <span className="text-[var(--color-fg)]">No more hoping the AI got it right.</span>
            </p>
            <div className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--color-accent)] group-hover:underline underline-offset-2">
              Try AI assist <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </div>
      </Link>
    </Section>
  );
}

function PricingTeaser() {
  const tiers = [
    { name: "Free",      price: "$0",   features: ["50 scrapes/mo", "Soft sites"] },
    { name: "Hobby",     price: "$29",  features: ["1,000 scrapes/mo", "Hard sites"] },
    { name: "Pro",       price: "$99",  features: ["10,000 scrapes/mo", "API + SDKs", "Scheduled runs"], highlight: true },
    { name: "Business",  price: "$299", features: ["100,000 scrapes/mo", "Team seats", "Priority"] },
  ];
  return (
    <Section eyebrow="Pricing" title="Pay as you grow. Cancel anytime.">
      <p className="mx-auto mb-6 max-w-2xl text-center text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
        Every scrape is one <strong className="text-[var(--color-fg)]">new data point</strong>, not a re-prompt.
        Save a recipe once, then 10,000 runs = 10,000 new rows — your saved selectors
        never re-pay for schema generation.
      </p>
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
          Save the recipe.<br />Run it forever.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[14px] text-[var(--color-fg-muted)]">
          Stop re-prompting on every URL. Build the schema once, ship your
          agent. 50 free scrapes / month — no card required.
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
