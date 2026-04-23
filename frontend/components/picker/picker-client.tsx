"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Download, Layers, Loader2, Play, RotateCcw, X } from "lucide-react";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LabelModal } from "@/components/picker/label-modal";
import { SnapshotCanvas } from "@/components/picker/snapshot-canvas";
import { FieldSidebar } from "@/components/picker/field-sidebar";
import { ResultsPanel } from "@/components/picker/results-panel";
import { BatchModal } from "@/components/picker/batch-modal";
import { downloadBlob, toCsv } from "@/lib/utils";
import {
  api,
  type DetectedElement,
  type ExtractResponse,
  type SnapshotResponse,
  type TemplateField,
} from "@/lib/api";
import { findSiblings, normalizeListSelector } from "@/lib/utils";

export type PickedField = TemplateField & {
  element_id: number;
  // Primary bbox — the element the user actually clicked. For list fields
  // we also carry every sibling's bbox so the overlay can show them all.
  bbox: { x: number; y: number; w: number; h: number };
  list_bboxes?: { x: number; y: number; w: number; h: number }[];
};

const COLORS = [
  "#10b981", // emerald
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#ec4899", // pink
  "#a855f7", // purple
  "#ef4444", // red
  "#14b8a6", // teal
  "#f97316", // orange
];

