"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DetectedElement, TemplateField } from "@/lib/api";
import { truncate } from "@/lib/utils";

type Props = {
  element: DetectedElement;
  existingLabels: string[];
  onCancel: () => void;
  onConfirm: (v: { label: string; kind: TemplateField["kind"]; attr?: string }) => void;
};

const COMMON_ATTRS = ["href", "src", "alt", "title", "value"];

export function LabelModal({ element, existingLabels, onCancel, onConfirm }: Props) {
  const [label, setLabel] = useState(() => suggestLabel(element, existingLabels));
  const [kind, setKind] = useState<TemplateField["kind"]>("text");
  const [attr, setAttr] = useState<string>(() => (element.attrs.href ? "href" : element.attrs.src ? "src" : ""));

  const availableAttrs = useMemo(() => {
    const keys = Object.keys(element.attrs || {});
    const combined = Array.from(new Set([...keys, ...COMMON_ATTRS]));
    return combined.filter(Boolean);
  }, [element.attrs]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && label.trim()) {
        submit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, kind, attr]);

  function submit() {
    const duplicate = existingLabels.includes(label.trim());
    if (duplicate) {
      alert("You already have a field with that name");
      return;
    }
    onConfirm({
      label: label.trim(),
      kind,
      attr: kind === "attr" ? attr : undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Label this field</h2>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Give it a name you&apos;ll recognize in the output JSON.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md p-1 text-[var(--color-muted)] hover:bg-black/40 hover:text-[var(--color-fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-md border border-[var(--color-border)] bg-black/40 p-3">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone="accent">&lt;{element.tag}&gt;</Badge>
            {element.attrs.href && <Badge tone="muted">link</Badge>}
            {element.attrs.src && <Badge tone="muted">media</Badge>}
          </div>
          <div className="truncate font-mono text-xs text-[var(--color-muted)]">
            {truncate(element.text || element.attrs.href || element.attrs.src || "(no text)", 72)}
          </div>
          <div className="mt-2 truncate font-mono text-[10px] text-[var(--color-muted)]">
            {truncate(element.css, 90)}
          </div>
        </div>

        <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
          Field name
        </label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="title"
          autoFocus
        />

        <label className="mb-1 mt-4 block text-xs font-medium text-[var(--color-muted)]">
          Extract as
        </label>
        <div className="grid grid-cols-3 gap-2">
          {(["text", "attr", "list"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-md border px-3 py-2 text-sm transition ${
                kind === k
                  ? "border-emerald-600 bg-emerald-950/40 text-emerald-200"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-neutral-600"
              }`}
            >
              {k === "text" && "Text"}
              {k === "attr" && "Attribute"}
              {k === "list" && "List (all matches)"}
            </button>
          ))}
        </div>

        {kind === "attr" && (
          <>
            <label className="mb-1 mt-4 block text-xs font-medium text-[var(--color-muted)]">
              Which attribute
            </label>
            <div className="flex flex-wrap gap-2">
              {availableAttrs.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAttr(a)}
                  className={`rounded-full border px-3 py-1 font-mono text-xs transition ${
                    attr === a
                      ? "border-emerald-600 bg-emerald-950/40 text-emerald-200"
                      : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-neutral-600"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </>
        )}

        {kind === "list" && (
          <p className="mt-3 rounded-md border border-amber-900 bg-amber-950/30 p-2 text-xs text-amber-200">
            List mode returns an array of every element matching this selector — useful
            for catalog pages, tables, search results.
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!label.trim() || (kind === "attr" && !attr)}>
            Add field
          </Button>
        </div>
      </div>
    </div>
  );
}

function suggestLabel(el: DetectedElement, used: string[]): string {
  const tag = el.tag;
  if (tag === "h1") return unique("title", used);
  if (tag === "h2" || tag === "h3") return unique("heading", used);
  if (tag === "img") return unique("image", used);
  if (tag === "a") return unique("link", used);
  if (tag === "button") return unique("button", used);
  if (/\$|€|£|₹|¥/.test(el.text)) return unique("price", used);
  return unique("field", used);
}

function unique(base: string, used: string[]): string {
  if (!used.includes(base)) return base;
  let i = 2;
  while (used.includes(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
