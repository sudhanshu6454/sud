/**
 * Site identity. NEXT_PUBLIC_SITE_NAME names the deployment (read at runtime,
 * every route renders on demand); the default is the product name. The
 * wordmark in the logo is always the lowercase "afflino" (components/ui/Logo).
 */
export const DEFAULT_SITE_NAME = 'Afflino';

export function siteName(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_NAME;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : DEFAULT_SITE_NAME;
}

/**
 * The public origin of the site, for metadataBase, canonical URLs, og:url,
 * robots.txt and the sitemap. SITE_URL is read at runtime (server only; not
 * NEXT_PUBLIC_, nothing is baked at build); docker-compose.prod.yml passes
 * https://${SITE_HOST:-afflino.com}. Only the origin of an absolute http(s)
 * URL is used; unset or malformed → the production origin, so a mistyped
 * value never canonicalises pages to a host that is not the site.
 */
export const DEFAULT_SITE_URL = 'https://afflino.com';

export function siteUrl(): string {
  const raw = process.env.SITE_URL?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
    } catch {
      // fall through to the default
    }
  }
  return DEFAULT_SITE_URL;
}

/**
 * The indexing gate. SITE_INDEXING=on (server runtime, read per request)
 * opens the site to search engines: robots.txt allows the public pages and
 * names the sitemap, and pages carry no robots meta of their own. Anything
 * else — unset, empty, "off", a typo — is PRE-LAUNCH: robots.txt is
 * `Disallow: /` with no sitemap line, the sitemap lists nothing, and every
 * page carries `<meta name="robots" content="noindex, nofollow">`.
 *
 * Why closed by default: opening a site to search engines is the owner's
 * decision, taken on the server. The figures in lib/site-copy.ts are
 * confirmed (2026-09-29); the terms, privacy and contact pages are still
 * stubs. docker-compose.prod.yml passes ${SITE_INDEXING:-off}.
 */
export function siteIndexing(): boolean {
  return process.env.SITE_INDEXING?.trim().toLowerCase() === 'on';
}
