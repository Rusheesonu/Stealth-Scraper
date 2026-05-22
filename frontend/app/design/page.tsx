"use client";

import { useState } from "react";
import {
  ArrowRight, Check, Sparkles, Database, Globe, Shield, Zap, Copy,
  AlertTriangle, Loader2, X,
} from "lucide-react";
import { PageShell } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge, Kbd } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, Section } from "@/components/ui/card";
import { UrlForm } from "@/components/url-form";
import { Brand } from "@/components/brand";

/**
 * Design direction page. The single source of truth for the system —
 * if a component looks different elsewhere, this page wins.
 */

const NEUTRAL_SWATCHES = [
  { token: "--color-ink-0", label: "Canvas",       use: "page bg" },
  { token: "--color-ink-1", label: "Surface",      use: "cards, panels" },
  { token: "--color-ink-2", label: "Elevated",     use: "modals, popovers, hover" },
  { token: "--color-ink-3", label: "Border",       use: "default separator" },
  { token: "--color-ink-4", label: "Border-strong", use: "focus, active" },
  { token: "--color-ink-5", label: "Subdued",      use: "placeholders, disabled" },
  { token: "--color-ink-6", label: "Muted",        use: "secondary text" },
  { token: "--color-ink-7", label: "Fg",           use: "primary text" },
  { token: "--color-ink-8", label: "Fg-strong",    use: "headings, emphasis" },
];

const SEMANTIC = [
  { token: "--color-accent",  label: "Accent",  use: "primary CTA, active state" },
  { token: "--color-success", label: "Success", use: "operational, paid, ok" },
  { token: "--color-warning", label: "Warning", use: "quota approaching, attention" },
  { token: "--color-danger",  label: "Danger",  use: "errors, destructive actions" },
  { token: "--color-info",    label: "Info",    use: "neutral notice, rarely used" },
];

const TYPE_SPECIMEN = [
  { token: "--text-display", label: "Display",  example: "Structured web data" },
  { token: "--text-h1",      label: "H1",       example: "Saved templates" },
  { token: "--text-h2",      label: "H2",       example: "Generated schema" },
  { token: "--text-body",    label: "Body",     example: "Click to define schemas — no XPath, no LLM-as-parser." },
  { token: "--text-small",   label: "Small",    example: "5 of 5 components operational" },
  { token: "--text-tiny",    label: "Tiny",     example: "Updated 2m ago · sub_2169310" },
];

export default function DesignPage() {
  return (
    <PageShell maxWidth="max-w-5xl">
      <Hero />
      <PaletteSection />
      <TypeSection />
      <SpacingSection />
      <SignatureSection />
      <ComponentsSection />
      <StatesSection />
      <ConsistencyCheck />
    </PageShell>
  );
}

function Hero() {
  return (
    <header className="py-16">
      <Badge tone="accent" className="mb-5">v1 · design direction</Badge>
      <h1 className="mb-6 text-[40px] font-semibold leading-[1.05] tracking-[-0.025em] text-[var(--color-fg-strong)]">
        A precision instrument,<br />not a SaaS dashboard.
      </h1>
      <p className="max-w-2xl text-[14px] leading-[1.6] text-[var(--color-fg-muted)]">
        Stealth-Scraper extracts structured data from the open web. The UI
        treats selectors, URLs, and JSON as first-class — not chrome to be
        hidden. Monospace where it counts, calm color, deliberate density.
        The product trusts the user; the design trusts the product.
      </p>
      <div className="mt-10 flex items-center gap-3">
        <a href="#palette"><Button variant="secondary" size="md">Color →</Button></a>
        <a href="#type"><Button variant="secondary" size="md">Type →</Button></a>
        <a href="#components"><Button variant="secondary" size="md">Components →</Button></a>
        <a href="#consistency" className="ml-auto"><Button variant="ghost" size="md">Consistency check ↓</Button></a>
      </div>
    </header>
  );
}

function PaletteSection() {
  return (
    <div id="palette">
      <Section eyebrow="Color" title="One neutral ramp, one accent, one semantic set" description="Dark mode is primary. Accent is reserved for primary actions, active state, and the 'data we care about' indicator on the brand mark. If you're reaching for accent for decoration, stop.">
        <div className="space-y-4">
          <SwatchRow label="Neutral · 9 steps" swatches={NEUTRAL_SWATCHES} />
          <SwatchRow label="Semantic · 5 tones" swatches={SEMANTIC} />
        </div>
      </Section>
    </div>
  );
}

