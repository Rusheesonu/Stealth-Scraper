import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Schedules",
  description: "Recurring scrape jobs — pick a template and a cadence, and let Stealth-Scraper run it for you.",
  robots: { index: false, follow: false },
};

export default function SchedulesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
