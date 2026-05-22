"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { PageShell } from "@/components/nav";
import { api, type StatusResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Status page — designed surface, not a default. The audit (May 22)
 * flagged the prior version as "reads as a Hetzner-clone default" —
 * fixed here with a proper hierarchy:
 *
 *   1. HERO STATUS — display-sized verdict line with a glowing dot.
 *      One thing per viewport, calmly authoritative.
 *   2. METADATA STRIP — version, egress region, last refresh — quiet
 *      mono labels, never the focal point.
 *   3. COMPONENT GRID — borderless list with tabular alignment,
 *      per-row dot + label + status pill. No card chrome — the page
 *      already IS the card.
 *
 * Design choices defended:
 *   • Display-size headline reserves accent visual weight for the
 *     RIGHT moment (a single status verdict at a time).
 *   • No "Refreshed Xs ago" banner — it's a footnote, not a CTA. Lives
 *     in the metadata strip with monospace caption type.
 *   • Subtle accent line under the banner (border-b) replaces the
 *     bordered Card. The page reads as a long single document, not a
 *     bento grid of bordered boxes.
 *   • Component list uses divide-y separators (Apple Settings style)
 *     not bordered rows. Lighter visual weight, same scan affordance.
 */

type ComponentStatus = "operational" | "idle" | "degraded" | "not configured" | string;


export default function StatusPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

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
  const downCount =
    data?.components.filter(
      (c) =>
        c.status !== "operational" &&
        c.status !== "idle" &&
        c.status !== "not configured",
    ).length ?? 0;

  // Compose hero state (single source of truth for headline + accent).
  let heroState: "loading" | "error" | "ok" | "degraded";
  if (error) heroState = "error";
  else if (!data) heroState = "loading";
  else if (allOk) heroState = "ok";
  else heroState = "degraded";

  return (
    <PageShell maxWidth="max-w-3xl">
      <div className="pt-8 pb-16 md:pt-12">
        {/* ── Hero status ────────────────────────────────────────── */}
        <div className="relative">
          <div className="mb-3 inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
            <span className="h-1 w-1 rounded-full bg-[var(--color-fg-subdued)]" />
            System status · stealthscraper.dev
          </div>

          <h1
            className={cn(
              "text-[40px] font-semibold leading-[1.05] tracking-[-0.025em] sm:text-[52px]",
              heroState === "ok" && "text-[var(--color-fg-display)]",
              heroState === "degraded" && "text-[var(--color-warning)]",
              heroState === "error" && "text-[var(--color-danger,var(--color-warning))]",
              heroState === "loading" && "text-[var(--color-fg-muted)]",
            )}
          >
            {heroState === "ok" && (
              <span className="inline-flex items-center gap-4">
                <HeroDot tone="ok" />
                All systems operational
              </span>
            )}
            {heroState === "degraded" && (
              <span className="inline-flex items-center gap-4">
                <HeroDot tone="warn" />
                Partial degradation
              </span>
            )}
            {heroState === "error" && (
              <span className="inline-flex items-center gap-4">
                <HeroDot tone="warn" />
                Status check failed
              </span>
            )}
            {heroState === "loading" && (
              <span className="inline-flex items-center gap-4 text-[var(--color-fg-muted)]">
                <Loader2 className="h-7 w-7 animate-spin" />
                Checking…
              </span>
            )}
          </h1>

          {/* Metadata strip */}
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] text-[var(--color-fg-subdued)]">
            {heroState === "ok" && data && (
              <>
                <span>v{data.version}</span>
                {data.scrape_engine.proxy_region && (
                  <>
                    <span>·</span>
                    <span>egress {data.scrape_engine.proxy_region}</span>
                  </>
                )}
              </>
            )}
            {heroState === "degraded" && (
              <span className="text-[var(--color-warning)]">
                {downCount} component{downCount === 1 ? "" : "s"} impacted
              </span>
            )}
            {heroState === "error" && error && (
              <span className="text-[var(--color-warning)] max-w-md truncate">
                {error}
              </span>
            )}
            {lastFetched && (
              <>
                <span>·</span>
                <span>refreshed {timeAgo(lastFetched)}</span>
                <span className="text-[var(--color-fg-subdued)]/70">auto · 30s</span>
              </>
            )}
          </div>

          {/* Subtle accent line under the banner — a single design
              gesture that says "this is composed, not stamped." */}
          <div className="mt-10 h-px w-full bg-gradient-to-r from-transparent via-[var(--color-border)] to-transparent" />
        </div>

        {/* ── Components list ────────────────────────────────────── */}
        {data && (
          <div className="mt-10">
            <div className="mb-4 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
              Components
            </div>
            <ul className="divide-y divide-[var(--color-border)]">
              {data.components.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center justify-between gap-4 py-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <RowDot status={c.status} />
                    <span className="text-[14px] text-[var(--color-fg)] truncate">
                      {c.name}
                    </span>
                  </div>
                  <StatusPill status={c.status} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="mt-16 text-center text-[13px] text-[var(--color-fg-muted)]">
          Incidents and maintenance updates on{" "}
          <a
            href="https://x.com/stealthscraper"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-accent)] hover:underline"
          >
            @stealthscraper
          </a>
          . Account-level usage at{" "}
          <Link href="/settings/usage" className="text-[var(--color-accent)] hover:underline">
            settings · usage
          </Link>
          .
        </div>
      </div>
    </PageShell>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────────

/**
 * Hero dot — display-sized, with a soft accent halo + a ping animation
 * on the OK state. Bigger than a row dot; carries enough visual weight
 * to live next to a 52px display heading.
 */
function HeroDot({ tone }: { tone: "ok" | "warn" }) {
  const color =
    tone === "ok" ? "var(--color-accent)" : "var(--color-warning)";
  return (
    <span className="relative inline-flex h-3 w-3">
      <span
        className="absolute inset-0 animate-ping rounded-full opacity-30"
        style={{ background: color }}
      />
      <span
        className="relative h-3 w-3 rounded-full"
        style={{ background: color }}
      />
    </span>
  );
}

/**
 * Row dot — small, static, single-color. Reserves the ping animation
 * for the hero (avoiding the "10 ping animations on one page" Casino-
 * feeling failure mode).
 */
function RowDot({ status }: { status: ComponentStatus }) {
  if (status === "operational") {
    return <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />;
  }
  if (status === "idle" || status === "not configured") {
    return <span className="h-2 w-2 rounded-full bg-[var(--color-fg-subdued)]" />;
  }
  return <span className="h-2 w-2 rounded-full bg-[var(--color-warning)]" />;
}

/**
 * Status pill — mono label with a subtle background. The "data, not
 * decoration" alternative to colored badges. Consistent width via
 * tabular-nums + lowercase status copy.
 */
function StatusPill({ status }: { status: ComponentStatus }) {
  let tone: "ok" | "muted" | "warn" = "ok";
  if (status !== "operational") {
    tone = status === "idle" || status === "not configured" ? "muted" : "warn";
  }
  return (
    <span
      className={cn(
        "font-mono text-[11px] tabular-nums tracking-wide",
        tone === "ok" && "text-[var(--color-accent)]",
        tone === "muted" && "text-[var(--color-fg-subdued)]",
        tone === "warn" && "text-[var(--color-warning)]",
      )}
    >
      {status}
    </span>
  );
}


function timeAgo(d: Date): string {
  const sec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ago`;
}