function SwatchRow({ label, swatches }: { label: string; swatches: { token: string; label: string; use: string }[] }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">{label}</div>
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
        {swatches.map((s, i) => (
          <div
            key={s.token}
            className={`flex items-center gap-4 px-3 py-2.5 text-[13px] ${i > 0 ? "border-t border-[var(--color-border)]" : ""}`}
          >
            <div
              className="h-8 w-12 flex-shrink-0 rounded-sm border border-[var(--color-border)]"
              style={{ background: `var(${s.token})` }}
            />
            <div className="flex-1">
              <div className="font-semibold text-[var(--color-fg)]">{s.label}</div>
              <div className="font-mono text-[11px] text-[var(--color-fg-subdued)]">{s.token}</div>
            </div>
            <div className="text-[var(--color-fg-muted)]">{s.use}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TypeSection() {
  return (
    <div id="type">
      <Section eyebrow="Type" title="Inter for UI, JetBrains Mono for data" description="Six-step scale with explicit line-heights. Tracking tightens as size increases. Monospace earns the user's eye anywhere a string is technical — URLs, CSS selectors, IDs, timestamps, numerics.">
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
          {TYPE_SPECIMEN.map((t, i) => (
            <div key={t.token} className={`flex items-baseline gap-6 px-4 py-4 ${i > 0 ? "border-t border-[var(--color-border)]" : ""}`}>
              <div className="w-20 flex-shrink-0">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">{t.label}</div>
                <div className="font-mono text-[11px] text-[var(--color-fg-muted)]">{t.token.replace("--text-", "")}</div>
              </div>
              <div style={{ fontSize: `var(${t.token})`, lineHeight: 1.3 }} className="font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
                {t.example}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <Card density="compact">
            <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">UI face · Inter</div>
            <p className="text-[14px] text-[var(--color-fg)]">The quick brown fox jumps over the lazy dog. 0123456789</p>
          </Card>
          <Card density="compact">
            <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Mono · JetBrains Mono</div>
            <p className="font-mono text-[13px] text-[var(--color-fg)]">div.product-card &gt; h2.title:nth-of-type(1)</p>
          </Card>
        </div>
      </Section>
    </div>
  );
}

function SpacingSection() {
  const steps = [1, 2, 3, 4, 6, 8, 12, 16, 24];
  return (
    <Section eyebrow="Space" title="4px base grid" description="Pick a density per surface and don't mix. Marketing surfaces use comfortable; product surfaces use compact.">
      <div className="overflow-hidden rounded-lg border border-[var(--color-border)] p-4">
        <div className="space-y-2">
          {steps.map((s) => (
            <div key={s} className="flex items-center gap-3 text-[13px]">
              <div className="w-12 font-mono text-[11px] text-[var(--color-fg-subdued)]">{s * 4}px</div>
              <div className="w-12 font-mono text-[11px] text-[var(--color-fg-muted)]">--space-{s}</div>
              <div className="h-3 rounded-sm bg-[var(--color-accent)]/40" style={{ width: s * 4 }} />
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function SignatureSection() {
  return (
    <Section eyebrow="Signature" title="The URL paste input" description="The single most-touched component. This is the product's hero affordance — the bar that turns a URL into a working scraper. Mono font on the URL itself, inline submit on the right, focus state lifts the border rather than throwing a glow.">
      <UrlForm
        size="lg"
        placeholder="https://news.ycombinator.com"
        hint={<>Or try <a className="text-[var(--color-accent)] hover:underline" href="/pick?url=https://news.ycombinator.com">news.ycombinator.com</a></>}
      />
    </Section>
  );
}

function ComponentsSection() {
  const [copied, setCopied] = useState(false);
  return (
    <div id="components">
      <Section eyebrow="Components" title="Primitives, side-by-side" description="Every component below uses tokens from this page. Change a token and the change propagates.">
        <div className="space-y-6">
          {/* Buttons */}
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Buttons · 5 variants × 3 sizes</div>
            <Card density="compact">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <div className="space-y-2">
                  <div className="text-[11px] font-mono text-[var(--color-fg-subdued)]">primary</div>
                  <Button variant="primary" size="sm">Continue</Button>
                  <Button variant="primary" size="md">Continue</Button>
                  <Button variant="primary" size="lg">Continue</Button>
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-mono text-[var(--color-fg-subdued)]">accent</div>
                  <Button variant="accent" size="sm"><Sparkles className="h-3 w-3" />Generate</Button>
                  <Button variant="accent" size="md"><Sparkles className="h-3.5 w-3.5" />Generate</Button>
                  <Button variant="accent" size="lg"><Sparkles className="h-4 w-4" />Generate</Button>
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-mono text-[var(--color-fg-subdued)]">secondary</div>
                  <Button variant="secondary" size="sm">Cancel</Button>
                  <Button variant="secondary" size="md">Cancel</Button>
                  <Button variant="secondary" size="lg">Cancel</Button>
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-mono text-[var(--color-fg-subdued)]">ghost</div>
                  <Button variant="ghost" size="sm">Dismiss</Button>
                  <Button variant="ghost" size="md">Dismiss</Button>
                  <Button variant="ghost" size="lg">Dismiss</Button>
                </div>
                <div className="space-y-2">
                  <div className="text-[11px] font-mono text-[var(--color-fg-subdued)]">danger</div>
                  <Button variant="danger" size="sm">Delete</Button>
                  <Button variant="danger" size="md">Delete</Button>
                  <Button variant="danger" size="lg">Delete</Button>
                </div>
              </div>
            </Card>
          </div>

          {/* Inputs */}
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Inputs</div>
            <Card density="compact" className="space-y-3">
              <Input placeholder="Default input" />
              <Input mono placeholder="https://example.com — mono variant for URLs/selectors/IDs" />
              <Textarea rows={2} placeholder="Multi-line input — schedule descriptions, prompts, notes" />
            </Card>
          </div>

          {/* Badges */}
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Badges + keyboard hints</div>
            <Card density="compact">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="default">default</Badge>
                <Badge tone="accent">accent</Badge>
                <Badge tone="success">success</Badge>
                <Badge tone="warning">warning</Badge>
                <Badge tone="danger">danger</Badge>
                <Badge tone="info">info</Badge>
                <Badge tone="muted">muted</Badge>
                <span className="ml-2 text-[13px] text-[var(--color-fg-muted)]">·</span>
                <span className="ml-2 text-[13px] text-[var(--color-fg-muted)]">Save selector</span>
                <Kbd>⌘</Kbd>
                <Kbd>S</Kbd>
                <span className="ml-2 text-[13px] text-[var(--color-fg-muted)]">·</span>
                <span className="ml-2 text-[13px] text-[var(--color-fg-muted)]">Copy</span>
                <Kbd>⌘</Kbd>
                <Kbd>C</Kbd>
              </div>
            </Card>
          </div>

          {/* Cards */}
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Cards · 2 density tiers</div>
            <div className="grid grid-cols-2 gap-3">
              <Card density="comfortable">
                <CardHeader>
                  <CardTitle>Comfortable</CardTitle>
                </CardHeader>
                <p className="text-[13px] text-[var(--color-fg-muted)]">24px padding. Use on landing, pricing, marketing surfaces where the eye needs room.</p>
              </Card>
              <Card density="compact" interactive>
                <CardHeader>
                  <CardTitle>Compact + interactive</CardTitle>
                </CardHeader>
                <p className="text-[13px] text-[var(--color-fg-muted)]">16px padding. Use inside lists, dashboards, dense surfaces. Hover state shows it's clickable.</p>
              </Card>
            </div>
          </div>

          {/* Copyable */}
          <div>
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Copyable mono · 1-click, 1-frame confirmation</div>
            <Card density="compact">
              <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                <code className="flex-1 truncate font-mono text-[13px] text-[var(--color-fg)]">
                  div#search &gt; .a-section &gt; h2.titleline &gt; a
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText("div#search > .a-section > h2.titleline > a").catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                  className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </Card>
          </div>
        </div>
      </Section>
    </div>
  );
}

function StatesSection() {
  return (
    <Section eyebrow="States" title="Loading, empty, error" description="Skeletons match final layout, not generic spinners. Empty states ship a single clear next action. Errors are typed and recoverable.">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Loading */}
        <Card density="compact">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Loading skeleton</div>
          <div className="space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded-sm bg-[var(--color-elevated)]" />
            <div className="h-3 w-1/2 animate-pulse rounded-sm bg-[var(--color-elevated)]" />
            <div className="h-3 w-2/3 animate-pulse rounded-sm bg-[var(--color-elevated)]" />
          </div>
        </Card>
        {/* Empty */}
        <Card density="compact">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Empty state</div>
          <div className="rounded-md border border-dashed border-[var(--color-border)] p-6 text-center">
            <Database className="mx-auto h-5 w-5 text-[var(--color-fg-subdued)]" />
            <div className="mt-2 text-[13px] text-[var(--color-fg)]">No templates yet</div>
            <div className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]">Snapshot a URL to create your first.</div>
            <Button variant="secondary" size="sm" className="mt-3">New snapshot</Button>
          </div>
        </Card>
        {/* Error */}
        <Card density="compact">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Error</div>
          <div className="rounded-md border border-[color:var(--color-danger)]/30 bg-[var(--color-danger-dim)] p-3 text-[13px] text-[color:var(--color-danger)]">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <div>
                <div className="font-semibold text-[var(--color-fg-strong)]">Snapshot failed</div>
                <div className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-muted)]">502: connection refused</div>
                <Button variant="secondary" size="sm" className="mt-2.5">Try again</Button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function ConsistencyCheck() {
  return (
    <div id="consistency">
      <Section eyebrow="Consistency check" title="Every surface, same DNA" description="Below: the same primitives composed for landing, /pick chrome, /templates, /pricing tile, /status indicator, /ai-extract — proving the system holds without bespoke per-page styling.">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* Landing tile */}
          <Card density="comfortable">
            <CardHeader>
              <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Landing</div>
              <CardTitle>Structured web data for AI agents</CardTitle>
            </CardHeader>
            <UrlForm size="md" placeholder="https://..." />
          </Card>

          {/* Templates row */}
          <Card density="compact">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Templates row</div>
            <div className="flex items-center gap-3 rounded-md border border-[var(--color-border)] p-3">
              <Globe className="h-4 w-4 text-[var(--color-fg-muted)]" />
              <div className="flex-1">
                <div className="text-[13px] font-medium">Amazon product specs</div>
                <div className="font-mono text-[11px] text-[var(--color-fg-subdued)]">amazon.com · 7 fields · 142 runs</div>
              </div>
              <Badge tone="success">99.4% ok</Badge>
            </div>
          </Card>

          {/* Pricing tile */}
          <Card density="comfortable" className="relative">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Pricing tile</div>
            <CardHeader>
              <CardTitle>Pro</CardTitle>
            </CardHeader>
            <div className="mb-4 flex items-baseline gap-1">
              <span className="text-[32px] font-semibold tracking-tight text-[var(--color-fg-strong)]">$99</span>
              <span className="text-[13px] text-[var(--color-fg-muted)]">/mo</span>
            </div>
            <ul className="space-y-1.5 text-[13px] text-[var(--color-fg-muted)]">
              <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[var(--color-accent)]" /> 10,000 scrapes/mo</li>
              <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[var(--color-accent)]" /> REST API + SDKs</li>
            </ul>
            <Button variant="accent" size="md" className="mt-4 w-full">Start Pro</Button>
          </Card>

          {/* Status row */}
          <Card density="compact">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">Status indicator</div>
            <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] p-3">
              <div className="flex items-center gap-2.5">
                <span className="relative inline-flex h-2 w-2">
                  <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-accent)] opacity-40" />
                  <span className="relative h-2 w-2 rounded-full bg-[var(--color-accent)]" />
                </span>
                <span className="text-[13px]">All systems operational</span>
              </div>
              <span className="font-mono text-[11px] text-[var(--color-fg-subdued)]">5/5</span>
            </div>
          </Card>

          {/* AI extract chip */}
          <Card density="compact">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">/ai-extract input</div>
            <div className="space-y-2">
              <Input mono size="sm" placeholder="https://..." />
              <Textarea rows={2} placeholder="Get every product title, price, and rating." />
              <Button variant="accent" size="sm" className="w-full"><Sparkles className="h-3 w-3" />Generate scraper</Button>
            </div>
          </Card>

          {/* Pick chrome */}
          <Card density="compact">
            <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">/pick header chrome</div>
            <div className="flex items-center gap-2.5 rounded-md border border-[var(--color-border)] p-2.5">
              <Badge tone="muted"><Zap className="h-3 w-3" />247 elements</Badge>
              <code className="flex-1 truncate font-mono text-[11px] text-[var(--color-fg)]">news.ycombinator.com</code>
              <Button variant="primary" size="sm"><ArrowRight className="h-3 w-3" />Run</Button>
            </div>
          </Card>
        </div>
      </Section>

      <div className="mt-8 border-t border-[var(--color-border)] pt-6 text-center text-[13px] text-[var(--color-fg-subdued)]">
        <Shield className="mx-auto mb-2 h-4 w-4" />
        If a stranger screenshots any two pages and they don&apos;t feel like the same product — the system has failed. Hold the line.
      </div>
    </div>
  );
}
