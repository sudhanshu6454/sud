import type { MetadataRoute } from 'next';
import { robotsFor } from '../lib/seo';
import { siteIndexing, siteUrl } from '../lib/site';

// SITE_URL and SITE_INDEXING are read per request (runtime env), never frozen at build.
export const dynamic = 'force-dynamic';

/**
 * /robots.txt (lib/seo.ts): with SITE_INDEXING=on the public site is
 * crawlable, the app areas are not, and the sitemap is named; otherwise
 * (pre-launch, the default) `Disallow: /` and no sitemap line.
 */
export default function robots(): MetadataRoute.Robots {
  return robotsFor(siteUrl(), siteIndexing());
}
