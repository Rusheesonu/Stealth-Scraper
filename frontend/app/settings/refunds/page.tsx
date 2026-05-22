"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { PageShell } from "@/components/nav";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, type Refund } from "@/lib/api";

export default function RefundsPage() {
  const [refunds, setRefunds] = useState<Refund[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.refunds
      .list()
      .then((r) => {
        if (alive) setRefunds(r.refunds);
      })
      .catch((e) => {
        if (alive) setErr(e.message || String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <PageShell>
      <PageHeader
        title="Refunds"
        description="Every failed scrape is auto-refunded within minutes. Receipts below."
      />

      <Card className="mb-8 flex items-start gap-4 border-emerald-500/30 bg-emerald-500/5 p-5">
        <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
        <div>
          <div className="font-semibold text-[var(--color-fg)]">Reliability SLA</div>
          <p className="mt-1 text-sm text-[var(--color-fg-subdued)]">
            If a scrape returns blocked, empty, or errors out — we don&apos;t
            charge you. Credit is refunded automatically within minutes.
            Refunds show up on your monthly usage as <span className="font-mono">+1</span> credit
            and are listed here for audit.
          </p>
        </div>
      </Card>

      {err && (
        <Card className="flex items-center gap-2 border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600">
          <AlertCircle className="h-4 w-4" />
          {err}
        </Card>
      )}

      {refunds === null && !err && (
        <div className="flex items-center gap-2 text-sm text-[var(--color-fg-subdued)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading refund history…
        </div>
      )}

      {refunds && refunds.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-sm text-[var(--color-fg-subdued)]">
            No refunds yet — none of your scrapes have failed. Nice.
          </p>
          <p className="mt-3 text-xs text-[var(--color-fg-subdued)]">
            <Link href="/settings/usage" className="underline">
              View usage →
            </Link>
          </p>
        </Card>
      )}

      {refunds && refunds.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-mono uppercase tracking-wider text-[var(--color-fg-subdued)]">
              {refunds.length} {refunds.length === 1 ? "refund" : "refunds"}
            </h2>
            <span className="text-xs text-[var(--color-fg-subdued)]">
              Auto-refunded — no action needed
            </span>
          </div>
          <Card className="divide-y divide-[var(--color-border)] p-0">
            {refunds.map((r) => (
              <RefundRow key={r.id} refund={r} />
            ))}
          </Card>
        </div>
      )}
    </PageShell>
  );
}

function RefundRow({ refund }: { refund: Refund }) {
  const date = new Date(refund.refunded_at);
  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            +{refund.refunded_count} credit
          </Badge>
          <span className="font-mono text-xs text-[var(--color-fg-subdued)]">
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div className="mt-1.5 text-sm text-[var(--color-fg)]">{refund.reason}</div>
        {refund.url && (
          <div className="mt-1 truncate font-mono text-xs text-[var(--color-fg-subdued)]">
            {refund.url}
          </div>
        )}
      </div>
    </div>
  );
}
