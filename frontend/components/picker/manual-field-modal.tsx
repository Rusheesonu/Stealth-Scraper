"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/badge";
import { Modal } from "@/components/motion-primitives";
import { cn } from "@/lib/utils";
import type { TemplateField } from "@/lib/api";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

type Props = {
  existingLabels: string[];
  onCancel: () => void;
  onConfirm: (field: {
    label: string;
    kind: TemplateField["kind"];
    selector: string;
    xpath?: string;
    attr?: string;
  }) => void;
};

/**
 * "Add field manually" — escape hatch for power users.
 *
 * Why: the picker is a great default, but anyone with DevTools open who
 * already knows the CSS selector they want shouldn't have to hunt for it
 * on the snapshot. Paste it in, name it, done. The saved field looks
 * exactly like a clicked one to the rest of the app — same `TemplateField`
 * shape, same /extract payload — only without a bbox to highlight on the
 * canvas. The sidebar tags it `manual` so the user can tell it apart.
 *
 * Same visual language as LabelModal — segmented control for kind, mono
 * inputs for selectors, footer with keyboard hints.
 */
export function ManualFieldModal({ existingLabels, onCancel, onConfirm }: Props) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<TemplateField["kind"]>("text");
  const [selector, setSelector] = useState("");
  const [xpath, setXpath] = useState("");
  const [attr, setAttr] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid = useMemo(() => {
    if (!label.trim()) return false;
    if (!selector.trim() && !xpath.trim()) return false;
    if (kind === "attr" && !attr.trim()) return false;
    return true;
  }, [label, selector, xpath, kind, attr]);

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Give the field a name.");
      return;
    }
    if (existingLabels.includes(trimmed)) {
      setError("You already have a field with that name.");
      return;
    }
    if (!selector.trim() && !xpath.trim()) {
      setError("Provide a CSS selector or an XPath.");
      return;
    }
    if (kind === "attr" && !attr.trim()) {
      setError("Tell us which attribute to read (e.g. href).");
      return;
    }
    onConfirm({
      label: trimmed,
      kind,
      // Selector is required by the API; fall back to a permissive
      // wildcard when the user provided only an XPath. The backend
      // prefers xpath when both are present, so this is a no-op match
      // that won't accidentally hijack the result.
      selector: selector.trim() || "*",
      xpath: xpath.trim() || undefined,
      attr: kind === "attr" ? attr.trim() : undefined,
    });
  }

  // Enter to submit. Stops modal-context Enter from firing when the user
  // is inside a textarea or button — Inputs are single-line so this is safe.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.altKey) {
        if (valid) {
          e.preventDefault();
          submit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, label, kind, selector, xpath, attr]);

  return (
    <Modal open={true} onClose={onCancel} className="max-w-lg">
      <div className="px-5 pt-5 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
              Add field manually
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
              Paste a CSS selector or XPath you already tested in DevTools.
              We&apos;ll add it to this template alongside the ones you clicked.
            </p>
          </div>
          <IconButton onClick={onCancel} size="xs" aria-label="Close">
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="px-5 pb-5">
        {/* Field name */}
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">
          Field name
        </label>
        <Input
          value={label}
          onChange={(e) => { setLabel(e.target.value); setError(null); }}
          placeholder="price"
          autoFocus
          size="md"
          mono
        />

        {/* Extract-as — segmented control. Mirrors the LabelModal pattern,
            but with all 5 kinds so manual fields aren't second-class. */}
        <label className="mb-2 mt-4 block text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">
          Extract as
        </label>
        <div className="grid grid-cols-5 gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-ink-1)] p-1">
          {(["text", "list", "attr", "html", "markdown"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "relative inline-flex items-center justify-center rounded-md px-1.5 py-1.5 text-[12px] font-medium",
                "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                kind === k
                  ? "text-[var(--color-fg-strong)]"
                  : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              {kind === k && (
                <motion.span
                  layoutId="manual-field-kind-thumb"
                  className="absolute inset-0 -z-0 rounded-md bg-[var(--color-surface)] shadow-[var(--shadow-card)] ring-1 ring-[var(--color-border)]"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative z-10 capitalize">{k}</span>
            </button>
          ))}
        </div>

        {/* CSS selector */}
        <label className="mb-1.5 mt-4 block text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">
          CSS selector
        </label>
        <Input
          value={selector}
          onChange={(e) => { setSelector(e.target.value); setError(null); }}
          placeholder="span.a-price-whole"
          size="md"
          mono
          spellCheck={false}
        />

        {/* XPath (optional fallback) */}
        <label className="mb-1.5 mt-4 block text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">
          XPath <span className="ml-1 text-[var(--color-fg-subdued)] normal-case tracking-normal">(optional fallback)</span>
        </label>
        <Input
          value={xpath}
          onChange={(e) => { setXpath(e.target.value); setError(null); }}
          placeholder="//span[@class='a-price-whole']"
          size="md"
          mono
          spellCheck={false}
        />
        <p className="mt-1.5 text-[11px] leading-[1.5] text-[var(--color-fg-muted)]">
          Used when the CSS selector returns nothing.
        </p>

        {/* Attr — only when kind=attr */}
        {kind === "attr" && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: APPLE_EASE }}
          >
            <label className="mb-1.5 mt-4 block text-[11px] font-medium uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Attribute name
            </label>
            <Input
              value={attr}
              onChange={(e) => { setAttr(e.target.value); setError(null); }}
              placeholder="href"
              size="md"
              mono
              spellCheck={false}
            />
          </motion.div>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-[color:var(--color-danger)]/30 bg-[var(--color-danger-soft)] px-3 py-2 text-[12px] text-[var(--color-fg)]">
            {error}
          </div>
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
          <Button variant="primary" size="sm" onClick={submit} disabled={!valid}>
            Add field
          </Button>
        </div>
      </div>
    </Modal>
  );
}
