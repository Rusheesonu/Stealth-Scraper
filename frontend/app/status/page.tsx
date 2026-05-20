"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Nav } from "@/components/nav";
import { api, type StatusResponse } from "@/lib/api";

export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const res = await api.status();
        if (alive) {
          setData(res);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const allOk =
    data?.components.every(
      (c) => c.status === "operational" || c.status === "idle",
    ) ?? false;

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-10">
          <h1 className="mb-2 text-3xl font-semibold tracking-tight">Status</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Real-time view of Stealth-Scraper services. Refreshes every 30s.
          </p>
        </div>

        {/* Top banner */}
        {error ? (
          <div className="mb-8 flex items-center gap-3 rounded-lg border border-red-900 bg-red-950/40 p-5">
            <AlertTriangle className="h-5 w-5 text-red-300" />
            <div>
              <div className="font-medium text-red-200">Couldn&apos;t reach status endpoint</div>
              <div className="text-xs text-red-300/80">{error}</div>
            </div>
          </div>
        ) : !data ? (
          <div className="mb-8 flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/40 p-5">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted)]" />
            <span className="text-sm text-[var(--color-muted)]">Loading…</span>
          </div>
        ) : (
          <div
            className={`mb-8 flex items-center gap-3 rounded-lg border p-5 ${
              allOk
                ? "border-emerald-700 bg-emerald-950/30"
                : "border-amber-700 bg-amber-950/30"
            }`}
          >
            <CheckCircle2
              className={`h-6 w-6 ${
                allOk ? "text-emerald-400" : "text-amber-400"
              }`}
            />
            <div>
              <div className="text-lg font-semibold">
                {allOk ? "All systems operational" : "Partial degradation"}
              </div>
              <div className="text-xs text-[var(--color-muted)]">
                v{data.version} · scrape engine{" "}
                {data.scrape_engine.running ? "warm" : "idle"}
                {data.scrape_engine.proxy_region &&
                  ` · proxy ${data.scrape_engine.proxy_region}`}
              </div>
            </div>
          </div>
        )}

        {/* Components */}
        {data && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/30">
            {data.components.map((c, i) => (
              <div
                key={c.name}
                className={`flex items-center justify-between px-5 py-3.5 ${
                  i > 0 ? "border-t border-[var(--color-border)]" : ""
                }`}
              >
                <span className="text-sm">{c.name}</span>
                <span className={statusPillClass(c.status)}>{c.status}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-10 text-xs text-[var(--color-muted)]">
          Want incident emails? Sign in →{" "}
          <Link href="/settings/api-keys" className="text-[var(--color-accent)] hover:underline">
            settings
          </Link>
          .
        </div>
      </div>
    </main>
  );
}

function statusPillClass(status: string): string {
  const base = "rounded-full px-2.5 py-0.5 text-xs font-mono";
  if (status === "operational") return `${base} bg-emerald-950/60 text-emerald-300`;
  if (status === "idle") return `${base} bg-zinc-800 text-zinc-400`;
  if (status === "not configured") return `${base} bg-zinc-800 text-zinc-500`;
  return `${base} bg-amber-950/60 text-amber-300`;
}
