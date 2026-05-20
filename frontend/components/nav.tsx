"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";

/**
 * Shared top nav. Auth-aware:
 *  - Anonymous: Pricing · GitHub · Sign in (CTA)
 *  - Logged in: Pricing · Templates · Pick · <email> · Sign out
 *
 * Client component so auth state updates immediately on sign-in / sign-out
 * (subscribes to onAuthStateChange).
 */
export function Nav() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
      <Link href="/" aria-label="Stealth-Scraper home">
        <Brand />
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link
          href="/pricing"
          className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          Pricing
        </Link>

        {loading ? (
          // Placeholder to avoid layout shift while session resolves.
          <div className="h-7 w-24" />
        ) : email ? (
          <>
            <Link
              href="/ai-extract"
              className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:text-emerald-200"
            >
              ✨ AI extract
            </Link>
            <Link
              href="/templates"
              className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              Templates
            </Link>
            <Link
              href="/pick"
              className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              Pick
            </Link>
            <Link
              href="/settings/usage"
              className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              Usage
            </Link>
            <Link
              href="/settings/schedules"
              className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              Schedules
            </Link>
            <Link
              href="/settings/api-keys"
              className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              API keys
            </Link>
            <span className="hidden md:inline font-mono text-xs text-[var(--color-muted)]">
              {email}
            </span>
            <form action="/auth/signout" method="POST">
              <button
                type="submit"
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs hover:bg-[var(--color-panel)]"
              >
                Sign out
              </button>
            </form>
          </>
        ) : (
          <>
            <Link
              href="https://github.com/Rusheesonu/Stealth-Scraper"
              target="_blank"
              className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              GitHub
            </Link>
            <Link
              href="/login"
              className="rounded-md bg-[var(--color-accent)] px-4 py-1.5 font-medium text-zinc-900 hover:opacity-90"
            >
              Sign in
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
