"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, AlertTriangle, TrendingUp, Sparkles } from "lucide-react";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type UsageStatus } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

function UsagePageInner() {
  const search = useSearchParams();
  const upgraded = search.get("upgraded") === "1";

  const [data, setData] = useState<UsageStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Plan we expect to have landed on (anything but free, really). When the
   *  user returns from LS we poll until the plan flips off "free". */
  const [pollingUpgrade, setPollingUpgrade] = useState<boolean>(upgraded);
  const [celebrate, setCelebrate] = useState<string | null>(null);

  // Persist initial plan so we can detect the actual flip post-webhook.
  const initialPlanRef = useRef<string | null>(null);

  useEffect(() => {
    async function load() {
      try { return await api.usage(); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
    }

    async function init() {
      if (upgraded) {
        // Force a Supabase session refresh — the user's JWT might still
        // carry the pre-checkout claims even though the LS webhook has fired.
        try {
          const supabase = createClient();
          await supabase.auth.refreshSession();
        } catch {
          // refresh failure is non-fatal; polling will still flush eventually.
        }
      }
      const u = await load();
      if (u) {
        setData(u);
        initialPlanRef.current = u.plan;
        if (upgraded && u.plan !== "free") {
          // Already landed — webhook beat us, celebrate immediately.
          setCelebrate(u.plan);
          setPollingUpgrade(false);
        }
      }
    }
    void init();
  }, [upgraded]);

  // Poll every 5s for up to 60s in case the LS webhook is slow.
  useEffect(() => {
    if (!pollingUpgrade) return;
    const start = Date.now();
    const id = setInterval(async () => {
      if (Date.now() - start > 60_000) {
        clearInterval(id);
        setPollingUpgrade(false);
        return;
      }
      try {
        const u = await api.usage();
        setData(u);
        if (initialPlanRef.current && u.plan !== initialPlanRef.current && u.plan !== "free") {
          setCelebrate(u.plan);
          setPollingUpgrade(false);
          clearInterval(id);
        }
      } catch {
        // ignore intermittent fetch errors during polling
      }
    }, 5000);
    return () => clearInterval(id);
  }, [pollingUpgrade]);

  // Auto-dismiss celebration toast after 6 seconds — long enough to read.
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(null), 6000);
    return () => clearTimeout(t);
  }, [celebrate]);

  const pct = data ? Math.min(100, data.percent) : 0;
  const barColor =
    pct >= 90 ? "bg-[color:var(--color-danger)]"
    : pct >= 75 ? "bg-[color:var(--color-warning)]"
    : "bg-[var(--color-accent)]";

  return (
    <PageShell maxWidth="max-w-3xl">
      <div>
        <PageHeader
          eyebrow="Account · Usage"
          title="This month"
          description="Scrapes used in the current calendar month. Resets on the 1st (UTC)."
          backHref="/"
          backLabel="Home"
        />

        {/* Welcome / celebration card — shown after LS checkout returns. */}
        {celebrate && (
          <Card density="comfortable" className="mb-6 border-[color:var(--color-accent)]/40 bg-[var(--color-accent-faint)]">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-accent)]" />
              <div className="flex-1">
                <div className="text-[14px] font-semibold tracking-tight text-[var(--color-fg-strong)]">
                  Welcome to {celebrate.charAt(0).toUpperCase() + celebrate.slice(1)}!
                </div>
                <p className="mt-1 text-[12.5px] text-[var(--color-fg-muted)]">
                  Your new limits are active. Receipt is in your email — manage your subscription in your billing portal.
                </p>
              </div>
              <button
                onClick={() => setCelebrate(null)}
                className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline"
              >
                Dismiss
              </button>
            </div>
          </Card>
        )}

        {/* Pending-webhook card — only when we returned with ?upgraded=1 but
            backend hasn't flipped the plan yet. Disappears once the poll
            finds the new plan, or after the 60s budget elapses. */}
        {pollingUpgrade && !celebrate && (
          <Card density="compact" className="mb-6 border-[color:var(--color-accent)]/30">
            <div className="flex items-start gap-2.5 text-[13px] text-[var(--color-fg)]">
              <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-[var(--color-accent)]" />
              <div className="flex-1">
                Finalizing your upgrade… <span className="text-[var(--color-fg-muted)]">This usually takes a few seconds.</span>
              </div>
            </div>
          </Card>
        )}

        {error && (
          <Card density="compact" className="mb-6 border-[color:var(--color-danger)]/30">
            <div className="flex items-start gap-2 text-[13px] text-[color:var(--color-danger)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> {error}
            </div>
          </Card>
        )}

        {!data && !error && (
          <div className="flex items-center gap-2 text-[13px] text-[var(--color-fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {data && (
          <>
            <Card density="comfortable">
              <div className="mb-4 flex items-baseline justify-between">
                <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                  {data.year_month}
                </div>
                <Badge tone={data.plan === "free" ? "muted" : "accent"} size="sm">
                  {data.plan} plan
                </Badge>
              </div>

              <div className="mb-5 flex items-baseline gap-2">
                <span className="text-[44px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--color-fg-strong)]">
                  {data.used.toLocaleString()}
                </span>
                <span className="text-[14px] text-[var(--color-fg-muted)]">
                  / {data.limit.toLocaleString()} scrapes
                </span>
              </div>

              <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                <div
                  className={cn("h-full rounded-full transition-all duration-[var(--dur-deliberate)] ease-[var(--ease-out)]", barColor)}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex justify-between font-mono text-[11px] text-[var(--color-fg-subdued)]">
                <span>{pct.toFixed(1)}% used</span>
                <span>{data.remaining.toLocaleString()} remaining</span>
              </div>
            </Card>

            {pct >= 75 && (
              <Card density="compact" className="mt-4 border-[color:var(--color-warning)]/30">
                <div className="flex items-start gap-2.5">
                  <TrendingUp className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-warning)]" />
                  <div className="flex-1 text-[13px] text-[var(--color-fg)]">
                    You&apos;ve used {pct.toFixed(0)}% of this month&apos;s quota.{" "}
                    <Link href="/pricing" className="text-[var(--color-accent)] hover:underline">
                      Upgrade
                    </Link>{" "}
                    to keep scraping at full speed.
                  </div>
                </div>
              </Card>
            )}

            {data.plan === "free" && (
              <Card density="comfortable" className="mt-6">
                <div className="text-[14px] font-semibold tracking-tight">You&apos;re on the free tier</div>
                <p className="mt-1.5 text-[12px] text-[var(--color-fg-muted)]">
                  Free: 50 scrapes/mo, soft sites. Hard sites (Cloudflare,
                  Datadome) require Hobby+ ($29/mo, 1,000 scrapes).
                </p>
                <Link href="/pricing">
                  <Button variant="primary" size="sm" className="mt-3">See plans →</Button>
                </Link>
              </Card>
            )}
          </>
        )}

        <div className="mt-12 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[11px] text-[var(--color-fg-subdued)]">
          <Link href="/settings/api-keys" className="hover:text-[var(--color-fg)]">API keys →</Link>
          <Link href="/settings/schedules" className="hover:text-[var(--color-fg)]">Scheduled scrapes →</Link>
          <Link href="/status" className="hover:text-[var(--color-fg)]">System status →</Link>
        </div>
      </div>
    </PageShell>
  );
}

export default function UsagePage() {
  // useSearchParams needs a Suspense boundary in App Router.
  return (
    <Suspense fallback={null}>
      <UsagePageInner />
    </Suspense>
  );
}
