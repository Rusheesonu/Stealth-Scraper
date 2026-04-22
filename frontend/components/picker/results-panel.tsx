"use client";

import { useMemo } from "react";
import { Copy, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ExtractResponse } from "@/lib/api";
import { downloadBlob, toCsv } from "@/lib/utils";

type Props = {
  results: ExtractResponse;
  url: string;
  onClose: () => void;
};

export function ResultsPanel({ results, url, onClose }: Props) {
  const jsonStr = useMemo(() => JSON.stringify(results.fields, null, 2), [results]);

  function copy() {
    navigator.clipboard.writeText(jsonStr).then(
      () => {},
      () => alert("Copy failed")
    );
  }

  function exportJson() {
    const slug = safeSlug(url);
    downloadBlob(jsonStr, `${slug}.json`, "application/json");
  }

  function exportCsv() {
    // If all fields are lists of equal length, emit one row per index.
    // Otherwise, one row with the scalar/joined values.
    const values = Object.entries(results.fields);
    const listKeys = values
      .filter(([, v]) => Array.isArray(v))
      .map(([k]) => k);
    const allLists = values.length > 0 && listKeys.length === values.length;
    let rows: Record<string, unknown>[] = [];
    if (allLists) {
      const maxLen = Math.max(...values.map(([, v]) => (Array.isArray(v) ? v.length : 0)));
      for (let i = 0; i < maxLen; i++) {
        const row: Record<string, unknown> = {};
        for (const [k, v] of values) {
          row[k] = Array.isArray(v) ? v[i] ?? "" : v;
        }
        rows.push(row);
      }
    } else {
      rows = [{ ...results.fields }];
    }
    const csv = toCsv(rows);
    downloadBlob(csv, `${safeSlug(url)}.csv`, "text/csv");
  }

  const errorCount = Object.keys(results.errors || {}).length;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col border-l border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Extraction result</h2>
            <p className="mt-0.5 truncate font-mono text-xs text-[var(--color-muted)]">
              {url}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={errorCount ? "danger" : "accent"}>
              {errorCount ? `${errorCount} errors` : "OK"}
            </Badge>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-black/40 hover:text-[var(--color-fg)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-5 py-3">
          <Button variant="secondary" size="sm" onClick={copy}>
            <Copy className="h-3.5 w-3.5" />
            Copy JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={exportJson}>
            <Download className="h-3.5 w-3.5" />
            JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {Object.keys(results.fields).length === 0 ? (
            <div className="rounded-md border border-red-900 bg-red-950/30 p-4 text-sm text-red-200">
              No data extracted. Check the console or error list below.
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(results.fields).map(([label, value]) => (
                <FieldRow key={label} label={label} value={value} error={results.errors?.[label]} />
              ))}
            </div>
          )}

          <details className="mt-6">
            <summary className="cursor-pointer text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]">
              Raw JSON
            </summary>
            <pre className="mt-2 max-h-[400px] overflow-auto rounded-md border border-[var(--color-border)] bg-black/60 p-3 font-mono text-xs text-emerald-200">
              {jsonStr}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, value, error }: { label: string; value: unknown; error?: string }) {
  const isList = Array.isArray(value);
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-black/30 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-xs font-semibold text-emerald-300">{label}</span>
        {isList && <Badge tone="muted">list · {(value as unknown[]).length}</Badge>}
        {error && <Badge tone="danger">error</Badge>}
      </div>
      {isList ? (
        <ul className="max-h-48 space-y-1 overflow-auto font-mono text-xs text-[var(--color-fg)]">
          {(value as unknown[]).map((v, i) => (
            <li key={i} className="truncate">
              <span className="text-[var(--color-muted)]">{i}.</span> {String(v)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="whitespace-pre-wrap break-words font-mono text-sm text-[var(--color-fg)]">
          {value == null ? (
            <span className="text-[var(--color-muted)]">null</span>
          ) : (
            String(value)
          )}
        </div>
      )}
      {error && <div className="mt-1 font-mono text-[10px] text-red-400">{error}</div>}
    </div>
  );
}

function safeSlug(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "scrape";
  } catch {
    return "scrape";
  }
}
