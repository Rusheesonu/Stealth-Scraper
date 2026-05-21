"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useScroll, useTransform } from "framer-motion";
import { Brand } from "@/components/brand";
import { Popover, MotionFade } from "@/components/motion-primitives";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Top nav — single bar, full-width, sticky. Same on every surface.
 *
 * Apple-style chrome:
 *  • Translucent bar with backdrop blur (matches macOS / iPad nav)
 *  • Scroll-elastic border (transparent at top, hairline once scrolled)
 *  • Active route gets a soft surface fill — accent stays reserved for CTAs
 *  • Settings dropdown uses motion Popover (scale+fade from anchor)
 *
 * Auth-aware (subscribes to onAuthStateChange so it updates without reload).
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

  // Scroll-elastic border — fades in once the user scrolls past 8px.
  // Motion ties hairline opacity to scrollY without re-rendering nav.
  const { scrollY } = useScroll();
  const borderOpacity = useTransform(scrollY, [0, 16], [0, 1]);

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
    <header className="sticky top-0 z-50 bg-blur-bar">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            aria-label="Stealth-Scraper home"
            className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-line)]"
          >
            <Brand />
          </Link>
          <nav className="hidden items-center gap-0.5 md:flex">
            {links.map((l) => {
              const active = pathname === l.href || (l.href !== "/" && pathname.startsWith(l.href));
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "relative rounded-md px-2.5 py-1.5 text-[13px] tracking-[-0.005em]",
                    "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                    active
                      ? "text-[var(--color-fg-strong)]"
                      : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-ink-2)]",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 -z-0 rounded-md bg-[var(--color-ink-2)]"
                      transition={{ type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10">{l.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1.5">
          {loading ? (
            <div className="h-7 w-20" />
          ) : email ? (
            <div className="relative">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px]",
                  "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-ink-2)]",
                  "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]",
                )}
                aria-haspopup
                aria-expanded={settingsOpen}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                <span className="font-mono">{email}</span>
              </button>
              {settingsOpen && (
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setSettingsOpen(false)}
                />
              )}
              <Popover open={settingsOpen} className="w-60">
                <div className="border-b border-[var(--color-border)] px-3 py-2.5">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                    Signed in as
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[12px] text-[var(--color-fg)]">
                    {email}
                  </div>
                </div>
                <div className="py-1">
                  {SETTINGS_LINKS.map((s) => (
                    <Link
                      key={s.href}
                      href={s.href}
                      onClick={() => setSettingsOpen(false)}
                      className="flex items-center px-3 py-1.5 text-[13px] text-[var(--color-fg)] hover:bg-[var(--color-ink-2)]"
                    >
                      {s.label}
                    </Link>
                  ))}
                </div>
                <div className="border-t border-[var(--color-border)] py-1">
                  <Link
                    href="/status"
                    onClick={() => setSettingsOpen(false)}
                    className="block px-3 py-1.5 text-[13px] text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]"
                  >
                    System status
                  </Link>
                  <Link
                    href="/pricing"
                    onClick={() => setSettingsOpen(false)}
                    className="block px-3 py-1.5 text-[13px] text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]"
                  >
                    Pricing
                  </Link>
                  <form action="/auth/signout" method="POST">
                    <button
                      type="submit"
                      className="block w-full px-3 py-1.5 text-left text-[13px] text-[var(--color-fg-muted)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-fg)]"
                    >
                      Sign out
                    </button>
                  </form>
                </div>
              </Popover>
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 text-[13px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-ink-2)] transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)]"
              >
                Sign in
              </Link>
              <Link
                href="/login?mode=signup"
                className="rounded-md bg-[var(--color-fg-strong)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-bg)] hover:bg-[var(--color-fg-display)] transition-[background] duration-[var(--dur-fast)] ease-[var(--ease-out)]"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
      {/* Scroll-elastic hairline — opacity tied to scrollY (no re-render). */}
      <motion.div
        style={{ opacity: borderOpacity }}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--color-border)]"
      />
    </header>
  );
}

