import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Three plans, monthly quotas, 14-day refund. Pay only for the pages you scrape — cancel anytime.",
};

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
