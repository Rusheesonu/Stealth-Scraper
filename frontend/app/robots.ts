import type { MetadataRoute } from 'next';

/**
 * robots.txt — generated at build time. Marketing surfaces are open;
 * private routes (api, settings, auth callbacks, the picker workbench)
 * are disallowed to keep them out of search results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/settings/', '/auth/'],
      },
    ],
    sitemap: 'https://stealthscraper.dev/sitemap.xml',
  };
}
