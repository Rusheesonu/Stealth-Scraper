import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI extract",
  description:
    "Describe what you want in plain English. Stealth-Scraper picks the selectors, runs the snapshot, and returns clean JSON.",
};

export default function AiExtractLayout({ children }: { children: React.ReactNode }) {
  return children;
}
