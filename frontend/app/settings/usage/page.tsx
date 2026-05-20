"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, AlertTriangle, TrendingUp } from "lucide-react";
import { Nav } from "@/components/nav";
import { api, type UsageStatus } from "@/lib/api";

export default function UsagePage() {
  const [data, setData] = useState<UsageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.usage();
        setData(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    void load();
  }, []);

  const pct = data ? Math.min(100, data.percent) : 0;
  const barColor =
    pct >= 90
      ? "bg-red-500"
      : pct >= 75
      ? "bg-amber-500"
      : "bg-[var(--color-accent)]";

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-semibold tracking-tight">Usage</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Scrapes used this calendar month. Resets on the 1st (UTC).
          </p>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-md border border-red-900 bg-red-950/40 p-4 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {data && (
          <>
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)]/40 p-8">
              <div className="mb-3 flex items-baseline justify-between">
                <div className="text-sm uppercase tracking-wider text-[var(--color-muted)]">
                  Current period · {data.year_month}
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  Plan:{" "}
                  <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 font-mono text-emerald-300">
                    {data.plan}
                  </span>
                </div>
              </div>

              <div className="mb-5 flex items-baseline gap-3">
                <div className="text-5xl font-semibold tabular-nums">
                  {data.used.toLocaleString()}
                </div>
                <div className="text-lg text-[var(--color-muted)]">
                  / {data.limit.toLocaleString()} scrapes
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-2 h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-[var(--color-muted)]">
                <span>{pct.toFixed(1)}% used</span>
                <span>{data.remaining.toLocaleString()} remaining</span>
              </div>
            </div>

            {pct >= 75 && (
              <div className="mt-6 flex items-start gap-3 rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm">
                <TrendingUp className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-400" />
                <div className="text-amber-100">
                  You&apos;ve used {pct.toFixed(0)}% of this month&apos;s quota.{" "}
                  <Link
                    href="/pricing"
                    className="font-medium text-amber-300 underline hover:text-amber-200"
                  >
                    Upgrade to a higher tier
                  </Link>{" "}
                  to keep scraping at full speed.
                </div>
              </div>
            )}

            {data.plan === "free" && (
              <div className="mt-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/30 p-5">
                <div className="mb-2 text-sm font-semibold">
                  You&apos;re on the free tier.
                </div>
                <p className="mb-3 text-xs text-[var(--color-muted)]">
                  Free tier: 100 scrapes/month, soft sites only. Hard sites
                  (Cloudflare, Datadome) require Hobby+ ($29/mo, 1,000 scrapes).
                </p>
                <Link
                  href="/pricing"
                  className="inline-flex items-center rounded-md bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-medium text-zinc-900 hover:opacity-90"
                >
                  See plans →
                </Link>
              </div>
            )}
          </>
        )}

        <div className="mt-12 text-xs text-[var(--color-muted)]">
          <Link href="/settings/api-keys" className="hover:text-[var(--color-fg)]">
            Manage API keys
          </Link>
          {" · "}
          <Link href="/status" className="hover:text-[var(--color-fg)]">
            System status
          </Link>
        </div>
      </div>
    </main>
  );
}
