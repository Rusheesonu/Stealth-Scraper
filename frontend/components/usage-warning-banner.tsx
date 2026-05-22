"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, X } from "lucide-react";
import { api, type UsageStatus } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

/**
 * At-90%-usage warning banner. Renders above the nav so the user sees it
 * BEFORE they hit the hard 403 from the backend's enforce. Dismissable —
 * we keep one dismissal per year-month so a quick "ok seen it" doesn't
 * nag them for the rest of the month, but a fresh month re-shows the
 * warning (intentional: their quota reset, they should know).
 *
 * Gated by:
 *   • signed-in (else /usage 401s)
 *   • percent >= 90
 *   • plan !== business (top tier — no upgrade target)
 *   • not dismissed for this year_month
 */

const DISMISS_KEY_PREFIX = "usage_warning_dismissed_";

function upgradeTarget(plan: string): { name: string; limit: string } | null {
  switch (plan) {
    case "free":     return { name: "Hobby",    limit: "1,000" };
    case "hobby":    return { name: "Pro",      limit: "10,000" };
    case "pro":      return { name: "Business", limit: "100,000" };
    default:         return null;
  }
}

export function UsageWarningBanner() {
  const [data, setData] = useState<UsageStatus | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [authed, setAuthed] = useState<boolean>(false);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!mounted) return;
      if (!user) { setAuthed(false); return; }
      setAuthed(true);
      try {
        const u = await api.usage();
        if (!mounted) return;
        setData(u);
        // Hydrate dismissal flag for this exact year_month.
        try {
          const flag = localStorage.getItem(DISMISS_KEY_PREFIX + u.year_month);
          if (flag === "1") setDismissed(true);
        } catch {}
      } catch {
        // /usage failure is non-fatal — just don't show the banner.
      }
    }

    void load();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) {
        setAuthed(false);
        setData(null);
      } else {
        void load();
      }
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  if (!authed || !data) return null;
  if (data.percent < 90) return null;
  if (dismissed) return null;
  const upgrade = upgradeTarget(data.plan);
  if (!upgrade) return null; // already on top tier, nothing actionable

  function dismiss() {
    if (!data) return;
    try { localStorage.setItem(DISMISS_KEY_PREFIX + data.year_month, "1"); } catch {}
    setDismissed(true);
  }

  // Amber warning bar — not red. They haven't hit the cap yet.
  return (
    <div className="border-b border-[color:var(--color-warning)]/30 bg-[var(--color-warning-dim)]">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-2 text-[13px] text-[var(--color-fg)]">
        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-[color:var(--color-warning)]" />
        <div className="flex-1">
          You&apos;re at <strong className="font-semibold">{data.used.toLocaleString()}/{data.limit.toLocaleString()}</strong>{" "}
          {data.plan} scrapes this month.{" "}
          <Link href="/pricing" className="font-medium text-[var(--color-accent)] hover:underline">
            Upgrade to {upgrade.name}
          </Link>{" "}
          for {upgrade.limit}.
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md p-1 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
