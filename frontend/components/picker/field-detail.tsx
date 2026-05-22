"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Plus, Trash2, Code, Eye, GripVertical, ChevronDown,
  RotateCcw, FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn, truncate } from "@/lib/utils";
import type { Transform, TransformOp, TemplateField, ExtractResponse } from "@/lib/api";
import type { PickedField } from "@/components/picker/picker-client";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

/**
 * Slide-in detail panel for a picked field. Three jobs:
 *   1. Show what currently matched — extracted value preview + match count.
 *   2. Edit the selector (CSS or XPath) directly — useful when the LLM
 *      auto-pick was close-but-wrong, or when the page changed.
 *   3. Configure a transform pipeline ("Python one-liner" feel) to clean
 *      the raw extracted value — strip prefix, regex, split, cast, etc.
 *
 * Light Apple system. Right-side drawer, ESC-to-close, body-scroll-lock.
 * Changes apply on Save; user can also "Test" to re-extract just this field.
 */

type Props = {
  field: PickedField;
  index: number;
  // Latest extraction results (if any) — used for value preview
  lastResults: ExtractResponse | null;
  onClose: () => void;
  onChange: (next: Partial<PickedField>) => void;
  onTestSingle?: (field: PickedField) => Promise<unknown> | void;
};

export function FieldDetailDrawer({
  field,
  index,
  lastResults,
  onClose,
  onChange,
  onTestSingle,
}: Props) {
  const [draft, setDraft] = useState<PickedField>(field);
  const [testing, setTesting] = useState(false);
  const [testValue, setTestValue] = useState<unknown>(undefined);

  // Sync draft when the parent field changes (e.g. after a Test re-extract)
  useEffect(() => { setDraft(field); }, [field]);

  // Lock body scroll while open; close on ESC
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Unwrap FieldResult envelope — /extract now returns
  // {value, source, confidence, ...} per field. Display logic below
  // expects a bare value, so we pluck `.value` when the field result
  // is the new envelope shape.
  const rawPreview =
    testValue !== undefined ? testValue : lastResults?.fields?.[field.label];
  const previewValue =
    rawPreview && typeof rawPreview === "object" && !Array.isArray(rawPreview) && "value" in rawPreview
      ? (rawPreview as { value: unknown }).value
      : rawPreview;

  const dirty =
    draft.selector !== field.selector ||
    draft.xpath !== field.xpath ||
    draft.kind !== field.kind ||
    draft.attr !== field.attr ||
    JSON.stringify(draft.transforms ?? []) !== JSON.stringify(field.transforms ?? []);

  function commit() {
    onChange({
      selector: draft.selector,
      xpath: draft.xpath,
      kind: draft.kind,
      attr: draft.attr,
      transforms: draft.transforms,
    });
    onClose();
  }

  async function runTest() {
    if (!onTestSingle) return;
    setTesting(true);
    try {
      const val = await onTestSingle(draft);
      setTestValue(val);
    } finally {
      setTesting(false);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: APPLE_EASE }}
        className="fixed inset-0 z-50 flex justify-end"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-[color-mix(in_srgb,var(--color-ink-9)_32%,transparent)]" />
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ duration: 0.28, ease: APPLE_EASE }}
          onClick={(e) => e.stopPropagation()}
          className="relative flex h-full w-full max-w-md flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)] shadow-[var(--shadow-modal)]"
        >
          {/* Header */}
          <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                Field #{index + 1}
              </div>
              <h2 className="truncate text-[20px] font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
                {field.label}
              </h2>
            </div>
            <IconButton
              onClick={onClose}
              size="sm"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </IconButton>
          </header>

          <div className="flex-1 overflow-y-auto">
            {/* Matched value preview */}
            <Section icon={<Eye className="h-3 w-3" />} title="What matched">
              <ValuePreview
                value={previewValue}
                empty={previewValue === undefined ? "Not extracted yet — run extract or hit Test below to preview." : null}
              />
              {onTestSingle && (
                <div className="mt-2 flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={runTest} disabled={testing}>
                    {testing ? (
                      <RotateCcw className="h-3 w-3 animate-spin" />
                    ) : (
                      <FlaskConical className="h-3 w-3" />
                    )}
                    Test this field only
                  </Button>
                  {testValue !== undefined && (
                    <button
                      onClick={() => setTestValue(undefined)}
                      className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                    >
                      clear test
                    </button>
                  )}
                </div>
              )}
            </Section>

            {/* Selector editor */}
            <Section icon={<Code className="h-3 w-3" />} title="Selector">
              <div className="space-y-2.5">
                <div>
                  <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                    CSS selector
                  </label>
                  <Input
                    mono
                    size="sm"
                    value={draft.selector}
                    onChange={(e) => setDraft({ ...draft, selector: e.target.value })}
                    placeholder="e.g. .product-card .price"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                    XPath fallback <span className="text-[var(--color-fg-subdued)]">(optional)</span>
                  </label>
                  <Input
                    mono
                    size="sm"
                    value={draft.xpath || ""}
                    onChange={(e) => setDraft({ ...draft, xpath: e.target.value })}
                    placeholder="//div[@class='price']"
                  />
                  <p className="mt-1 text-[11px] text-[var(--color-fg-subdued)]">
                    Used only if CSS selector returns nothing.
                  </p>
                </div>
              </div>
            </Section>

            {/* Kind */}
            <Section icon={<ChevronDown className="h-3 w-3" />} title="Extract as">
              <div className="grid grid-cols-4 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-ink-1)] p-1">
                {(["text", "list", "attr", "html"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setDraft({ ...draft, kind: k })}
                    className={cn(
                      "relative inline-flex items-center justify-center rounded-md px-2 py-1.5 text-[13px] font-medium",
                      "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                      draft.kind === k
                        ? "bg-[var(--color-surface)] text-[var(--color-fg-strong)] shadow-[var(--shadow-card)] ring-1 ring-[var(--color-border)]"
                        : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                    )}
                  >
                    {k}
                  </button>
                ))}
              </div>
              {draft.kind === "attr" && (
                <div className="mt-2">
                  <label className="mb-1 block font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                    Attribute name
                  </label>
                  <Input
                    mono
                    size="sm"
                    value={draft.attr || ""}
                    onChange={(e) => setDraft({ ...draft, attr: e.target.value })}
                    placeholder="href"
                  />
                </div>
              )}
            </Section>

            {/* Transforms pipeline */}
            <Section
              icon={<GripVertical className="h-3 w-3" />}
              title="Cleanup pipeline"
              hint="Applied in order. Like a Python one-liner, but safe."
            >
              <TransformsEditor
                transforms={draft.transforms ?? []}
                onChange={(transforms) => setDraft({ ...draft, transforms })}
              />
            </Section>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-3">
            <div className="font-mono text-[11px] text-[var(--color-fg-muted)]">
              {dirty ? "unsaved changes" : "saved"}
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={commit} disabled={!dirty}>
                Apply changes
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Section({
  icon, title, hint, children,
}: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--color-border)] px-5 py-4 last:border-b-0">
      <div className="mb-2.5 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
        {icon}
        {title}
      </div>
      {hint && (
        <p className="mb-2.5 text-[11px] leading-[1.5] text-[var(--color-fg-muted)]">{hint}</p>
      )}
      {children}
    </section>
  );
}

