import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design system",
  description:
    "The single source of truth for the Stealth-Scraper interface — colors, type, spacing, motion, and component primitives.",
  // Not interesting for SEO — discourage indexing without hiding it from
  // people who actually find the link.
  robots: { index: false, follow: false },
};

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
