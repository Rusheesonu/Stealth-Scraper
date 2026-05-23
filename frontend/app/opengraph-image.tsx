import { ImageResponse } from "next/og";

/**
 * Open Graph image for the root domain. Next.js auto-serves this as
 * /opengraph-image and uses it for social preview cards. 1200×630 is the
 * de-facto standard size for Twitter/X, LinkedIn, Slack, Discord, etc.
 *
 * NOTE: Satori (the renderer under `ImageResponse`) is strict — it does
 * NOT support radial gradients, has limited CSS coverage, and every flex
 * container needs an explicit `display: flex`. An earlier version of this
 * file used `radial-gradient(...)` and returned 0 bytes in prod. Keep
 * this implementation conservative: solid backgrounds, plain text, flex
 * layout, no custom fonts.
 */
export const runtime = "edge";
export const alt = "Stealth-Scraper — the visual scraper for AI agents";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OG() {
  const bg = "#0a0a0a";
  const border = "#262626";
  const muted = "#8a8a8a";
  const strong = "#ededed";
  const accent = "#10b981";

  try {
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
            padding: "72px",
            color: strong,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {/* Top — wordmark */}
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                display: "flex",
                width: 44,
                height: 44,
                borderRadius: 10,
                background: accent,
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              S
            </div>
            <div
              style={{
                display: "flex",
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
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 24,
              maxWidth: 940,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 72,
                fontWeight: 600,
                lineHeight: 1.05,
                letterSpacing: "-0.035em",
                color: strong,
              }}
            >
              The visual scraper for AI agents.
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 28,
                lineHeight: 1.45,
                letterSpacing: "-0.01em",
                color: muted,
                maxWidth: 880,
              }}
            >
              Point, click, save, ship. Clean JSON from any page.
            </div>
          </div>

          {/* Footer — URL + accent dot */}
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
                fontSize: 22,
                color: muted,
              }}
            >
              <div
                style={{
                  display: "flex",
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: accent,
                }}
              />
              <span>stealthscraper.dev</span>
            </div>
          </div>
        </div>
      ),
      { ...size },
    );
  } catch (err) {
    console.error("opengraph-image render failed", err);
    return new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            background: "#0a0a0a",
            color: "#fff",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 64,
          }}
        >
          Stealth-Scraper
        </div>
      ),
      { ...size },
    );
  }
}
