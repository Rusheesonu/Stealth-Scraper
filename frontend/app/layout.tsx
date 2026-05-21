import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // Title template — child pages set `title: "Pricing"` and we suffix with
  // " · Stealth-Scraper". The plain `default` is used on the root.
  title: {
    default: "Stealth-Scraper — structured web data for AI agents",
    template: "%s · Stealth-Scraper",
  },
  description:
    "Point, click, extract — or describe what you want in plain English. A precision instrument for getting structured data from any website.",
  metadataBase: new URL("https://stealthscraper.dev"),
  openGraph: {
    title: "Stealth-Scraper — structured web data for AI agents",
    description: "Point and click, or describe what you want. Clean JSON from any page.",
    type: "website",
    url: "https://stealthscraper.dev",
    siteName: "Stealth-Scraper",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Stealth-Scraper" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@rushikeshsonu",
    creator: "@rushikeshsonu",
    title: "Stealth-Scraper",
    description: "Structured web data for AI agents. Point, click, extract.",
    images: [{ url: "/opengraph-image", alt: "Stealth-Scraper" }],
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
