"use client";

import { useMemo, useState } from "react";
import { X, Layers, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Modal } from "@/components/motion-primitives";

type Props = {
  defaultUrl: string;
  onCancel: () => void;
  onRun: (urls: string[]) => void | Promise<void>;
};

/**
 * Batch-extract modal. Paste one URL per line, run the picked template
 * against each in order.
 *
 * Light Apple system. Uses the Modal primitive for chrome + animation.
 * Stats row at the bottom previews how many URLs will run + dedup count.
 */
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
  const dupes = urls.length - deduped.length;

  function submit() {
    if (!deduped.length) return;
    void onRun(deduped);
  }

  return (
    <Modal open={true} onClose={onCancel} className="max-w-xl">
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.01em] text-[var(--color-fg-strong)]">
              <Layers className="h-4 w-4 text-[var(--color-accent)]" />
              Batch extract
            </h2>
            <p className="mt-1 text-[13px] text-[var(--color-fg-muted)]">
              Paste one URL per line. We&apos;ll run the picked fields against each
              page, in order.
            </p>
          </div>
          <IconButton
            onClick={onCancel}
            size="xs"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="px-5 pb-3">
        <Textarea
          autoFocus
          mono
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={`https://www.amazon.com/dp/B0ABCDEFGH\nhttps://www.amazon.com/dp/B0IJKLMNOP\n…`}
          spellCheck={false}
          className="block w-full text-[13px] leading-[1.6]"
        />

        {/* Stats row */}
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={deduped.length > 0 ? "accent" : "muted"} size="sm">
              {deduped.length} URL{deduped.length === 1 ? "" : "s"}
            </Badge>
            {dupes > 0 && (
              <Badge tone="warning" size="sm">{dupes} dupe{dupes === 1 ? "" : "s"} removed</Badge>
            )}
          </div>
          <div className="font-mono text-[11px] text-[var(--color-fg-subdued)]">
            ~{Math.round(deduped.length * 4)}s estimated
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] bg-[var(--color-ink-1)] px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={submit} disabled={!deduped.length}>
          <Play className="h-3 w-3" />
          Run {deduped.length > 1 ? `${deduped.length} URLs` : "1 URL"}
        </Button>
      </div>
    </Modal>
  );
}
