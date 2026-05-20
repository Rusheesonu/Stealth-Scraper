import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stealth-Scraper — Visual point-and-click web scraper",
  description:
    "Point, click, extract. Build scraping recipes by clicking on a screenshot of any webpage. No XPath required.",
  metadataBase: new URL("https://stealth-scraper.vercel.app"),
  openGraph: {
    title: "Stealth-Scraper — Visual point-and-click web scraper",
    description:
      "Build scraping recipes by clicking on a screenshot of any webpage. No XPath required.",
    type: "website",
    url: "https://stealth-scraper.vercel.app",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stealth-Scraper",
    description: "Visual point-and-click web scraper. No XPath required.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {/* Theme defaults to dark; user toggle (when shipped) writes
            data-theme="light" on <html>. Suppress hydration warning so
            client-side theme detection doesn't flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const t = localStorage.getItem('theme') || 'dark'; if (t === 'light') document.documentElement.dataset.theme = 'light'; } catch {} })()`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
