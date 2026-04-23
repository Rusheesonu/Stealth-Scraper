"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { DetectedElement, TemplateField } from "@/lib/api";
import { findContainingParent, findSiblings, truncate } from "@/lib/utils";

type Props = {
  element: DetectedElement;
  allElements: DetectedElement[];
  existingLabels: string[];
  onCancel: () => void;
  onConfirm: (
    el: DetectedElement,
    v: { label: string; kind: TemplateField["kind"]; attr?: string }
  ) => void;
};

const COMMON_ATTRS = ["href", "src", "alt", "title", "value"];

export function LabelModal({ element, allElements, existingLabels, onCancel, onConfirm }: Props) {
  // Track which element the user is labeling. Starts as the clicked one,
  // but the "Select parent" button walks up the collected element tree
  // so users can rescue an accidental click on a too-small inner span.
  const [currentEl, setCurrentEl] = useState<DetectedElement>(element);

  const siblings = useMemo(
    () => findSiblings(currentEl, allElements),
    [currentEl, allElements]
  );
  const siblingCount = siblings.length;

  const parentEl = useMemo(
    () => findContainingParent(currentEl, allElements),
    [currentEl, allElements]
  );

  // Default to "list" kind if the clicked element has sibling matches —
  // user almost certainly wants the whole list. Scalar fields (single
  // h1, a unique price) stay as "text".
  const [label, setLabel] = useState(() =>
    suggestLabel(currentEl, existingLabels, siblingCount > 1)
  );
  const [kind, setKind] = useState<TemplateField["kind"]>(
    siblingCount > 1 ? "list" : "text"
  );
  const [attr, setAttr] = useState<string>(() =>
    currentEl.attrs.href ? "href" : currentEl.attrs.src ? "src" : ""
  );

  const availableAttrs = useMemo(() => {
    const keys = Object.keys(currentEl.attrs || {});
    const combined = Array.from(new Set([...keys, ...COMMON_ATTRS]));
    return combined.filter(Boolean);
  }, [currentEl.attrs]);

  // When the user walks up to a parent, re-seed sensible defaults based
  // on the new element's shape — but only touch fields that look like
  // they were on autopilot (still the auto-suggested name, attr still
  // auto-picked). A user-typed label is sacred.
  useEffect(() => {
    setAttr((prev) =>
      prev && currentEl.attrs[prev] ? prev : currentEl.attrs.href ? "href" : currentEl.attrs.src ? "src" : ""
    );
    // Only auto-switch list/text if the user hadn't overridden it yet.
    setKind((prev) => (prev === "attr" ? prev : siblingCount > 1 ? "list" : "text"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEl.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && label.trim() && !e.altKey && !e.metaKey) {
        submit();
      }
      // Alt/Option + ↑ walks up to the containing parent. Matches the
      // "Select parent" button — gives keyboard users the same escape hatch.
      if (e.key === "ArrowUp" && (e.altKey || e.metaKey)) {
        e.preventDefault();
        if (parentEl) setCurrentEl(parentEl);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, kind, attr, parentEl]);

  function submit() {
    const duplicate = existingLabels.includes(label.trim());
    if (duplicate) {
      alert("You already have a field with that name");
      return;
    }
    onConfirm(currentEl, {
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

        <div className="mb-3 rounded-md border border-[var(--color-border)] bg-black/40 p-3">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone="accent">&lt;{currentEl.tag}&gt;</Badge>
            {currentEl.attrs.href && <Badge tone="muted">link</Badge>}
            {currentEl.attrs.src && <Badge tone="muted">media</Badge>}
          </div>
          <div className="truncate font-mono text-xs text-[var(--color-muted)]">
            {truncate(
              currentEl.text || currentEl.attrs.href || currentEl.attrs.src || "(no text)",
              72
            )}
          </div>
          <div className="mt-2 truncate font-mono text-[10px] text-[var(--color-muted)]">
            {truncate(currentEl.css, 90)}
          </div>
        </div>

        {/* Parent-select escape hatch — climbs up to the smallest detected
            wrapper containing the current element. Critical when a click
            landed on a too-tight inner span (e.g. the "$319" half of a
            composite "$319.99" price). */}
        <div className="mb-4 flex items-center justify-between gap-2 rounded-md border border-dashed border-[var(--color-border)] bg-black/20 px-3 py-1.5 text-xs">
          <span className="text-[var(--color-muted)]">
            Wrong element? Walk up the DOM.
          </span>
          <button
            onClick={() => parentEl && setCurrentEl(parentEl)}
            disabled={!parentEl}
            className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-black/40 px-2 py-0.5 font-mono text-[10px] text-emerald-300 transition hover:border-emerald-700 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
            title="Alt/Option + ↑"
          >
            <ArrowUp className="h-3 w-3" />
            Select parent
          </button>
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
          <div className="mt-3 space-y-2">
            <div className="rounded-md border border-emerald-900 bg-emerald-950/30 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-semibold text-emerald-300">
                  {siblingCount > 1
                    ? `Found ${siblingCount} similar items`
                    : "No similar items detected"}
                </span>
              </div>
              {siblingCount > 1 ? (
                <ul className="space-y-0.5 font-mono text-[10px] text-emerald-200/80">
                  {siblings.slice(0, 4).map((s, i) => (
                    <li key={i} className="truncate">
                      <span className="text-emerald-500/60">{i + 1}.</span>{" "}
                      {truncate(s.text || s.attrs.href || s.attrs.src || "(empty)", 84)}
                    </li>
                  ))}
                  {siblingCount > 4 && (
                    <li className="text-emerald-500/60">… and {siblingCount - 4} more</li>
                  )}
                </ul>
              ) : (
                <p className="text-xs text-amber-200">
                  This element doesn&apos;t match any siblings on the page. List mode will
                  still return its value in an array, but you may want to pick a different
                  element — something inside a repeating card (price, title, image).
                </p>
              )}
            </div>
          </div>
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

function suggestLabel(el: DetectedElement, used: string[], isList: boolean): string {
  const tag = el.tag;
  if (tag === "h1") return unique(isList ? "titles" : "title", used);
  if (tag === "h2" || tag === "h3") return unique(isList ? "headings" : "heading", used);
  if (tag === "img") return unique(isList ? "images" : "image", used);
  if (tag === "a") return unique(isList ? "links" : "link", used);
  if (tag === "button") return unique("button", used);
  if (/\$|€|£|₹|¥/.test(el.text)) return unique(isList ? "prices" : "price", used);
  return unique(isList ? "items" : "field", used);
}

function unique(base: string, used: string[]): string {
  if (!used.includes(base)) return base;
  let i = 2;
  while (used.includes(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}
