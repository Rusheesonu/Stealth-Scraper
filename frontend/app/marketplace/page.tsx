"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GitFork, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import { Nav } from "@/components/nav";
import { api, type PublicTemplate } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

export default function MarketplacePage() {
  const [templates, setTemplates] = useState<PublicTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forkingId, setForkingId] = useState<number | null>(null);

  async function load() {
    try {
      const list = await api.marketplace.list();
      setTemplates(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function handleFork(t: PublicTemplate) {
    setForkingId(t.id);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        window.location.href = `/login?next=/marketplace`;
        return;
      }
      const forked = await api.marketplace.fork(t.id);
      window.location.href = `/templates`;
      void forked;
    } catch (e) {
      alert("Fork failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setForkingId(null);
    }
  }

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="mb-10">
          <h1 className="mb-2 text-3xl font-semibold tracking-tight">
            Templates marketplace
          </h1>
          <p className="text-sm text-[var(--color-muted)]">
            Public extraction recipes shared by the community. Fork any of them
            into your account and start scraping in one click.
          </p>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!templates && !error && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading marketplace…
          </div>
        )}

        {templates && templates.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-16 text-center text-sm text-[var(--color-muted)]">
            <div className="mb-2 text-lg text-[var(--color-fg)]">
              No public templates yet
            </div>
            <p>Be the first — create a template, then publish it from your templates page.</p>
          </div>
        )}

        {templates && templates.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {templates.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/40 p-5 backdrop-blur-sm"
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{t.name}</div>
                    <a
                      href={t.source_url}
                      target="_blank"
                      rel="noopener"
                      className="mt-0.5 inline-flex items-center gap-1 truncate font-mono text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                    >
                      {trimmedHost(t.source_url)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-zinc-900 px-2 py-0.5 text-xs text-[var(--color-muted)]">
                    <GitFork className="h-3 w-3" />
                    {t.fork_count}
                  </div>
                </div>
                {t.description && (
                  <p className="mb-3 text-xs text-[var(--color-muted)]">
                    {t.description}
                  </p>
                )}
                <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
                  {t.fields.slice(0, 6).map((f, i) => (
                    <span
                      key={i}
                      className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-zinc-300"
                    >
                      {f.label}
                    </span>
                  ))}
                  {t.fields.length > 6 && (
                    <span className="rounded px-2 py-0.5 text-zinc-500">
                      +{t.fields.length - 6} more
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleFork(t)}
                  disabled={forkingId === t.id}
                  className="w-full rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-zinc-900 hover:opacity-90 disabled:opacity-50"
                >
                  {forkingId === t.id ? "Forking…" : "Fork into my account"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function trimmedHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 50);
  }
}
