"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Save, Trash2, MousePointerClick } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { PickedField } from "@/components/picker/picker-client";
import { truncate, cn } from "@/lib/utils";

const APPLE_EASE = [0.32, 0.72, 0, 1] as const;

type Props = {
  fields: PickedField[];
  onRemove: (index: number) => void;
  onSave: (name: string) => void;
  saving: boolean;
  savedId: number | null;
  colorForIndex: (i: number) => string;
};

/**
 * Right rail in the picker — lists every clicked field, lets the user
 * remove individuals, and provides the save-as-template action.
 *
 * Apple/Linear pattern: list rows with hairline separators (not floating
 * cards). Color swatch on the left, label + kind chip next to it, selector
 * underneath in mono micro-type. Hover the row → reveal the trash button.
 *
 * Header is two lines: eyebrow + count headline. The "click the snapshot"
 * hint is woven into the empty state, not a separate paragraph at the top.
 */
export function FieldSidebar({ fields, onRemove, onSave, saving, savedId, colorForIndex }: Props) {
  const [templateName, setTemplateName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const hasListField = fields.some((f) => f.kind === "list");

  return (
    <aside className="flex h-full w-80 flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Header — compact, two lines */}
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
            Fields
          </div>
          {fields.length > 0 && (
            <div className="font-mono text-[10px] text-[var(--color-fg-subdued)]">
              {fields.length}/64
            </div>
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-[24px] font-semibold leading-none tracking-[-0.018em] tabular-nums text-[var(--color-fg-strong)]">
            {fields.length}
          </span>
          <span className="text-[13px] text-[var(--color-fg-muted)]">
            {fields.length === 1 ? "field picked" : "fields picked"}
          </span>
        </div>

        {/* List-mode tip — only when a list field exists, single line,
            no thick panel. Light divider rule above to separate from
            the count headline. */}
        <AnimatePresence>
          {hasListField && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: "auto", marginTop: 10 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.22, ease: APPLE_EASE }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-1.5 text-[11px] leading-[1.4] text-[var(--color-fg-muted)]">
                <Kbd>⇧</Kbd>
                <span className="text-[var(--color-fg)]">+ click</span>
                <span>a missing item to extend the latest list.</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Field list — rows with hairline separators (list pattern, not card) */}
      <div className="flex-1 overflow-y-auto">
        {fields.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-5 text-center">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-ink-2)]">
              <MousePointerClick className="h-4 w-4 text-[var(--color-fg-subdued)]" />
            </div>
            <div className="text-[13px] font-medium text-[var(--color-fg)]">
              No fields yet
            </div>
            <p className="mt-1 max-w-[200px] text-[11.5px] leading-[1.5] text-[var(--color-fg-muted)]">
              Hover the snapshot and click something to add a field.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            <AnimatePresence initial={false}>
              {fields.map((f, i) => (
                <motion.li
                  key={`${f.label}-${i}`}
                  layout
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.18, ease: APPLE_EASE }}
                  className="group relative px-5 py-2.5 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[var(--color-ink-1)]"
                >
                  <div className="flex items-center gap-2.5">
                    {/* Color swatch — tiny dot, ring for definition */}
                    <span
                      className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/15"
                      style={{ background: colorForIndex(i) }}
                    />
                    {/* Label + inline kind chip */}
                    <span className="truncate text-[13px] font-medium text-[var(--color-fg-strong)]">
                      {f.label}
                    </span>
                    <KindChip kind={f.kind} attr={f.attr} />
                    {/* Trash — opacity 0 until row hover */}
                    <button
                      onClick={() => onRemove(i)}
                      className="ml-auto rounded-md p-1 text-[var(--color-fg-subdued)] opacity-0 transition-[opacity,color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[color:var(--color-danger)]/10 hover:text-[var(--color-danger)] group-hover:opacity-100 focus-visible:opacity-100"
                      aria-label={`Remove field ${f.label}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="ml-[18px] mt-1 truncate font-mono text-[10px] text-[var(--color-fg-subdued)]">
                    {truncate(f.selector, 48)}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {/* Footer — primary save action. Has its own divider above. */}
      <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)] p-3">
        {savedId != null ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: APPLE_EASE }}
            className="flex items-center gap-2 rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-faint)] px-3 py-2 text-[12.5px]"
          >
            <Check className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-accent)]" />
            <span className="text-[var(--color-fg)]">
              Saved · <span className="font-mono">#{savedId}</span>
            </span>
            <Link
              href="/templates"
              className="ml-auto text-[11.5px] font-medium text-[var(--color-accent)] hover:underline"
            >
              View →
            </Link>
          </motion.div>
        ) : !showSave ? (
          <Button
            variant="primary"
            size="md"
            onClick={() => setShowSave(true)}
            disabled={!fields.length}
            className="w-full"
          >
            <Save className="h-3.5 w-3.5" />
            Save as template
          </Button>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: APPLE_EASE }}
            className="space-y-2"
          >
            <Input
              autoFocus
              placeholder='Template name (e.g. "HN frontpage")'
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              size="md"
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="md"
                className="flex-1"
                onClick={() => { setShowSave(false); setTemplateName(""); }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                className="flex-1"
                onClick={() => onSave(templateName.trim() || "Untitled")}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </aside>
  );
}

/**
 * Inline kind chip — small, clear, matches the field row density.
 * Not a Badge primitive call because Badge defaults are too padded for
 * inline use. Hand-tuned to sit beside the label like a token.
 */
function KindChip({ kind, attr }: { kind: PickedField["kind"]; attr?: string }) {
  const label = kind === "attr" && attr ? `@${attr}` : kind;
  const isList = kind === "list";
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center rounded px-1.5 font-mono text-[10px] leading-none",
        isList
          ? "bg-[var(--color-accent-faint)] text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent-line)]"
          : "bg-[var(--color-ink-2)] text-[var(--color-fg-muted)] ring-1 ring-inset ring-[var(--color-border)]",
      )}
    >
      {label}
    </span>
  );
}
