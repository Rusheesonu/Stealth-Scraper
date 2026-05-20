"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Top nav — single bar, full-width, sticky. Same on every surface.
 * Auth-aware (subscribes to onAuthStateChange so it updates without reload).
 * Active route is underlined, not coloured — keeps the accent reserved.
 */

const LOGGED_OUT_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/marketplace", label: "Marketplace" },
];

const LOGGED_IN_LINKS = [
  { href: "/pick", label: "Pick" },
  { href: "/ai-extract", label: "AI extract" },
  { href: "/templates", label: "Templates" },
  { href: "/marketplace", label: "Marketplace" },
];

const SETTINGS_LINKS = [
  { href: "/settings/usage", label: "Usage" },
  { href: "/settings/schedules", label: "Schedules" },
  { href: "/settings/api-keys", label: "API keys" },
];

export function Nav() {
  const pathname = usePathname() || "";
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email ?? null);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const links = email ? LOGGED_IN_LINKS : LOGGED_OUT_LINKS;

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_85%,transparent)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" aria-label="Stealth-Scraper home">
            <Brand />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => {
              const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-[13px] tracking-[-0.005em]",
                    "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                    active
                      ? "text-[var(--color-fg-strong)] bg-[var(--color-surface)]"
                      : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)]",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {loading ? (
            <div className="h-7 w-20" />
          ) : email ? (
            <div className="relative">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]",
                  "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)]",
                  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                )}
                aria-haspopup
                aria-expanded={settingsOpen}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                <span className="font-mono">{email}</span>
              </button>
              {settingsOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setSettingsOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-elevated)] shadow-[var(--shadow-popover)]">
                    <div className="border-b border-[var(--color-border)] px-3 py-2.5 text-[11px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                      Account
                    </div>
                    {SETTINGS_LINKS.map((s) => (
                      <Link
                        key={s.href}
                        href={s.href}
                        onClick={() => setSettingsOpen(false)}
                        className="block px-3 py-2 text-[13px] text-[var(--color-fg)] hover:bg-[var(--color-surface)]"
                      >
                        {s.label}
                      </Link>
                    ))}
                    <div className="border-t border-[var(--color-border)]">
                      <Link
                        href="/status"
                        onClick={() => setSettingsOpen(false)}
                        className="block px-3 py-2 text-[13px] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                      >
                        System status
                      </Link>
                      <Link
                        href="/pricing"
                        onClick={() => setSettingsOpen(false)}
                        className="block px-3 py-2 text-[13px] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                      >
                        Pricing
                      </Link>
                      <form action="/auth/signout" method="POST">
                        <button
                          type="submit"
                          className="block w-full px-3 py-2 text-left text-[13px] text-[var(--color-fg-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
                        >
                          Sign out
                        </button>
                      </form>
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 text-[13px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-surface)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
              >
                Sign in
              </Link>
              <Link
                href="/login"
                className="rounded-md bg-[var(--color-fg)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-bg)] hover:bg-[var(--color-fg-strong)] transition-[background] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Footer — narrow, mono, three-zone layout: brand · primary links · external.
 * Same on every page. No marketing fluff.
 */
export function Footer() {
  return (
    <footer className="mt-auto border-t border-[var(--color-border)]">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-6 py-8 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3 text-[11px] text-[var(--color-fg-subdued)]">
          <Brand showText={false} />
          <span className="font-mono">© 2026 Stealth-Scraper</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          <Link href="/pricing" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">Pricing</Link>
          <Link href="/marketplace" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">Marketplace</Link>
          <Link href="/status" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">Status</Link>
          <Link href="/design" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">Design</Link>
          <a href="https://github.com/Rusheesonu/stealth-browser" target="_blank" rel="noreferrer" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            OSS engine
          </a>
          <a href="https://github.com/Rusheesonu/Stealth-Scraper" target="_blank" rel="noreferrer" className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}

/**
 * Standard page shell — nav + content + footer. Use everywhere that's
 * not /pick (which has its own full-bleed canvas).
 */
export function PageShell({
  children,
  className,
  maxWidth = "max-w-7xl",
}: {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className={cn("flex-1", className)}>
        <div className={cn("mx-auto px-6 py-12", maxWidth)}>{children}</div>
      </main>
      <Footer />
    </div>
  );
}
