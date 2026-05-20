import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stealth-Scraper — structured web data for AI agents",
  description:
    "Point, click, extract — or describe what you want in plain English. A precision instrument for getting structured data from any website.",
  metadataBase: new URL("https://stealthscraper.dev"),
  openGraph: {
    title: "Stealth-Scraper — structured web data for AI agents",
    description: "Point and click, or describe what you want. Clean JSON from any page.",
    type: "website",
    url: "https://stealthscraper.dev",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stealth-Scraper",
    description: "Structured web data for AI agents. Point, click, extract.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='6' y='6' width='4' height='4' rx='1' fill='%23047857'/%3E%3C/svg%3E" />
      </head>
      <body className="min-h-screen antialiased">
        {/* Theme detection — read preference, set before paint to avoid flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const t = localStorage.getItem('theme'); if (t === 'dark') document.documentElement.dataset.theme = 'dark'; } catch {} })()`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
