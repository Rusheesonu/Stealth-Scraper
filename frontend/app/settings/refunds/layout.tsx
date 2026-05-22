import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Refunds · Stealth-Scraper",
  description: "Reliability SLA refund history — every failed scrape is auto-refunded.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
