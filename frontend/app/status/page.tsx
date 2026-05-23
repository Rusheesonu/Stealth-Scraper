import Link from "next/link";
import { PageShell } from "@/components/nav";
import type { StatusResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StatusClientRefresh } from "./client";

/**
 * Status page — server-rendered for SEO + first-paint. The initial
 * verdict (operational / degraded / error) ships in the HTML; the
 * 30-second polling refresh is delegated to a client child component
 * that hydrates with the SSR data as its seed.
 *
 * Design rationale (preserved from the prior client-only version):
 *   1. HERO STATUS — display-sized verdict with a glowing dot
 *   2. METADATA STRIP — version, egress region, last refresh
 *   3. COMPONENT GRID — divide-y list, dot + label + status pill
 */

type ComponentStatus = "operational" | "idle" | "degraded" | "not configured" | string;

export const dynamic = "force-dynamic";

async function fetchStatus(): Promise<{ data: StatusResponse | null; error: string | null }> {
  try {
    const res = await fetch("https://api.stealthscraper.dev/status", {
      cache: "no-store",
      // 5s server-side timeout — don't let a wedged backend stall page render
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { data: null, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as StatusResponse;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export default async function StatusPage() {
  const { data, error } = await fetchStatus();

  const allOk =
    data?.components.every(
      (c) =>
        c.status === "operational" ||
        c.status === "idle" ||
        c.status === "not configured",
    ) ?? false;
  const downCount =
    data?.components.filter(
      (c) =>
        c.status !== "operational" &&
        c.status !== "idle" &&
        c.status !== "not configured",
    ).length ?? 0;

  let heroState: "error" | "ok" | "degraded";
  if (error || !data) heroState = "error";
  else if (allOk) heroState = "ok";
  else heroState = "degraded";

  return (
    <PageShell maxWidth="max-w-3xl">
      <div className="pt-8 pb-16 md:pt-12">
        {/* Hero status */}
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
          </div>

          <div className="mt-10 h-px w-full bg-gradient-to-r from-transparent via-[var(--color-border)] to-transparent" />
        </div>

        {/* Components list */}
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
                    <span className="text-[15px] text-[var(--color-fg)] truncate">
                      {c.name}
                    </span>
                  </div>
                  <StatusPill status={c.status} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Client-side 30s refresh — re-fetches the same endpoint and
            re-renders the verdict + components in place. */}
        <StatusClientRefresh initialData={data} />

        {/* Footer */}
        <div className="mt-16 text-center text-[14px] text-[var(--color-fg-muted)]">
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

function HeroDot({ tone }: { tone: "ok" | "warn" }) {
  const color = tone === "ok" ? "var(--color-accent)" : "var(--color-warning)";
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

function RowDot({ status }: { status: ComponentStatus }) {
  if (status === "operational") {
    return <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />;
  }
  if (status === "idle" || status === "not configured") {
    return <span className="h-2 w-2 rounded-full bg-[var(--color-fg-subdued)]" />;
  }
  return <span className="h-2 w-2 rounded-full bg-[var(--color-warning)]" />;
}

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
