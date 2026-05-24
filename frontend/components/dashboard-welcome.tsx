"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Play, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { PageShell } from "@/components/nav";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, type SavedTemplate } from "@/lib/api";

const DEMO_URL = "https://news.ycombinator.com/";

/**
 * Logged-in landing surface. Replaces the marketing page for signed-in
 * users so they don't get dumped back onto the value-prop pitch they
 * already bought into.
 *
 * Two states, smoothly:
 *   • First-time (no saved templates yet) → big welcome card with a
 *     pre-filled HN demo and a "run scrape" CTA. Plus a marketplace
 *     pointer for browsing what others built.
 *   • Returning (≥1 template) → last 5 templates with one-click run.
 *
 * Render path is client-only because /templates requires the session JWT
 * and we don't want to plumb a Bearer through SSR. The flash before the
 * skeleton is fine — it stays in PageShell so the nav is solid the whole
 * time.
 */
export function DashboardWelcome() {
  const router = useRouter();
  const [templates, setTemplates] = useState<SavedTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoUrl, setDemoUrl] = useState(DEMO_URL);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    async function load() {
      try { setTemplates(await api.listTemplates()); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }
    void load();
  }, []);

  function runDemo() {
    let v = demoUrl.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    setLaunching(true);
    router.push(`/pick?url=${encodeURIComponent(v)}`);
  }

  // Skeleton while templates list is loading. Avoids a flash of the
  // first-time welcome card for returning users.
  if (templates === null && !error) {
    return (
      <PageShell maxWidth="max-w-4xl">
        <div className="space-y-3">
          <div className="h-32 animate-pulse rounded-xl bg-[var(--color-surface)]" />
          <div className="h-24 animate-pulse rounded-xl bg-[var(--color-surface)]" />
          <div className="h-24 animate-pulse rounded-xl bg-[var(--color-surface)]" />
        </div>
      </PageShell>
    );
  }

  const isFirstTime = !error && templates && templates.length === 0;
  const recent = templates ? templates.slice(0, 5) : [];

  return (
    <PageShell maxWidth="max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      >
        {isFirstTime ? (
          <FirstTimeWelcome
            demoUrl={demoUrl}
            onDemoUrlChange={setDemoUrl}
            onRun={runDemo}
            launching={launching}
          />
        ) : (
          <ReturningDashboard
            templates={recent}
            error={error}
            demoUrl={demoUrl}
            onDemoUrlChange={setDemoUrl}
            onRun={runDemo}
            launching={launching}
          />
        )}
      </motion.div>
    </PageShell>
  );
}

function FirstTimeWelcome({
  demoUrl,
  onDemoUrlChange,
  onRun,
  launching,
}: {
  demoUrl: string;
  onDemoUrlChange: (v: string) => void;
  onRun: () => void;
  launching: boolean;
}) {
  return (
    <>
      <Card density="comfortable" className="border-[color:var(--color-accent)]/30 bg-[var(--color-accent-faint)]">
        <div className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          <Sparkles className="h-3 w-3 text-[var(--color-accent)]" />
          Welcome
        </div>
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] text-[var(--color-fg-strong)]">
          Hi! Let&apos;s run your first scrape.
        </h1>
        <p className="mt-2 max-w-lg text-[15px] leading-[1.6] text-[var(--color-fg)]">
          Paste any URL — or use the Hacker News demo below — to open the visual picker.
          Click any field on the page to extract it.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); onRun(); }}
          className="mt-5 flex flex-col gap-2 sm:flex-row"
        >
          <input
            value={demoUrl}
            onChange={(e) => onDemoUrlChange(e.target.value)}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-4 font-mono text-[13px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subdued)] focus:border-[var(--color-border-strong)] focus:outline-none"
            placeholder="https://..."
          />
          <Button type="submit" variant="primary" size="lg" disabled={launching || !demoUrl.trim()}>
            {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run scrape
          </Button>
        </form>
        <p className="mt-3 text-[13px] text-[var(--color-fg-muted)]">
          The HN demo always works — we use it as our known-good test page.
        </p>
      </Card>

      <Card density="comfortable" className="mt-4">
        <div className="text-[15px] font-semibold tracking-tight">Or browse templates other people built</div>
        <p className="mt-1 text-[14px] text-[var(--color-fg)]">
          Community-shared recipes for common sites. Fork one with a click and customize.
        </p>
        <Link href="/marketplace">
          <Button variant="secondary" size="sm" className="mt-3">
            Marketplace <ArrowRight className="h-3 w-3" />
          </Button>
        </Link>
      </Card>
    </>
  );
}

function ReturningDashboard({
  templates,
  error,
  demoUrl,
  onDemoUrlChange,
  onRun,
  launching,
}: {
  templates: SavedTemplate[];
  error: string | null;
  demoUrl: string;
  onDemoUrlChange: (v: string) => void;
  onRun: () => void;
  launching: boolean;
}) {
  return (
    <>
      <div className="mb-6">
        <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          Dashboard
        </div>
        <h1 className="text-[20px] font-semibold tracking-[-0.018em] text-[var(--color-fg-strong)]">
          Welcome back.
        </h1>
      </div>

      <Card density="comfortable" className="mb-6">
        <div className="mb-3 text-[15px] font-semibold tracking-tight text-[var(--color-fg-strong)]">
          Run a new scrape
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); onRun(); }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <input
            value={demoUrl}
            onChange={(e) => onDemoUrlChange(e.target.value)}
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-10 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 font-mono text-[13px] text-[var(--color-fg)] placeholder:text-[var(--color-fg-subdued)] focus:border-[var(--color-border-strong)] focus:outline-none"
            placeholder="https://..."
          />
          <Button type="submit" variant="primary" size="md" disabled={launching || !demoUrl.trim()}>
            {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Open picker
          </Button>
        </form>
      </Card>

      <div className="mb-3 flex items-baseline justify-between">
        <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          Recent templates
        </div>
        <Link href="/templates" className="text-[13px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
          All templates →
        </Link>
      </div>

      {error ? (
        <Card density="compact" className="border-[color:var(--color-danger)]/30 text-[13px] text-[color:var(--color-danger)]">
          Couldn&apos;t load templates: {error}
        </Card>
      ) : templates.length === 0 ? (
        <Card density="compact" className="text-[13px] text-[var(--color-fg-muted)]">
          No templates yet — open the picker above to save your first one.
        </Card>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                href={`/pick?url=${encodeURIComponent(t.source_url)}&template=${t.id}`}
                className="group flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-elevated)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[var(--color-fg-strong)]">{t.name}</div>
                  <div className="mt-0.5 truncate font-mono text-[13px] text-[var(--color-fg-muted)]">
                    {t.source_url}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[13px] text-[var(--color-fg-muted)] group-hover:text-[var(--color-accent)]">
                  <Play className="h-3 w-3" /> Run
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
