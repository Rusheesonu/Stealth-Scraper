"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Play, Trash2, ExternalLink } from "lucide-react";
import { api, type ExtractResponse, type SavedTemplate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ResultsPanel } from "@/components/picker/results-panel";

export function TemplatesList() {
  const [templates, setTemplates] = useState<SavedTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runUrls, setRunUrls] = useState<Record<number, string>>({});
  const [runningId, setRunningId] = useState<number | null>(null);
  const [results, setResults] = useState<{ res: ExtractResponse; url: string } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function copyId(id: number) {
    try {
      await navigator.clipboard.writeText(String(id));
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1400);
    } catch {
      // clipboard unavailable — silently no-op
    }
  }

  async function load() {
    try {
      setError(null);
      const list = await api.listTemplates();
      setTemplates(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(t: SavedTemplate) {
    const url = (runUrls[t.id] ?? t.source_url).trim();
    if (!url) return;
    setRunningId(t.id);
    try {
      const res = await api.extract(url, t.fields);
      setResults({ res, url });
    } catch (e) {
      alert("Run failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunningId(null);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this template?")) return;
    try {
      await api.deleteTemplate(id);
      void load();
    } catch (e) {
      alert("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  if (error) {
    return (
      <div className="rounded-lg border border-[color:var(--color-danger)]/30 bg-[var(--color-danger-soft)] p-4 text-[13px]">
        <div className="font-semibold text-[var(--color-fg-strong)]">Couldn&apos;t load templates</div>
        <div className="mt-1 font-mono text-[13px] text-[var(--color-fg)]">{error}</div>
        <div className="mt-2 text-[13px] text-[var(--color-fg-muted)]">
          Is the backend reachable?
        </div>
      </div>
    );
  }

  if (templates === null) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[var(--color-fg-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-12 text-center">
        <div className="text-[14px] font-medium text-[var(--color-fg)]">No templates yet</div>
        <p className="mt-1.5 text-[13px] text-[var(--color-fg-muted)]">
          Snapshot a URL, pick some fields, save the recipe.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {templates.map((t) => (
          <li
            key={t.id}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-[border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)]"
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold">{t.name}</h3>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
                  <span>
                    id: <span className="text-[var(--color-fg)]">{t.id}</span>
                  </span>
                  <IconButton
                    onClick={() => copyId(t.id)}
                    size="xs"
                    tone="quiet"
                    aria-label={`Copy template id ${t.id}`}
                    title="Copy id"
                  >
                    {copiedId === t.id ? (
                      <Check className="h-3 w-3 text-[var(--color-accent)]" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </IconButton>
                </div>
                <a
                  href={t.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 truncate font-mono text-[13px] text-[var(--color-fg-muted)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-[var(--color-accent)]"
                >
                  {t.source_url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <IconButton
                onClick={() => remove(t.id)}
                tone="danger"
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>

            <div className="mb-3 flex flex-wrap gap-1.5">
              {t.fields.map((f) => (
                <Badge key={f.label} tone="accent">
                  {f.label}
                  <span className="ml-1 text-emerald-500/80">· {f.kind}</span>
                </Badge>
              ))}
            </div>

            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                value={runUrls[t.id] ?? t.source_url}
                onChange={(e) =>
                  setRunUrls((prev) => ({ ...prev, [t.id]: e.target.value }))
                }
                placeholder="URL to run this template on"
              />
              <Button onClick={() => run(t)} disabled={runningId === t.id}>
                {runningId === t.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {results && (
        <ResultsPanel
          results={results.res}
          url={results.url}
          onClose={() => setResults(null)}
        />
      )}
    </>
  );
}