/**
 * Compact value-preview card. Handles scalars, arrays, nulls.
 * Truncates long values, lets user expand.
 */
function ValuePreview({ value, empty }: { value: unknown; empty: string | null }) {
  const [expanded, setExpanded] = useState(false);

  if (empty) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-[11px] text-[var(--color-fg-muted)]">
        {empty}
      </div>
    );
  }

  if (value === null || value === undefined) {
    return (
      <div className="rounded-lg border border-[color:var(--color-warning)]/30 bg-[var(--color-warning-soft)] px-3 py-2.5">
        <div className="font-mono text-[13px] text-[var(--color-fg)]">
          <span className="text-[var(--color-fg-subdued)]">null</span>
        </div>
        <p className="mt-1 text-[11px] text-[var(--color-fg-muted)]">
          Selector didn&apos;t match anything. Try editing it above.
        </p>
      </div>
    );
  }

  if (Array.isArray(value)) {
    const shown = expanded ? value : value.slice(0, 4);
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="mb-1.5 flex items-center justify-between">
          <Badge tone="muted" size="xs">list · {value.length}</Badge>
          {value.length > 4 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            >
              {expanded ? "show less" : `show all ${value.length}`}
            </button>
          )}
        </div>
        <ul className="space-y-0.5">
          {shown.map((v, i) => (
            <li key={i} className="truncate font-mono text-[11px] text-[var(--color-fg)]">
              <span className="text-[var(--color-fg-subdued)]">{i}.</span> {String(v)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const str = String(value);
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <div className="whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.55] text-[var(--color-fg)]">
        {expanded || str.length <= 200 ? str : truncate(str, 200)}
      </div>
      {str.length > 200 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
        >
          {expanded ? "show less" : "show full"}
        </button>
      )}
    </div>
  );
}

/**
 * Transforms editor. List of ops with op-specific param inputs.
 * User can add/remove/reorder steps. No drag-reorder yet — buttons.
 */
function TransformsEditor({
  transforms,
  onChange,
}: {
  transforms: Transform[];
  onChange: (next: Transform[]) => void;
}) {
  function add(op: TransformOp) {
    onChange([...transforms, { op }]);
  }
  function update(i: number, patch: Partial<Transform>) {
    const next = [...transforms];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function remove(i: number) {
    onChange(transforms.filter((_, idx) => idx !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= transforms.length) return;
    const next = [...transforms];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {transforms.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-3 text-center">
          <p className="text-[11px] text-[var(--color-fg-muted)]">
            No cleanup steps. Raw extracted value goes through unchanged.
          </p>
        </div>
      ) : (
        <ol className="space-y-1.5">
          {transforms.map((t, i) => (
            <li key={i}>
              <TransformRow
                index={i}
                transform={t}
                onChange={(patch) => update(i, patch)}
                onRemove={() => remove(i)}
                onMoveUp={i > 0 ? () => move(i, -1) : undefined}
                onMoveDown={i < transforms.length - 1 ? () => move(i, 1) : undefined}
              />
            </li>
          ))}
        </ol>
      )}

      <AddOpButton onAdd={add} />
    </div>
  );
}

const OP_LABELS: Record<TransformOp, { label: string; sub: string }> = {
  strip: { label: "strip", sub: "Remove leading/trailing whitespace" },
  lower: { label: "lower", sub: "Lowercase" },
  upper: { label: "upper", sub: "Uppercase" },
  strip_prefix: { label: "strip_prefix", sub: "Remove text if value starts with it" },
  strip_suffix: { label: "strip_suffix", sub: "Remove text if value ends with it" },
  regex_replace: { label: "regex_replace", sub: "Find regex, replace with text" },
  regex_extract: { label: "regex_extract", sub: "Pull first regex match (group 1 if grouped)" },
  split: { label: "split", sub: "Split by separator into a list" },
  slice: { label: "slice", sub: "Substring or sub-list by start/end index" },
  to_int: { label: "to_int", sub: "Parse integer (strips $, commas, etc)" },
  to_float: { label: "to_float", sub: "Parse decimal number" },
  collapse_whitespace: { label: "collapse_whitespace", sub: "Multiple spaces → one" },
};

function TransformRow({
  index, transform, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  index: number;
  transform: Transform;
  onChange: (patch: Partial<Transform>) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const meta = OP_LABELS[transform.op];
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">{index + 1}.</span>
        <span className="font-mono text-[13px] font-semibold text-[var(--color-fg-strong)]">
          {meta?.label || transform.op}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {onMoveUp && (
            <button
              onClick={onMoveUp}
              className="rounded p-0.5 text-[var(--color-fg-subdued)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]"
              aria-label="Move up"
              title="Move up"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 2 L9 7 L1 7 Z" /></svg>
            </button>
          )}
          {onMoveDown && (
            <button
              onClick={onMoveDown}
              className="rounded p-0.5 text-[var(--color-fg-subdued)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]"
              aria-label="Move down"
              title="Move down"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M5 8 L1 3 L9 3 Z" /></svg>
            </button>
          )}
          <button
            onClick={onRemove}
            className="rounded p-0.5 text-[var(--color-fg-subdued)] hover:bg-[color:var(--color-danger)]/10 hover:text-[var(--color-danger)]"
            aria-label="Remove step"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <OpParams transform={transform} onChange={onChange} />
    </div>
  );
}

/** Per-op parameter inputs. Renders the right form for each op kind. */
function OpParams({
  transform, onChange,
}: { transform: Transform; onChange: (patch: Partial<Transform>) => void }) {
  switch (transform.op) {
    case "strip":
    case "lower":
    case "upper":
    case "collapse_whitespace":
      return (
        <p className="text-[11px] text-[var(--color-fg-muted)]">No parameters.</p>
      );
    case "strip_prefix":
      return (
        <Input mono size="sm" placeholder='e.g. "Tags: "' value={transform.value || ""}
          onChange={(e) => onChange({ value: e.target.value })} />
      );
    case "strip_suffix":
      return (
        <Input mono size="sm" placeholder='e.g. " USD"' value={transform.value || ""}
          onChange={(e) => onChange({ value: e.target.value })} />
      );
    case "regex_replace":
      return (
        <div className="grid grid-cols-2 gap-1.5">
          <Input mono size="sm" placeholder="pattern" value={transform.pattern || ""}
            onChange={(e) => onChange({ pattern: e.target.value })} />
          <Input mono size="sm" placeholder="replacement" value={transform.repl || ""}
            onChange={(e) => onChange({ repl: e.target.value })} />
        </div>
      );
    case "regex_extract":
      return (
        <Input mono size="sm" placeholder="pattern with optional (group)"
          value={transform.pattern || ""}
          onChange={(e) => onChange({ pattern: e.target.value })} />
      );
    case "split":
      return (
        <Input mono size="sm" placeholder='separator (default " ")'
          value={transform.sep || ""}
          onChange={(e) => onChange({ sep: e.target.value })} />
      );
    case "slice":
      return (
        <div className="grid grid-cols-2 gap-1.5">
          <Input mono size="sm" placeholder="start (number)"
            value={transform.start ?? ""}
            onChange={(e) => onChange({ start: e.target.value === "" ? undefined : Number(e.target.value) })} />
          <Input mono size="sm" placeholder="end (number)"
            value={transform.end ?? ""}
            onChange={(e) => onChange({ end: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </div>
      );
    case "to_int":
    case "to_float":
      return (
        <p className="text-[11px] text-[var(--color-fg-muted)]">
          Auto-strips $, commas, currency symbols.
        </p>
      );
  }
}

function AddOpButton({ onAdd }: { onAdd: (op: TransformOp) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 text-[13px] font-medium text-[var(--color-fg-muted)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-ink-1)] hover:text-[var(--color-fg)]"
      >
        <Plus className="h-3 w-3" />
        Add cleanup step
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 4 }}
              transition={{ duration: 0.16, ease: APPLE_EASE }}
              className="absolute bottom-full left-0 right-0 z-20 mb-1.5 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-[var(--shadow-popover)]"
            >
              <div className="max-h-80 overflow-y-auto p-1">
                {(Object.entries(OP_LABELS) as [TransformOp, { label: string; sub: string }][]).map(([op, meta]) => (
                  <button
                    key={op}
                    onClick={() => { onAdd(op); setOpen(false); }}
                    className="block w-full rounded-md px-2.5 py-1.5 text-left transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-ink-2)]"
                  >
                    <div className="font-mono text-[11px] font-semibold text-[var(--color-fg-strong)]">
                      {meta.label}
                    </div>
                    <div className="text-[11px] text-[var(--color-fg-muted)]">{meta.sub}</div>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
