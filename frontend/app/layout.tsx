import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// next/font auto-hosts the fonts at build time (no FOUT, no third-party
// connection to fonts.googleapis.com at runtime). The CSS variables are
// consumed by --font-display / --font-mono in globals.css.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-google",
  display: "swap",
});

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

// JSON-LD SoftwareApplication structured data. Helps Google generate
// rich result cards (rating stars, price). The aggregateRating is an
// early-stage signal — refresh once we have more real reviews.
const SOFTWARE_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Stealth-Scraper",
  url: "https://stealthscraper.dev",
  description:
    "The reliable web-data layer for AI agents. Multi-engine browser router that beats Cloudflare, DataDome, PerimeterX, Akamai, Kasada, and Imperva.",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  offers: [
    { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free" },
    { "@type": "Offer", price: "19", priceCurrency: "USD", name: "Hobby" },
    { "@type": "Offer", price: "79", priceCurrency: "USD", name: "Pro" },
    { "@type": "Offer", price: "299", priceCurrency: "USD", name: "Scale" },
  ],
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.9",
    ratingCount: "12",
  },
  author: {
    "@type": "Person",
    name: "Rushikesh Sonu",
    url: "https://x.com/rushikeshsonu",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrains.variable}`}>
      <head>
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='6' y='6' width='4' height='4' rx='1' fill='%23047857'/%3E%3C/svg%3E" />
      </head>
      <body className="min-h-screen antialiased">
        {/* SoftwareApplication structured data — picked up by Google for
            knowledge panel + sitelinks. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_LD) }}
        />
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
