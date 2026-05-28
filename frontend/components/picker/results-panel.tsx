"use client";

import { useMemo, useState } from "react";
import { Copy, Download, X, Check, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import type { ExtractResponse } from "@/lib/api";
import { downloadBlob, toCsv } from "@/lib/utils";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

type Props = {
  results: ExtractResponse;
  url: string;
  onClose: () => void;
};

/**
 * Build records (per-row tabular view) from extracted fields.
 *
 * Returns one row per item in the list-kind fields; list lengths must
 * match (zip semantics). Returns null when the shape isn't zip-able —
 * caller falls back to fields view.
 *
 * **Scalar policy**: when there are ≥2 rows, scalar fields are NOT
 * broadcast into each row. Broadcasting a scalar across N list rows
 * implies "this value belongs to every row" which is dishonest when
 * the scalar is actually a too-specific list selector that only
 * matched one element (e.g. Target's price selector matching only the
 * first product card because later cards lazy-load). The broken-state
 * UX in records view: scalar columns silently become "$199.99 in
 * every row" and the user thinks the bug is back.
 *
 * Backend's `_null_broadcast_in_page_fields` now nulls list-kind
 * fields with 0–1 matches when siblings have N≥3, so this case mostly
 * gets caught earlier — but the frontend guard is the last line of
 * defense for stale templates, AI-drafted schemas with kind=text
 * mislabels, or transforms that collapsed a list to a scalar
 * unintentionally.
 *
 * Scalars are still returned alongside the rows so the panel can
 * surface them as page-level metadata above the table (with a hint
 * to re-pick or change kind).
 */
function zipRecords(fields: Record<string, unknown>): {
  rows: Record<string, unknown>[];
  ignoredScalars: { label: string; value: unknown }[];
} | null {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  const listEntries = entries.filter(([, v]) => Array.isArray(v));
  if (listEntries.length === 0) return null;
  const lengths = listEntries.map(([, v]) => (v as unknown[]).length);
  const first = lengths[0];
  if (first === 0) return null;
  if (!lengths.every((n) => n === first)) return null;

  const scalars = entries.filter(([, v]) => !Array.isArray(v));
  // Broadcast scalars only when there's exactly 1 row (no broadcast
  // possible). For ≥2 rows, scalars are surfaced separately above the
  // table — see "Scalar policy" in JSDoc.
  const broadcastOK = first < 2;

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < first; i++) {
    const row: Record<string, unknown> = {};
    if (broadcastOK) {
      for (const [k, v] of scalars) row[k] = v;
    }
    for (const [k, v] of listEntries) row[k] = (v as unknown[])[i] ?? null;
    rows.push(row);
  }

  const ignoredScalars = broadcastOK
    ? []
    : scalars.map(([label, value]) => ({ label, value }));
  return { rows, ignoredScalars };
}

/**
 * Results drawer — slides in from the right after an extraction. Two views:
 *   • Records: lists of equal length zipped into rows (the spreadsheet shape).
 *   • Fields:  per-field display, with list inflation visible.
 *
 * Light Apple system. Drawer chrome matches the surface palette;
 * code blocks use the Apple-clean mono treatment.
 *
 * Envelope unwrap (2026-05-22): /extract now returns FieldResult per
 * field — `{value, source, confidence, selector_used, reason_if_null}`
 * instead of a bare value. The display logic below was written for
 * bare values; without this normalization the UI rendered the entire
 * envelope object stringified as "[object Object]" everywhere. We
 * unwrap to bare values at the panel entry point and keep the
 * envelope around for future "show confidence" UX.
 */
type FieldEnvelope = {
  value: unknown;
  source?: string;
  confidence?: number;
  selector_used?: string | null;
  reason_if_null?: string | null;
};

function unwrapFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && "value" in (v as object)) {
      out[k] = (v as FieldEnvelope).value;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function ResultsPanel({ results, url, onClose }: Props) {
  const fieldsFlat = useMemo(
    () => unwrapFields(results.fields as Record<string, unknown>),
    [results.fields],
  );
  const zipped = useMemo(() => zipRecords(fieldsFlat), [fieldsFlat]);
  const records = zipped?.rows ?? null;
  const ignoredScalars = zipped?.ignoredScalars ?? [];
  const hasMultipleLists =
    records != null &&
    Object.values(fieldsFlat).filter((v) => Array.isArray(v)).length >= 2;

  const [view, setView] = useState<"records" | "fields">(() =>
    hasMultipleLists ? "records" : "fields"
  );
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  const jsonStr = useMemo(
    () => JSON.stringify(view === "records" && records ? records : fieldsFlat, null, 2),
    [fieldsFlat, view, records]
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(jsonStr);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      alert("Copy failed");
    }
  }

  function exportJson() {
    downloadBlob(jsonStr, `${safeSlug(url)}.json`, "application/json");
  }

  function exportCsv() {
    const rows = records ?? [flattenFields(fieldsFlat)];
    downloadBlob(toCsv(rows), `${safeSlug(url)}.csv`, "text/csv");
  }

  const errorCount = Object.keys(results.errors || {}).length;
  const fieldCount = Object.keys(fieldsFlat).length;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: APPLE_EASE }}
        className="fixed inset-0 z-40 flex justify-end"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-ink-9)_32%,transparent)]" />
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ duration: 0.28, ease: APPLE_EASE }}
          onClick={(e) => e.stopPropagation()}
          className="relative flex h-full w-full max-w-2xl flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)] shadow-[var(--shadow-modal)]"
        >
          {/* Header */}
          <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <Badge tone={errorCount ? "warning" : "success"} size="sm">
                  {errorCount ? (
                    <>
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {errorCount} error{errorCount === 1 ? "" : "s"}
                    </>
                  ) : (
                    <>
                      <Check className="h-2.5 w-2.5" />
                      OK
                    </>
                  )}
                </Badge>
                <Badge tone="muted" size="sm">
                  {fieldCount} field{fieldCount === 1 ? "" : "s"}
                </Badge>
              </div>
              <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
                Extraction result
              </h2>
              <p className="mt-0.5 truncate font-mono text-[13px] text-[var(--color-fg-muted)]">
                {url}
              </p>
            </div>
            <IconButton
              onClick={onClose}
              size="sm"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </IconButton>
          </header>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2.5">
            {records && (
              <div className="mr-1 inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-ink-1)] p-0.5">
                {(["records", "fields"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      "relative rounded px-2.5 py-1 text-[12px] font-medium",
                      "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                      view === v
                        ? "text-[var(--color-fg-strong)]"
                        : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                    )}
                  >
                    {view === v && (
                      <motion.span
                        layoutId="results-view-thumb"
                        className="absolute inset-0 -z-0 rounded bg-[var(--color-surface)] shadow-[var(--shadow-card)] ring-1 ring-[var(--color-border)]"
                        transition={{ type: "spring", stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className="relative z-10">
                      {v === "records" ? `Records (${records.length})` : "Fields"}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={copy}>
              {copyState === "copied" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copyState === "copied" ? "Copied" : "Copy JSON"}
            </Button>
            <Button variant="ghost" size="sm" onClick={exportJson}>
              <Download className="h-3 w-3" /> JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={exportCsv}>
              <Download className="h-3 w-3" /> CSV
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto bg-[var(--color-bg)] p-5">
            {fieldCount === 0 ? (
              <div className="rounded-lg border border-[color:var(--color-danger)]/30 bg-[var(--color-danger-soft)] p-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-danger)]" />
                  <div className="text-[13px] text-[var(--color-fg)]">
                    No data extracted. Check your selectors or review the error list.
                  </div>
                </div>
              </div>
            ) : view === "records" && records ? (
              <>
                {/* Sparse-but-legitimate page-level fields — e.g. only
                    1 product in a 30-product grid has a discount price,
                    or only 1 has a "Bestseller" badge. Previously rendered
                    as a big yellow warning card ("didn't generalize") which
                    alarmed users on legitimately sparse data. Now a
                    subtle muted note that PRESERVES the value without
                    pretending it's per-row. Truly broken selectors
                    (over-anchored to one card) still get caught by the
                    backend's broadcast nuller — which nulls them with
                    a reason_if_null, NOT a scalar, so they never reach
                    this rendering path. What lands here is genuine
                    page-level metadata the user picked. */}
                {ignoredScalars.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px]">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                      Page-level
                    </span>
                    {ignoredScalars.map(({ label, value }) => (
                      <span key={label} className="inline-flex items-baseline gap-1">
                        <span className="font-mono font-semibold text-[var(--color-accent)]">{label}</span>
                        <span className="text-[var(--color-fg-subdued)]">=</span>
                        <span className="truncate font-mono text-[var(--color-fg)] max-w-[280px]">
                          {value == null ? "null" : String(value)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
                <RecordsView rows={records} />
              </>
            ) : (
              <div className="space-y-2">
                {Object.entries(fieldsFlat).map(([label, value]) => (
                  <FieldRow key={label} label={label} value={value} error={results.errors?.[label]} />
                ))}
              </div>
            )}

            {/* Raw JSON */}
            <details className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              <summary className="cursor-pointer rounded-lg px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
                Raw JSON ({view})
              </summary>
              <pre className="m-2 mt-0 max-h-[420px] overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-ink-1)] p-3 font-mono text-[13px] leading-[1.65] text-[var(--color-fg)]">
                {jsonStr}
              </pre>
            </details>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
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
      <p className="text-[13px] text-[var(--color-fg-muted)]">
        Lists of equal length are zipped into one row per item.
      </p>
      <div className="overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-ink-1)]">
            <tr>
              <th className="px-2.5 py-2 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-subdued)]">
                #
              </th>
              {cols.map((c) => (
                <th
                  key={c}
                  className="px-2.5 py-2 text-left font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--color-accent)]"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className="border-t border-[var(--color-border)] hover:bg-[var(--color-ink-1)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
              >
                <td className="px-2.5 py-2 align-top font-mono text-[12px] text-[var(--color-fg-muted)]">
                  {i + 1}
                </td>
                {cols.map((c) => (
                  <td
                    key={c}
                    className="max-w-[320px] px-2.5 py-2 align-top font-mono text-[13px] leading-[1.55] text-[var(--color-fg)]"
                  >
                    <div className="line-clamp-3 break-words">
                      {r[c] == null ? (
                        <span className="text-[var(--color-fg-subdued)]">null</span>
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
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[13px] font-semibold text-[var(--color-accent)]">{label}</span>
        {isList && <Badge tone="muted" size="xs">list · {(value as unknown[]).length}</Badge>}
        {error && <Badge tone="danger" size="xs">error</Badge>}
      </div>
      {isList ? (
        <ul className="max-h-48 space-y-0.5 overflow-auto font-mono text-[13px] leading-[1.6] text-[var(--color-fg)]">
          {(value as unknown[]).map((v, i) => (
            <li key={i} className="truncate">
              <span className="text-[var(--color-fg-subdued)]">{i}.</span> {String(v)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="whitespace-pre-wrap break-words font-mono text-[13px] text-[var(--color-fg)]">
          {value == null ? (
            <span className="text-[var(--color-fg-subdued)]">null</span>
          ) : (
            String(value)
          )}
        </div>
      )}
      {error && <div className="mt-1.5 font-mono text-[13px] text-[var(--color-danger)]">{error}</div>}
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
