import type { MetadataRoute } from 'next';
import { listLooks } from '../lib/catalogue';
import { sitemapFor } from '../lib/seo';
import { siteIndexing, siteUrl } from '../lib/site';

// Per request: SITE_URL, SITE_INDEXING and the catalogue are runtime inputs
// (the looks fetch itself is cached for 60 s, lib/catalogue.ts).
export const dynamic = 'force-dynamic';

/**
 * /sitemap.xml: with SITE_INDEXING=on, /, /shop, /contact and — only when the
 * catalogue is live — one entry per published look (demo data, i.e. no
 * WEB_API_TOKEN or the API unreachable, contributes no look). Pre-launch: an
 * empty urlset, and the catalogue is not even read.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!siteIndexing()) return sitemapFor(siteUrl(), [], false);
  const { value: looks, demo } = await listLooks();
  return sitemapFor(siteUrl(), demo ? [] : looks, true);
}
