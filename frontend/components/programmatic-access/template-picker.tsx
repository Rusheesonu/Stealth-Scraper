"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SavedTemplate } from "@/lib/api";

/**
 * Two-control row above the snippet:
 *  • Template dropdown (your saved templates).
 *  • URL input — defaults to the template's source_url, freely editable.
 *
 * Both feed into the live snippet on every keystroke. When the user
 * picks a different template, the URL auto-syncs to that template's
 * source_url; further typing in URL stays local until the next pick.
 */
export function TemplatePicker({
  templates,
  templateId,
  url,
  onTemplateChange,
  onUrlChange,
}: {
  templates: SavedTemplate[];
  templateId: number | null;
  url: string;
  onTemplateChange: (id: number) => void;
  onUrlChange: (next: string) => void;
}) {
  const disabled = templates.length === 0;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="prog-template"
          className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]"
        >
          Template
        </label>
        <select
          id="prog-template"
          disabled={disabled}
          value={templateId ?? ""}
          onChange={(e) => onTemplateChange(Number(e.target.value))}
          className={cn(
            "h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-fg)]",
            "transition-[border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            "hover:border-[var(--color-border-strong)] focus-visible:border-[var(--color-fg-strong)] focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {templates.length === 0 ? (
            <option>No templates yet</option>
          ) : (
            templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="prog-url"
          className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]"
        >
          Target URL
        </label>
        <Input
          id="prog-url"
          mono
          type="url"
          size="md"
          disabled={disabled}
          placeholder="https://example.com/product/123"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
        />
      </div>
    </div>
  );
}