/**
 * Footer — four-column trust footer. Brand block on the left, then
 * Product · Open source · Company · Social. Same on every page.
 *
 * Why we expanded from the previous single-row footer: launching on
 * Product Hunt means anyone-can-arrive-anywhere — the footer needs to
 * carry trust signals (Privacy, Terms, Refund) and prove we&apos;re a
 * real OSS-friendly project, not a black box.
 */

type FooterLink = {
  href: string;
  label: string;
  external?: boolean;
};

const FOOTER_COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/marketplace", label: "Marketplace" },
      { href: "/status", label: "Status" },
      { href: "https://github.com/rushikeshsonu/Stealth-Scraper#readme", label: "Docs", external: true },
      { href: "https://github.com/rushikeshsonu/Stealth-Scraper/tree/master/backend#api-reference", label: "API reference", external: true },
    ],
  },
  {
    title: "Open source",
    links: [
      { href: "https://github.com/rushikeshsonu/Stealth-Scraper", label: "GitHub", external: true },
      { href: "https://github.com/rushikeshsonu/Stealth-Scraper/tree/master/oss/stealth-browser", label: "stealth-browser", external: true },
      { href: "https://github.com/rushikeshsonu/Stealth-Scraper/tree/master/oss/mcp-server", label: "MCP server", external: true },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
      { href: "/refund-policy", label: "Refund" },
      { href: "mailto:support@stealthscraper.dev", label: "Contact", external: true },
    ],
  },
  {
    title: "Social",
    links: [
      { href: "https://x.com/rushikeshsonu", label: "X (@rushikeshsonu)", external: true },
      // Discord placeholder — switch to the real invite link once the server is live.
      { href: "#", label: "Discord" },
      { href: "https://news.ycombinator.com/user?id=rushikeshsonu", label: "HN profile", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-auto border-t border-[var(--color-border)]">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-2 md:grid-cols-5">
          {/* Brand block — sits beside the four link columns on md+ */}
          <div className="col-span-2 flex flex-col gap-3 md:col-span-1">
            <Brand />
            <p className="max-w-xs text-[12px] text-[var(--color-fg-muted)]">
              Structured web data for AI agents. Point, click, extract — or
              describe it in plain English.
            </p>
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-subdued)]">
                {col.title}
              </div>
              <ul className="flex flex-col gap-2 text-[12px]">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target={link.href.startsWith("mailto:") ? undefined : "_blank"}
                        rel={link.href.startsWith("mailto:") ? undefined : "noreferrer"}
                        className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:underline"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start gap-3 border-t border-[var(--color-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 text-[11px] text-[var(--color-fg-subdued)]">
            <span className="font-mono">© 2026 Stealth-Scraper · Built in India</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <Link href="/privacy" className="text-[var(--color-fg-subdued)] hover:text-[var(--color-fg-muted)]">Privacy</Link>
            <Link href="/terms" className="text-[var(--color-fg-subdued)] hover:text-[var(--color-fg-muted)]">Terms</Link>
            <Link href="/refund-policy" className="text-[var(--color-fg-subdued)] hover:text-[var(--color-fg-muted)]">Refund</Link>
            <Link href="/design" className="text-[var(--color-fg-subdued)] hover:text-[var(--color-fg-muted)]">Design</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Standard page shell — nav + content + footer. Use everywhere that's
 * not /pick (which has its own full-bleed canvas).
 *
 * Content fades up on mount (per-route reveal). Keyed by pathname so
 * navigating between routes re-fires the entrance — feels like an app,
 * not a website.
 */
export function PageShell({
  children,
  className,
  maxWidth = "max-w-7xl",
  /** Vertical padding tier. `default` = py-10 (settings/lists, app pages);
   *  `flush` = none (landing, marketing — sections handle their own rhythm). */
  vPadding = "default",
}: {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
  vPadding?: "default" | "flush";
}) {
  const pathname = usePathname() || "";
  const vCls = vPadding === "flush" ? "" : "py-10";
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className={cn("flex-1", className)}>
        <MotionFade key={pathname} className={cn("mx-auto px-6", maxWidth, vCls)}>
          {children}
        </MotionFade>
      </main>
      <Footer />
    </div>
  );
}
