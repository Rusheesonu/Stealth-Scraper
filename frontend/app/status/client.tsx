"use client";

import { useEffect, useState } from "react";
import { api, type StatusResponse } from "@/lib/api";

/**
 * Client-side refresher for /status. Hydrates with the SSR initial data,
 * then polls every 30s. We don't render the verdict here — the server
 * component does that on initial paint; this component just refreshes
 * the data on a timer and triggers a soft re-render when state changes.
 *
 * The "refreshed Xs ago" caption lives here because the timestamp is
 * inherently client-side (server time would drift from the user's clock).
 */
export function StatusClientRefresh({
  initialData,
}: {
  initialData: StatusResponse | null;
}) {
  const [, setData] = useState<StatusResponse | null>(initialData);
  const [lastFetched, setLastFetched] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await api.status();
        if (alive) {
          setData(res);
          setError(null);
          setLastFetched(new Date());
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[var(--color-fg-subdued)]">
      <span>refreshed {timeAgo(lastFetched)}</span>
      <span className="text-[var(--color-fg-subdued)]/70">auto · 30s</span>
      {error && (
        <span className="text-[var(--color-warning)] max-w-md truncate">
          · {error}
        </span>
      )}
    </div>
  );
}

function timeAgo(d: Date): string {
  const sec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}
