"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Save, Trash2, MousePointerClick, Sparkles, Plus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge, Kbd } from "@/components/ui/badge";
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
 * Light Apple system. Each picked field is a Card-like row: hairline
 * border, surface bg, hover lifts the border. Color swatch on the left
 * matches the overlay color on the snapshot canvas, so the user can
 * eyeball which row corresponds to which highlighted region.
 */
export function FieldSidebar({ fields, onRemove, onSave, saving, savedId, colorForIndex }: Props) {
  const [templateName, setTemplateName] = useState("");
  const [showSave, setShowSave] = useState(false);
  const hasListField = fields.some((f) => f.kind === "list");

  return (
    <aside className="flex h-full w-80 flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <div className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
          Fields
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-[22px] font-semibold tracking-[-0.015em] tabular-nums text-[var(--color-fg-strong)]">
            {fields.length}
          </span>
          <span className="text-[13px] text-[var(--color-fg-muted)]">picked</span>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[12px] leading-[1.5] text-[var(--color-fg-muted)]">
          <MousePointerClick className="h-3 w-3 flex-shrink-0 text-[var(--color-fg-subdued)]" />
          Click the snapshot to add fields.
        </p>

        {/* Tip — only when a list field exists. Subtle accent panel, not
            warning-amber muddy garbage. Uses Kbd primitive for the key. */}
        <AnimatePresence>
          {hasListField && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: "auto", marginTop: 12 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.22, ease: APPLE_EASE }}
              className="overflow-hidden"
            >
              <div className="rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-faint)] px-3 py-2">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-3 w-3 flex-shrink-0 text-[var(--color-accent)]" />
                  <p className="text-[11.5px] leading-[1.5] text-[var(--color-fg)]">
                    <Kbd>⇧</Kbd>
                    <span className="text-[var(--color-fg-muted)]"> + click </span>
                    a missing item to add it to your latest list.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {fields.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center">
            <div className="mx-auto mb-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-ink-2)]">
              <Plus className="h-3.5 w-3.5 text-[var(--color-fg-subdued)]" />
            </div>
            <div className="text-[12.5px] font-medium text-[var(--color-fg)]">
              No fields yet
            </div>
            <p className="mt-1 text-[11px] leading-[1.5] text-[var(--color-fg-muted)]">
              Hover the snapshot and click something to start.
            </p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {fields.map((f, i) => (
                <motion.li
                  key={`${f.label}-${i}`}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: APPLE_EASE }}
                  className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 hover:border-[var(--color-border-strong)] transition-[border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                        style={{ background: colorForIndex(i) }}
                      />
                      <span className="truncate text-[13px] font-medium text-[var(--color-fg-strong)]">
                        {f.label}
                      </span>
                    </div>
                    <button
                      onClick={() => onRemove(i)}
                      className="rounded-md p-1 text-[var(--color-fg-subdued)] opacity-0 transition-[opacity,color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-[color:var(--color-danger)]/10 hover:text-[var(--color-danger)] group-hover:opacity-100"
                      aria-label={`Remove field ${f.label}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <Badge tone="muted" size="xs">{f.kind}</Badge>
                    {f.kind === "attr" && f.attr && (
                      <Badge tone="muted" size="xs">@{f.attr}</Badge>
                    )}
                  </div>
                  <div className="mt-1.5 truncate font-mono text-[10px] text-[var(--color-fg-muted)]">
                    {truncate(f.selector, 52)}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      {/* Footer — save action */}
      <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        {savedId != null ? (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: APPLE_EASE }}
            className="flex items-center gap-2 rounded-lg border border-[var(--color-accent-line)] bg-[var(--color-accent-faint)] px-3 py-2 text-[12px] text-[var(--color-fg)]"
          >
            <Check className="h-3.5 w-3.5 flex-shrink-0 text-[var(--color-accent)]" />
            <span>Saved · template #{savedId}</span>
            <Link
              href="/templates"
              className="ml-auto font-medium text-[var(--color-accent)] hover:underline"
            >
              View
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
