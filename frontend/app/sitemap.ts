import type { MetadataRoute } from 'next';

/**
 * Static sitemap. Lists the first-party marketing + product surfaces so
 * search engines can crawl them on launch day.
 *
 * Dynamic marketplace template pages (per-template) are intentionally
 * omitted for launch — the catalog churns daily and we'd rather ship a
 * stable static set than a half-baked dynamic generator. Post-launch we
 * can add `marketplace/[id]` here by querying the API and emitting
 * entries per template.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://stealthscraper.dev';
  const now = new Date();
  return [
    { url: base, changeFrequency: 'daily', priority: 1.0, lastModified: now },
    { url: `${base}/pricing`, changeFrequency: 'weekly', priority: 0.9, lastModified: now },
    { url: `${base}/marketplace`, changeFrequency: 'daily', priority: 0.8, lastModified: now },
    { url: `${base}/ai-extract`, changeFrequency: 'weekly', priority: 0.7, lastModified: now },
    { url: `${base}/launch`, changeFrequency: 'weekly', priority: 0.9, lastModified: now },
    { url: `${base}/privacy`, changeFrequency: 'monthly', priority: 0.3, lastModified: now },
    { url: `${base}/terms`, changeFrequency: 'monthly', priority: 0.3, lastModified: now },
  ];
}
