"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Play, Save, Trash2 } from "lucide-react";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LabelModal } from "@/components/picker/label-modal";
import { SnapshotCanvas } from "@/components/picker/snapshot-canvas";
import { FieldSidebar } from "@/components/picker/field-sidebar";
import { ResultsPanel } from "@/components/picker/results-panel";
import {
  api,
  type DetectedElement,
  type ExtractResponse,
  type SnapshotResponse,
  type TemplateField,
} from "@/lib/api";

export type PickedField = TemplateField & {
  element_id: number;
  bbox: { x: number; y: number; w: number; h: number };
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
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
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

  const colorForIndex = useCallback((i: number) => COLORS[i % COLORS.length], []);

  const onElementClick = useCallback((el: DetectedElement) => {
    setPending(el);
  }, []);

  function confirmField(partial: { label: string; kind: TemplateField["kind"]; attr?: string }) {
    if (!pending) return;
    const field: PickedField = {
      label: partial.label,
      selector: pending.css,
      xpath: pending.xpath,
      kind: partial.kind,
      attr: partial.attr ?? "",
      element_id: pending.id,
      bbox: pending.bbox,
    };
    setFields((prev) => [...prev, field]);
    setPending(null);
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  async function runExtract() {
    if (!fields.length) return;
    setExtracting(true);
    setResults(null);
    try {
      const res = await api.extract(
        url,
        fields.map(({ label, selector, xpath, kind, attr }) => ({
          label,
          selector,
          xpath,
          kind,
          attr,
        }))
      );
      setResults(res);
    } catch (e) {
      setResults({
        url,
        fields: {},
        errors: { _error: e instanceof Error ? e.message : String(e) },
      });
    } finally {
      setExtracting(false);
    }
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
      fields.map((f, i) => ({
        bbox: f.bbox,
        label: f.label,
        color: colorForIndex(i),
      })),
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
      <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-panel)]/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Brand />
          <Badge tone="muted" className="max-w-[420px] truncate">
            {url}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {snapshot ? (
            <Badge tone="accent">{snapshot.element_count} elements</Badge>
          ) : null}
          <Button
            onClick={runExtract}
            disabled={!fields.length || extracting}
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
          onCancel={() => setPending(null)}
          onConfirm={confirmField}
          existingLabels={fields.map((f) => f.label)}
        />
      )}

      {results && (
        <ResultsPanel
          results={results}
          onClose={() => setResults(null)}
          url={url}
        />
      )}
    </div>
  );
}
