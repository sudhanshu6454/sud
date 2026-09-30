import type { MetadataRoute } from 'next';
import { listLooks } from '../lib/catalogue';
import { getPublicSitemap } from '../lib/public-catalogue';
import { celebritySitemapFor, sitemapFor } from '../lib/seo';
import { celebrityIndexing, siteIndexing, siteUrl } from '../lib/site';

// Per request: SITE_URL, SITE_INDEXING and the catalogue are runtime inputs
// (the looks fetch itself is cached for 60 s, lib/catalogue.ts).
export const dynamic = 'force-dynamic';

/**
 * /sitemap.xml: with SITE_INDEXING=on, / and /shop and — only when the
 * catalogue is live — one entry per published look (demo data, i.e. no
 * WEB_API_TOKEN or the API unreachable, contributes no look). Celebrity
 * pages (their looks, hubs, storefronts) only with CELEBRITY_INDEXING=on
 * too, from the public API's sitemap lists (never demo data; not even read
 * otherwise). /shop stays listed either way: while its feed shows a
 * celebrity look and CELEBRITY_INDEXING is off, the page itself says
 * noindex (lib/seo.ts shopMetadata). Pre-launch: an empty urlset, and
 * nothing is read.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!siteIndexing()) return sitemapFor(siteUrl(), [], false);
  const base = siteUrl();
  const celebrity = celebrityIndexing();
  const [{ value: looks, demo }, publicLists] = await Promise.all([listLooks(), celebrity ? getPublicSitemap() : Promise.resolve(null)]);
  return [...sitemapFor(base, demo ? [] : looks, true), ...celebritySitemapFor(base, publicLists, true, celebrity)];
}
