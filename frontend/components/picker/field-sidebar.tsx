"use client";

import { useState } from "react";
import { Check, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { PickedField } from "@/components/picker/picker-client";
import { truncate } from "@/lib/utils";
import Link from "next/link";

type Props = {
  fields: PickedField[];
  onRemove: (index: number) => void;
  onSave: (name: string) => void;
  saving: boolean;
  savedId: number | null;
  colorForIndex: (i: number) => string;
};

export function FieldSidebar({ fields, onRemove, onSave, saving, savedId, colorForIndex }: Props) {
  const [templateName, setTemplateName] = useState("");
  const [showSave, setShowSave] = useState(false);

  return (
    <aside className="flex w-80 flex-col border-l border-[var(--color-border)] bg-[var(--color-panel)]/60">
      <div className="border-b border-[var(--color-border)] px-4 py-3">
        <div className="text-xs font-mono text-[var(--color-muted)]">FIELDS</div>
        <div className="text-lg font-semibold">
          {fields.length} picked
        </div>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Click elements on the snapshot to add them.
        </p>
        {fields.some((f) => f.kind === "list") && (
          <p className="mt-1.5 rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1 text-[10px] text-amber-200">
            Tip: <kbd className="rounded bg-black/60 px-1 font-mono">⇧</kbd>-click a
            missing item to add it to your latest list.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-auto px-2 py-2">
        {fields.length === 0 ? (
          <div className="mx-2 rounded-md border border-dashed border-[var(--color-border)] p-4 text-center text-xs text-[var(--color-muted)]">
            No fields yet. Hover the snapshot and click something to start.
          </div>
        ) : (
          <ul className="space-y-2">
            {fields.map((f, i) => (
              <li
                key={i}
                className="group rounded-md border border-[var(--color-border)] bg-black/30 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: colorForIndex(i) }}
                    />
                    <span className="truncate text-sm font-medium">{f.label}</span>
                  </div>
                  <button
                    onClick={() => onRemove(i)}
                    className="opacity-0 group-hover:opacity-100 text-[var(--color-muted)] hover:text-red-400"
                    aria-label="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge tone="muted">{f.kind}</Badge>
                  {f.kind === "attr" && f.attr && (
                    <Badge tone="muted">@{f.attr}</Badge>
                  )}
                </div>
                <div className="mt-1 truncate font-mono text-[10px] text-[var(--color-muted)]">
                  {truncate(f.selector, 48)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] p-3 space-y-2">
        {savedId != null ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
            <Check className="h-4 w-4" />
            <span>Saved as template #{savedId}</span>
            <Link href="/templates" className="ml-auto underline hover:text-emerald-100">
              View
            </Link>
          </div>
        ) : !showSave ? (
          <Button
            variant="secondary"
            onClick={() => setShowSave(true)}
            disabled={!fields.length}
            className="w-full"
          >
            <Save className="h-4 w-4" />
            Save as template
          </Button>
        ) : (
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="Template name (e.g. 'HN frontpage')"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setShowSave(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => onSave(templateName.trim() || "Untitled")}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
