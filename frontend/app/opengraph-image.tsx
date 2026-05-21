import { ImageResponse } from "next/og";

/**
 * Open Graph image for the root domain. Next.js auto-serves this as
 * /opengraph-image and uses it for social preview cards. 1200×630 is the
 * de-facto standard size for Twitter/X, LinkedIn, Slack, Discord, etc.
 *
 * Brand chrome only: dark canvas, wordmark, tagline, footer. The 4×4 dot
 * grid (matches /components/brand.tsx) sits next to the wordmark.
 */
export const runtime = "edge";
export const alt = "Stealth-Scraper — the reliable web-data layer for AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG() {
  // Hex colors mirror globals.css `data-theme="dark"` tokens so the OG card
  // reads as a faithful slice of the product UI.
  const bg = "#0a0a0a";
  const surface = "#111111";
  const border = "#262626";
  const muted = "#8a8a8a";
  const strong = "#ededed";
  const accent = "#10b981";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: bg,
          backgroundImage: `radial-gradient(circle at 1px 1px, ${border} 1px, transparent 0)`,
          backgroundSize: "32px 32px",
          padding: "72px",
          color: strong,
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Top — wordmark with the 4x4 dot grid */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gridTemplateRows: "repeat(3, 1fr)",
              gap: 4,
              width: 44,
              height: 44,
            }}
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  background: i === 4 ? accent : `${muted}40`,
                }}
              />
            ))}
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: strong,
            }}
          >
            Stealth-Scraper
          </div>
        </div>

        {/* Middle — headline + supporting line */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 940 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              color: strong,
            }}
          >
            The reliable web-data layer for AI agents.
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.45,
              letterSpacing: "-0.01em",
              color: muted,
              maxWidth: 880,
            }}
          >
            Point, click, extract — or describe what you want in plain English.
            Clean JSON from any website.
          </div>
        </div>

        {/* Footer — surface card with the URL + accent dot */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid ${border}`,
            paddingTop: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 22,
              color: muted,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: accent,
              }}
            />
            stealthscraper.dev
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 20,
              color: muted,
              background: surface,
              border: `1px solid ${border}`,
              borderRadius: 10,
              padding: "10px 18px",
            }}
          >
            $ curl stealthscraper.dev/api/extract
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
