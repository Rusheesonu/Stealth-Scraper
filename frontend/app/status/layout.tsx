import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Status",
  description:
    "Realtime system status for the Stealth-Scraper API, picker, and proxy fleet.",
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