export function PickerClient() {
  const router = useRouter();
  const search = useSearchParams();
  const url = search.get("url") ?? "";

  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<PickedField[]>([]);
  const [pending, setPending] = useState<DetectedElement | null>(null);
  const [results, setResults] = useState<ExtractResponse | null>(null);
  const [batchResults, setBatchResults] = useState<{ url: string; data: ExtractResponse }[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [targetUrl, setTargetUrl] = useState<string>("");
  const [batchOpen, setBatchOpen] = useState(false);
  const once = useRef(false);

  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.snapshot(url);
      setSnapshot(res);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    void load();
  }, [load]);

  // Seed the extract-target input once the URL is known. User can edit
  // it without the snapshot reloading — this is what enables "pick on
  // one Amazon product page, extract from a different one" without
  // having to save-then-leave.
  useEffect(() => {
    if (url && !targetUrl) setTargetUrl(url);
  }, [url, targetUrl]);

  const colorForIndex = useCallback((i: number) => COLORS[i % COLORS.length], []);

  const onElementClick = useCallback((el: DetectedElement) => {
    setPending(el);
  }, []);

  function confirmField(partial: { label: string; kind: TemplateField["kind"]; attr?: string }) {
    if (!pending) return;
    // For list fields, swap in the normalized selector (drops nth-of-type
    // anchors so querySelectorAll matches every sibling). Scalar fields
    // keep the specific selector so they resolve to exactly one element.
    const isList = partial.kind === "list";
    const selector = isList ? normalizeListSelector(pending.css) : pending.css;
    const siblings = isList && snapshot
      ? findSiblings(pending, snapshot.elements)
      : [pending];

    const field: PickedField = {
      label: partial.label,
      selector,
      xpath: pending.xpath,
      kind: partial.kind,
      attr: partial.attr ?? "",
      element_id: pending.id,
      bbox: pending.bbox,
      list_bboxes: isList ? siblings.map((s) => s.bbox) : undefined,
    };
    setFields((prev) => [...prev, field]);
    setPending(null);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function templatePayload() {
    return fields.map(({ label, selector, xpath, kind, attr }) => ({
      label,
      selector,
      xpath,
      kind,
      attr,
    }));
  }

  async function runExtract() {
    if (!fields.length) return;
    const runOn = (targetUrl || url).trim();
    if (!runOn) return;
    setExtracting(true);
    setResults(null);
    setBatchResults(null);
    try {
      const res = await api.extract(runOn, templatePayload());
      setResults(res);
    } catch (e) {
      setResults({
        url: runOn,
        fields: {},
        errors: { _error: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      setExtracting(false);
    }
  }

  async function runBatch(urls: string[]) {
    if (!fields.length || !urls.length) return;
    setExtracting(true);
    setResults(null);
    setBatchResults([]);
    // For short lists (≤3) we loop client-side so users see each row
    // land. For bigger jobs we call the backend's /extract/batch
    // endpoint — one round-trip instead of N, and the backend can
    // reuse the same tab lifecycle tightly.
    if (urls.length <= 3) {
      const out: { url: string; data: ExtractResponse }[] = [];
      for (const u of urls) {
        try {
          const res = await api.extract(u, templatePayload());
          out.push({ url: u, data: res });
        } catch (e) {
          out.push({
            url: u,
            data: {
              url: u,
              fields: {},
              errors: { _error: e instanceof Error ? e.message : String(e) },
            },
          });
        }
        setBatchResults([...out]);
      }
    } else {
      try {
        const res = await api.extractBatch(urls, templatePayload());
        setBatchResults(res.results);
      } catch (e) {
        setBatchResults([
          {
            url: urls[0],
            data: {
              url: urls[0],
              fields: {},
              errors: { _error: e instanceof Error ? e.message : String(e) },
            },
          },
        ]);
      }
    }
    setExtracting(false);
  }

  async function saveTemplate(name: string) {
    if (!fields.length) return;
    setSaving(true);
    try {
      const res = await api.createTemplate({
        name,
        source_url: url,
        fields: fields.map(({ label, selector, xpath, kind, attr }) => ({
          label,
          selector,
          xpath,
          kind,
          attr,
        })),
      });
      setSavedId(res.id);
    } catch (e) {
      alert("Save failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }

  const overlayFields = useMemo(
    () =>
      fields.flatMap((f, i) => {
        const color = colorForIndex(i);
        // List fields paint every sibling with a lighter variant so the
        // user can see at a glance how many items the selector catches.
        if (f.list_bboxes && f.list_bboxes.length > 1) {
          return f.list_bboxes.map((b, idx) => ({
            bbox: b,
            label: idx === 0 ? `${f.label} (${f.list_bboxes!.length})` : "",
            color,
            faded: idx > 0,
          }));
        }
        return [{ bbox: f.bbox, label: f.label, color, faded: false }];
      }),
    [fields, colorForIndex]
  );

  if (!url) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--color-muted)]">
        No URL provided.{" "}
        <Link href="/" className="ml-2 text-[var(--color-accent)]">
          Go back
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-panel)]/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Brand />
          {snapshot ? (
            <Badge tone="accent">{snapshot.element_count} elements</Badge>
          ) : null}
        </div>

        {/* Extract-target controls — lives between the brand and actions. */}
        <div className="flex flex-1 items-center gap-2 md:max-w-2xl">
          <div className="hidden text-xs text-[var(--color-muted)] md:block whitespace-nowrap">
            Extract from:
          </div>
          <div className="relative flex-1">
            <Input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={url}
              className="h-9 pr-8 font-mono text-xs"
              spellCheck={false}
            />
            {targetUrl && targetUrl !== url && (
              <button
                onClick={() => setTargetUrl(url)}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-muted)] hover:bg-black/40 hover:text-[var(--color-fg)]"
                title="Reset to snapshot URL"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => setBatchOpen(true)}
            disabled={!fields.length || extracting}
            size="sm"
            variant="secondary"
          >
            <Layers className="h-4 w-4" />
            Batch
          </Button>
          <Button
            onClick={runExtract}
            disabled={!fields.length || extracting || !targetUrl.trim()}
            size="sm"
          >
            {extracting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run extract
          </Button>
        </div>
      </header>

      {/* Warning strip when running on a different URL than the snapshot */}
      {targetUrl && targetUrl !== url && (
        <div className="flex items-center justify-center gap-2 border-b border-amber-900/60 bg-amber-950/40 px-4 py-1.5 text-xs text-amber-200">
          <span className="font-mono">⚠ Extracting from a different URL than the one you picked on.</span>
          <span className="text-amber-300/70">Selectors should still match if the page structure is the same.</span>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-auto p-6">
          {loading && (
            <div className="flex h-full items-center justify-center text-[var(--color-muted)]">
              <Loader2 className="mr-3 h-5 w-5 animate-spin" />
              Loading snapshot… (first load can take 10–20s)
            </div>
          )}
          {loadError && (
            <div className="mx-auto max-w-lg rounded-lg border border-red-900 bg-red-950/40 p-6 text-red-200">
              <div className="mb-2 font-semibold">Snapshot failed</div>
              <div className="mb-4 font-mono text-xs">{loadError}</div>
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            </div>
          )}
          {snapshot && (
            <SnapshotCanvas
              snapshot={snapshot}
              onElementClick={onElementClick}
              pickedFields={overlayFields}
            />
          )}
        </main>

        <FieldSidebar
          fields={fields}
          onRemove={removeField}
          onSave={saveTemplate}
          saving={saving}
          savedId={savedId}
          colorForIndex={colorForIndex}
        />
      </div>

      {pending && (
        <LabelModal
          element={pending}
          siblings={snapshot ? findSiblings(pending, snapshot.elements) : [pending]}
          onCancel={() => setPending(null)}
          onConfirm={confirmField}
          existingLabels={fields.map((f) => f.label)}
        />
      )}

      {results && (
        <ResultsPanel
          results={results}
          onClose={() => setResults(null)}
          url={targetUrl || url}
        />
      )}

      {batchOpen && (
        <BatchModal
          defaultUrl={url}
          onCancel={() => setBatchOpen(false)}
          onRun={async (urls) => {
            setBatchOpen(false);
            await runBatch(urls);
          }}
        />
      )}

      {batchResults && (
        <BatchResultsPanel
          results={batchResults}
          running={extracting}
          onClose={() => setBatchResults(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Batch results drawer — kept inline so we don't spin up a separate file
// for this small surface. Mirrors ResultsPanel's styling.
// ─────────────────────────────────────────────────────────────────────────

function BatchResultsPanel({
  results,
  running,
  onClose,
}: {
  results: { url: string; data: ExtractResponse }[];
  running: boolean;
  onClose: () => void;
}) {
  const rows = useMemo(() => {
    // One row per URL. If any field is a list, collapse to "v1 | v2 | …"
    // so a single CSV line captures the data without an extra pivot.
    return results.map(({ url, data }) => {
      const row: Record<string, unknown> = { url };
      for (const [k, v] of Object.entries(data.fields)) {
        row[k] = Array.isArray(v) ? v.join(" | ") : v;
      }
      return row;
    });
  }, [results]);

  const jsonStr = useMemo(
    () =>
      JSON.stringify(
        results.map(({ url, data }) => ({ url, ...data.fields })),
        null,
        2
      ),
    [results]
  );

  function exportCsv() {
    const csv = toCsv(rows);
    downloadBlob(csv, "batch-extract.csv", "text/csv");
  }

  function exportJson() {
    downloadBlob(jsonStr, "batch-extract.json", "application/json");
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-3xl flex-col border-l border-[var(--color-border)] bg-[var(--color-panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">
              Batch extract · {results.length} URL{results.length === 1 ? "" : "s"}
              {running && (
                <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-[var(--color-muted)]" />
              )}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              {running ? "Running… results land as each page finishes." : "Complete."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={exportJson}>
              <Download className="h-3.5 w-3.5" />
              JSON
            </Button>
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-[var(--color-muted)] hover:bg-black/40 hover:text-[var(--color-fg)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-5">
          {results.length === 0 ? (
            <div className="text-sm text-[var(--color-muted)]">
              Waiting for the first result…
            </div>
          ) : (
            <div className="space-y-3">
              {results.map(({ url, data }, i) => {
                const errCount = Object.keys(data.errors || {}).length;
                return (
                  <div
                    key={i}
                    className="rounded-md border border-[var(--color-border)] bg-black/30 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="truncate font-mono text-xs text-[var(--color-muted)]">
                        {url}
                      </div>
                      <Badge tone={errCount ? "danger" : "accent"}>
                        {errCount ? `${errCount} errors` : "ok"}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {Object.entries(data.fields).map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-sm">
                          <span className="shrink-0 font-mono text-xs font-semibold text-emerald-300">
                            {k}
                          </span>
                          <span className="truncate font-mono text-xs text-[var(--color-fg)]">
                            {Array.isArray(v)
                              ? `[${(v as unknown[]).length}] ${(v as unknown[]).slice(0, 3).map(String).join(" · ")}${
                                  (v as unknown[]).length > 3 ? " …" : ""
                                }`
                              : v == null
                              ? "null"
                              : String(v)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
