import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Marketplace",
  description:
    "Public extraction templates published by the Stealth-Scraper community. Fork any of them in one click and run on your own data.",
};

export default function MarketplaceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
