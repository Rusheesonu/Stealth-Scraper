import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "API keys",
  description: "Manage the API keys you use to authenticate Stealth-Scraper from your own services.",
  robots: { index: false, follow: false },
};

export default function ApiKeysLayout({ children }: { children: React.ReactNode }) {
  return children;
}
