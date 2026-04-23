"use client";

import { useMemo, useState } from "react";
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

/**
 * If every list-typed field returned exactly the same number of items,
 * we can safely zip them into records (row 1: title[0], price[0], …).
 * Scalar fields are repeated on every row. Returns null when the shape
 * doesn't line up — the caller should fall back to the per-field view.
 */
function zipRecords(fields: Record<string, unknown>): Record<string, unknown>[] | null {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  const listEntries = entries.filter(([, v]) => Array.isArray(v));
  if (listEntries.length === 0) return null;
  const lengths = listEntries.map(([, v]) => (v as unknown[]).length);
  const first = lengths[0];
  if (first === 0) return null;
  if (!lengths.every((n) => n === first)) return null;
  const scalars = entries.filter(([, v]) => !Array.isArray(v));
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < first; i++) {
    const row: Record<string, unknown> = {};
    for (const [k, v] of scalars) row[k] = v;
    for (const [k, v] of listEntries) row[k] = (v as unknown[])[i] ?? null;
    rows.push(row);
  }
  return rows;
}

export function ResultsPanel({ results, url, onClose }: Props) {
  const records = useMemo(() => zipRecords(results.fields), [results]);
  const hasMultipleLists =
    records != null &&
    Object.values(results.fields).filter((v) => Array.isArray(v)).length >= 2;

  const [view, setView] = useState<"fields" | "records">(() =>
    hasMultipleLists ? "records" : "fields"
  );

  const jsonStr = useMemo(
    () => JSON.stringify(view === "records" && records ? records : results.fields, null, 2),
    [results, view, records]
  );

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
    // Prefer zipped records when available — that's the user's actual
    // spreadsheet shape. Otherwise fall back to a single flat row.
    const rows = records ?? [flattenFields(results.fields)];
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
          {records && (
            <div className="mr-2 flex rounded-md border border-[var(--color-border)] bg-black/40 p-0.5 text-xs">
              <button
                onClick={() => setView("records")}
                className={`rounded px-2.5 py-1 transition ${
                  view === "records"
                    ? "bg-emerald-900/60 text-emerald-100"
                    : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                }`}
              >
                Records ({records.length})
              </button>
              <button
                onClick={() => setView("fields")}
                className={`rounded px-2.5 py-1 transition ${
                  view === "fields"
                    ? "bg-emerald-900/60 text-emerald-100"
                    : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                }`}
              >
                Fields
              </button>
            </div>
          )}
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
          ) : view === "records" && records ? (
            <RecordsView rows={records} />
          ) : (
            <div className="space-y-3">
              {Object.entries(results.fields).map(([label, value]) => (
                <FieldRow key={label} label={label} value={value} error={results.errors?.[label]} />
              ))}
            </div>
          )}

          <details className="mt-6">
            <summary className="cursor-pointer text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]">
              Raw JSON ({view === "records" ? "records" : "fields"})
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

function RecordsView({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) Object.keys(r).forEach((k) => s.add(k));
    return Array.from(s);
  }, [rows]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
        <Badge tone="accent">{rows.length} records</Badge>
        <span>Lists of equal length are zipped into one row per item.</span>
      </div>
      <div className="overflow-auto rounded-md border border-[var(--color-border)] bg-black/30">
        <table className="w-full text-xs">
          <thead className="bg-black/50">
            <tr>
              <th className="px-2 py-1.5 text-left font-mono text-[10px] font-semibold text-[var(--color-muted)]">
                #
              </th>
              {cols.map((c) => (
                <th
                  key={c}
                  className="px-2 py-1.5 text-left font-mono text-[10px] font-semibold text-emerald-300"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-[var(--color-border)]/60">
                <td className="px-2 py-1.5 align-top font-mono text-[10px] text-[var(--color-muted)]">
                  {i + 1}
                </td>
                {cols.map((c) => (
                  <td
                    key={c}
                    className="max-w-[320px] px-2 py-1.5 align-top font-mono text-xs text-[var(--color-fg)]"
                  >
                    <div className="line-clamp-3 break-words">
                      {r[c] == null ? (
                        <span className="text-[var(--color-muted)]">null</span>
                      ) : (
                        String(r[c])
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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

function flattenFields(fields: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    row[k] = Array.isArray(v) ? v.join(" | ") : v;
  }
  return row;
}

function safeSlug(url: string): string {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "scrape";
  } catch {
    return "scrape";
  }
}
