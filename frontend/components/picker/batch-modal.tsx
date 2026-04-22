"use client";

import { useMemo, useState } from "react";
import { X, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  defaultUrl: string;
  onCancel: () => void;
  onRun: (urls: string[]) => void | Promise<void>;
};

export function BatchModal({ defaultUrl, onCancel, onRun }: Props) {
  const [text, setText] = useState<string>(defaultUrl);

  const urls = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => (/^https?:\/\//i.test(l) ? l : "https://" + l)),
    [text]
  );

  const deduped = useMemo(() => Array.from(new Set(urls)), [urls]);

  function submit() {
    if (!deduped.length) return;
    void onRun(deduped);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Layers className="h-5 w-5 text-emerald-400" />
              Batch extract
            </h2>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Paste one URL per line. We&apos;ll run the fields you picked against
              each page, in order.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="rounded-md p-1 text-[var(--color-muted)] hover:bg-black/40 hover:text-[var(--color-fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={`https://www.amazon.com/dp/B0ABCDEFGH\nhttps://www.amazon.com/dp/B0IJKLMNOP\n…`}
          className="block w-full resize-y rounded-md border border-[var(--color-border)] bg-black/40 p-3 font-mono text-xs text-[var(--color-fg)] placeholder:text-[var(--color-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          spellCheck={false}
        />

        <div className="mt-2 flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>
            {deduped.length} URL{deduped.length === 1 ? "" : "s"} ·{" "}
            {urls.length - deduped.length > 0
              ? `${urls.length - deduped.length} dupes removed`
              : "no dupes"}
          </span>
          <span>~{Math.round(deduped.length * 4)}s estimated</span>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!deduped.length}>
            Run {deduped.length > 1 ? `${deduped.length} URLs` : "1 URL"}
          </Button>
        </div>
      </div>
    </div>
  );
}
