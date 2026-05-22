"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GitFork, Loader2, AlertTriangle, ExternalLink, Globe } from "lucide-react";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type PublicTemplate } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

export default function MarketplacePage() {
  const [templates, setTemplates] = useState<PublicTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forkingId, setForkingId] = useState<number | null>(null);

  async function load() {
    try { setTemplates(await api.marketplace.list()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  useEffect(() => { void load(); }, []);

  async function handleFork(t: PublicTemplate) {
    setForkingId(t.id);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { window.location.href = `/login?next=/marketplace`; return; }
      await api.marketplace.fork(t.id);
      window.location.href = `/templates`;
    } catch (e) {
      alert("Fork failed: " + (e instanceof Error ? e.message : String(e)));
    } finally { setForkingId(null); }
  }

  return (
    <PageShell maxWidth="max-w-5xl">
      <div>
        <PageHeader
          eyebrow="Marketplace"
          title="Community extraction recipes"
          description="Public templates shared by the community. Fork any of them into your account in one click — no setup, no schema-building."
          backHref="/"
          backLabel="Home"
        />

        {error && (
          <Card density="comfortable" className="mb-6 border-[color:var(--color-danger)]/30">
            <div className="flex items-start gap-2 text-[13px] text-[color:var(--color-danger)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              {error}
            </div>
          </Card>
        )}

        {!templates && !error && (
          <div className="flex items-center gap-2 text-[13px] text-[var(--color-fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading marketplace…
          </div>
        )}

        {templates && templates.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-16 text-center">
            <Globe className="mx-auto mb-3 h-6 w-6 text-[var(--color-fg-subdued)]" />
            <div className="text-[14px] font-medium text-[var(--color-fg)]">No public templates yet</div>
            <p className="mt-1.5 text-[13px] text-[var(--color-fg-muted)]">
              Be the first. Create a template, then publish it from your <Link href="/templates" className="text-[var(--color-accent)] hover:underline">templates page</Link>.
            </p>
          </div>
        )}

        {templates && templates.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <Card key={t.id} density="comfortable" className="flex flex-col">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold tracking-tight text-[var(--color-fg-strong)]">{t.name}</div>
                    <a
                      href={t.source_url}
                      target="_blank" rel="noopener"
                      className="mt-0.5 inline-flex items-center gap-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                    >
                      {trimmedHost(t.source_url)}
                      <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                    </a>
                  </div>
                  <Badge tone="muted" size="xs">
                    <GitFork className="h-2.5 w-2.5" />
                    {t.fork_count}
                  </Badge>
                </div>

                {t.description && (
                  <p className="mb-3 text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">{t.description}</p>
                )}

                <div className="mb-4 flex flex-wrap gap-1">
                  {t.fields.slice(0, 6).map((f, i) => (
                    <Badge key={i} tone="default" size="xs">{f.label}</Badge>
                  ))}
                  {t.fields.length > 6 && (
                    <span className="text-[11px] text-[var(--color-fg-subdued)]">+{t.fields.length - 6}</span>
                  )}
                </div>

                <Button
                  onClick={() => handleFork(t)}
                  disabled={forkingId === t.id}
                  variant="secondary"
                  size="sm"
                  className="mt-auto w-full"
                >
                  {forkingId === t.id ? "Forking…" : "Fork into my account"}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function trimmedHost(url: string): string {
  try { return new URL(url).host; } catch { return url.slice(0, 50); }
}
