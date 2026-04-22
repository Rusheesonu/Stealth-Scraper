import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stealth-Scraper — Visual point-and-click web scraper",
  description:
    "Point, click, extract. Build scraping recipes by clicking on a screenshot of any webpage. No XPath required.",
  openGraph: {
    title: "Stealth-Scraper",
    description: "Visual point-and-click web scraper. No XPath required.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)] antialiased">
        {children}
      </body>
    </html>
  );
}
