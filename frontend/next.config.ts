import type { NextConfig } from "next";

/**
 * Security headers — applied to every route by Next. Target is an A or
 * better on https://securityheaders.com/?q=stealthscraper.dev. The CSP
 * keeps 'unsafe-inline' / 'unsafe-eval' for scripts because Next inlines
 * the route-tree bootstrap and a few framework runtimes still need eval;
 * tightening further would require a nonce strategy across the whole
 * app, which we'll do post-launch.
 */
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' https://api.stealthscraper.dev https://*.supabase.co; " +
      // frame-src — without this, CSP falls back to default-src 'self'
      // and blocks ALL cross-origin iframes. The landing-hero Arcade
      // product demo loads from *.arcade.software; allow it explicitly.
      // ('This content is blocked' = the symptom when this is missing.)
      "frame-src https://*.arcade.software; " +
      "frame-ancestors 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:8000"}/:path*`,
      },
      // /favicon.ico fallback — Next auto-serves /app/icon.png + /app/apple-icon.png,
      // but legacy clients (Slack unfurls, RSS readers, some browsers) still hit
      // /favicon.ico literally. Route to the same icon to avoid a 404.
      {
        source: "/favicon.ico",
        destination: "/icon.png",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
