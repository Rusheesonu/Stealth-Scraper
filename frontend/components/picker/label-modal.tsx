"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, Check, X } from "lucide-react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge, Kbd } from "@/components/ui/badge";
import { Modal } from "@/components/motion-primitives";
import { cn } from "@/lib/utils";
import type { DetectedElement, TemplateField } from "@/lib/api";
import { findContainingParent, findSiblings, truncate } from "@/lib/utils";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

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

/**
 * Label-this-field modal. Opens after a click on the snapshot canvas.
 * Three jobs:
 *   1. Show the user what they clicked (tag + text + selector).
 *   2. Give them an escape hatch ("walk up the DOM") for misclicks.
 *   3. Collect the field name + extraction kind (text / attribute / list).
 *
 * Light Apple system. Uses the Modal primitive for chrome + animation.
 * "Extract as" is a proper segmented control (matches the landing's
 * tab toggle pattern). List preview uses accent tones, not muddy emerald.
 */
export function LabelModal({ element, allElements, existingLabels, onCancel, onConfirm }: Props) {
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

  useEffect(() => {
    setAttr((prev) =>
      prev && currentEl.attrs[prev] ? prev : currentEl.attrs.href ? "href" : currentEl.attrs.src ? "src" : ""
    );
    setKind((prev) => (prev === "attr" ? prev : siblingCount > 1 ? "list" : "text"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEl.id]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && label.trim() && !e.altKey && !e.metaKey) {
        e.preventDefault();
        submit();
      }
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
    <Modal open={true} onClose={onCancel} className="max-w-lg">
      <div className="px-5 pt-5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
              Label this field
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
              Give it a name you&apos;ll recognize in the output JSON.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md p-1 text-[var(--color-fg-muted)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-5 pb-5">
        {/* Element preview — the element they clicked, shown as a card. */}
        <div className="mb-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-ink-1)] p-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            <Badge tone="accent" size="xs" className="font-mono">
              &lt;{currentEl.tag}&gt;
            </Badge>
            {currentEl.attrs.href && <Badge tone="info" size="xs">link</Badge>}
            {currentEl.attrs.src && <Badge tone="info" size="xs">media</Badge>}
            {siblingCount > 1 && (
              <Badge tone="muted" size="xs">{siblingCount} similar</Badge>
            )}
          </div>
          <div className="font-mono text-[13px] leading-[1.5] text-[var(--color-fg)]">
            <span className="text-[var(--color-fg-subdued)]">&ldquo;</span>
            {truncate(
              currentEl.text || currentEl.attrs.href || currentEl.attrs.src || "(no text)",
              82
            )}
            <span className="text-[var(--color-fg-subdued)]">&rdquo;</span>
          </div>
          <div className="mt-2 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
            {truncate(currentEl.css, 96)}
          </div>
        </div>

        {/* Walk-up escape hatch. Subtle row, only readable on hover. */}
        <button
          onClick={() => parentEl && setCurrentEl(parentEl)}
          disabled={!parentEl}
          title="Alt/Option + ↑"
          className={cn(
            "mb-5 flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-[var(--color-border)] px-3 py-2 text-[13px]",
            "transition-[border-color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            "hover:border-[var(--color-border-strong)] hover:bg-[var(--color-ink-1)]",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <span className="text-[var(--color-fg-muted)]">
            Wrong element? Walk up the DOM.
          </span>
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-[var(--color-fg)]">
            <ArrowUp className="h-3 w-3" />
            Select parent
          </span>
        </button>

        {/* Field name */}
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">
          Field name
        </label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="title"
          autoFocus
          size="md"
          mono
        />

        {/* Extract-as — segmented control, three options */}
        <label className="mb-2 mt-4 block text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">
          Extract as
        </label>
        <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-ink-1)] p-1">
          {(["text", "attr", "list"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "relative inline-flex items-center justify-center rounded-md px-2 py-1.5 text-[13px] font-medium",
                "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                kind === k
                  ? "text-[var(--color-fg-strong)]"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              {kind === k && (
                <motion.span
                  layoutId="label-modal-kind-thumb"
                  className="absolute inset-0 -z-0 rounded-md bg-[var(--color-surface)] shadow-[var(--shadow-card)] ring-1 ring-[var(--color-border)]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative z-10">
                {k === "text" && "Text"}
                {k === "attr" && "Attribute"}
                {k === "list" && "List"}
              </span>
            </button>
          ))}
        </div>

        {/* Kind-specific subform */}
        {kind === "attr" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: APPLE_EASE }}
          >
            <label className="mb-1.5 mt-4 block text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Which attribute
            </label>
            <div className="flex flex-wrap gap-1.5">
              {availableAttrs.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAttr(a)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                    attr === a
                      ? "border-[var(--color-accent)] bg-[var(--color-accent-faint)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]",
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {kind === "list" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: APPLE_EASE }}
            className="mt-3"
          >
            {siblingCount > 1 ? (
              <div className="rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-faint)] p-3">
                <div className="mb-2 flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-[var(--color-accent)]" />
                  <span className="text-[13px] font-semibold text-[var(--color-fg-strong)]">
                    Found {siblingCount} similar items
                  </span>
                </div>
                <ul className="space-y-0.5 font-mono text-[11px] leading-[1.55] text-[var(--color-fg)]">
                  {siblings.slice(0, 4).map((s, i) => (
                    <li key={i} className="truncate">
                      <span className="text-[var(--color-fg-subdued)]">{i + 1}.</span>{" "}
                      &ldquo;{truncate(s.text || s.attrs.href || s.attrs.src || "(empty)", 78)}&rdquo;
                    </li>
                  ))}
                  {siblingCount > 4 && (
                    <li className="text-[var(--color-fg-subdued)]">… and {siblingCount - 4} more</li>
                  )}
                </ul>
              </div>
            ) : (
              <div className="rounded-lg border border-[color:var(--color-warning)]/30 bg-[var(--color-warning-soft)] p-3">
                <div className="mb-1 text-[13px] font-semibold text-[var(--color-fg-strong)]">
                  No similar items detected
                </div>
                <p className="text-[11px] leading-[1.55] text-[var(--color-fg-muted)]">
                  List mode will still return this in an array, but you may want to pick
                  a different element — something inside a repeating card.
                </p>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-ink-1)] px-5 py-3">
        <div className="font-mono text-[11px] text-[var(--color-fg-muted)]">
          <Kbd>↵</Kbd>
          <span className="ml-1">to add</span>
          <span className="mx-1.5 text-[var(--color-fg-subdued)]">·</span>
          <Kbd>esc</Kbd>
          <span className="ml-1">cancel</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={!label.trim() || (kind === "attr" && !attr)}
          >
            Add field
          </Button>
        </div>
      </div>
    </Modal>
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
