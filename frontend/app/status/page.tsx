"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { api, type StatusResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Status page — realtime without anxiety. No spinners that imply failure,
 * no red unless something is broken. Dot indicators do the talking.
 */
export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await api.status();
        if (alive) { setData(res); setError(null); setLastFetched(new Date()); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void tick();
    const id = setInterval(tick, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const allOk = data?.components.every((c) => c.status === "operational" || c.status === "idle") ?? false;
  const downCount = data?.components.filter((c) => c.status !== "operational" && c.status !== "idle" && c.status !== "not configured").length ?? 0;

  return (
    <PageShell maxWidth="max-w-3xl">
      <div>
        <PageHeader
          eyebrow="System status"
          title="stealthscraper.dev"
          description="Live health of every component. Auto-refreshes every 30 seconds."
          backHref="/"
          backLabel="Home"
        />

        {/* Top status banner */}
        {error ? (
          <BannerError detail={error} />
        ) : !data ? (
          <BannerLoading />
        ) : allOk ? (
          <BannerOk version={data.version} proxy={data.scrape_engine.proxy_region} />
        ) : (
          <BannerDegraded count={downCount} />
        )}

        {/* Components */}
        {data && (
          <div className="mt-8">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Components
            </div>
            <div className="overflow-hidden rounded-lg border border-[var(--color-border)]">
              {data.components.map((c, i) => (
                <div
                  key={c.name}
                  className={cn(
                    "flex items-center justify-between gap-4 px-4 py-3.5",
                    i > 0 && "border-t border-[var(--color-border)]",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <StatusDot status={c.status} />
                    <span className="text-[14px] text-[var(--color-fg)]">{c.name}</span>
                  </div>
                  <span className="font-mono text-[11px] text-[var(--color-fg-subdued)]">{c.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {lastFetched && (
          <div className="mt-8 text-center font-mono text-[11px] text-[var(--color-fg-subdued)]">
            Refreshed {timeAgo(lastFetched)} · auto-refreshes every 30s
          </div>
        )}

        <div className="mt-12 text-center text-[12px] text-[var(--color-fg-muted)]">
          For incidents or planned maintenance, follow{" "}
          <a href="https://x.com/stealthscraper" target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">
            @stealthscraper
          </a>{" "}
          or check{" "}
          <Link href="/settings/usage" className="text-[var(--color-accent)] hover:underline">your usage</Link>.
        </div>
      </div>
    </PageShell>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "operational") {
    return (
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-accent)] opacity-30" />
        <span className="relative h-2 w-2 rounded-full bg-[var(--color-accent)]" />
      </span>
    );
  }
  if (status === "idle" || status === "not configured") {
    return <span className="h-2 w-2 rounded-full bg-[var(--color-fg-subdued)]" />;
  }
  return <span className="h-2 w-2 rounded-full bg-[var(--color-warning)]" />;
}

function BannerOk({ version, proxy }: { version: string; proxy: string | null }) {
  return (
    <Card density="comfortable" className="border-[color:var(--color-accent)]/30 bg-[var(--color-accent-faint)]">
      <div className="flex items-center gap-3">
        <StatusDot status="operational" />
        <div className="flex-1">
          <div className="text-[16px] font-semibold tracking-tight text-[var(--color-fg-strong)]">All systems operational</div>
          <div className="mt-0.5 font-mono text-[11px] text-[var(--color-fg-muted)]">
            v{version}{proxy && ` · egress ${proxy}`}
          </div>
        </div>
      </div>
    </Card>
  );
}

function BannerDegraded({ count }: { count: number }) {
  return (
    <Card density="comfortable" className="border-[color:var(--color-warning)]/30">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-[var(--color-warning)]" />
        <div className="text-[16px] font-semibold tracking-tight">Partial degradation</div>
        <span className="font-mono text-[11px] text-[var(--color-fg-muted)]">{count} component(s) impacted</span>
      </div>
    </Card>
  );
}

function BannerError({ detail }: { detail: string }) {
  return (
    <Card density="comfortable" className="border-[color:var(--color-danger)]/30">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-[color:var(--color-danger)]" />
        <div>
          <div className="text-[16px] font-semibold tracking-tight">Status endpoint unreachable</div>
          <div className="mt-1 font-mono text-[11px] text-[var(--color-fg-muted)]">{detail}</div>
        </div>
      </div>
    </Card>
  );
}

function BannerLoading() {
  return (
    <Card density="comfortable">
      <div className="flex items-center gap-3 text-[14px] text-[var(--color-fg-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking system status…
      </div>
    </Card>
  );
}

function timeAgo(d: Date): string {
  const sec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}
