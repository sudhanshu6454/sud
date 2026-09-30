/**
 * Search and sharing metadata: the root metadata (metadataBase, Open Graph,
 * Twitter card, the pre-launch robots meta), per-page canonical + og:url,
 * robots.txt and the sitemap. Pure functions of SITE_URL, SITE_INDEXING and
 * NEXT_PUBLIC_SITE_NAME (lib/site.ts) and the copy in lib/site-copy.ts, so
 * they are unit-tested without Next (test/seo.test.ts); app/layout.tsx,
 * app/robots.ts, app/sitemap.ts and the marketing and shop pages call them.
 *
 * Relative URLs below resolve against metadataBase (the SITE_URL origin).
 */
import type { Metadata, MetadataRoute } from 'next';
import { celebrityIndexing, siteIndexing, siteName, siteUrl } from './site';
import { SITE_DESCRIPTION } from './site-copy';

/** The share image: the PWA icon (the only site image there is). */
export const OG_IMAGE_PATH = '/icons/icon-512.png';
export const OG_LOCALE = 'en_IN';

function shareTitle(title?: string): string {
  const name = siteName();
  return title ? `${title} · ${name}` : name;
}

function openGraphFor(path: string, title?: string): NonNullable<Metadata['openGraph']> {
  const name = siteName();
  return {
    siteName: name,
    type: 'website',
    locale: OG_LOCALE,
    url: path,
    title: shareTitle(title),
    description: SITE_DESCRIPTION,
    images: [{ url: OG_IMAGE_PATH, width: 512, height: 512, alt: name }],
  };
}

function twitterFor(title?: string): NonNullable<Metadata['twitter']> {
  return {
    card: 'summary',
    title: shareTitle(title),
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE_PATH],
  };
}

/**
 * The robots meta every page inherits before launch (SITE_INDEXING not "on").
 * Next merges metadata shallowly, so a page that sets its own `robots` (the
 * app areas, /join, /login, /dev: all noindex already) replaces it, and a page
 * that sets none — every public page — inherits it.
 */
export const PRE_LAUNCH_ROBOTS = { index: false, follow: false } as const;

/**
 * Root layout metadata. Pages without their own openGraph inherit og:url "/".
 * `indexing` defaults to SITE_INDEXING (lib/site.ts).
 */
export function rootMetadata(indexing: boolean = siteIndexing()): Metadata {
  const name = siteName();
  return {
    ...(indexing ? {} : { robots: { ...PRE_LAUNCH_ROBOTS } }),
    metadataBase: new URL(siteUrl()),
    title: { default: name, template: `%s · ${name}` },
    description: SITE_DESCRIPTION,
    applicationName: name,
    appleWebApp: { capable: true, title: name, statusBarStyle: 'default' },
    formatDetection: { telephone: false },
    openGraph: openGraphFor('/'),
    twitter: twitterFor(),
  };
}

/**
 * A public page's metadata: its title (the root template appends the site
 * name), `<link rel="canonical">` and og:url on `path`, and the full Open
 * Graph / Twitter blocks (Next replaces, not merges, a parent's openGraph).
 * `path` is the page's own path, already URL-encoded.
 */
export function pageMetadata(path: string, title?: string): Metadata {
  return {
    ...(title ? { title } : {}),
    alternates: { canonical: path },
    openGraph: openGraphFor(path, title),
    twitter: twitterFor(title),
  };
}

/**
 * Areas that are not for search: the signed-in apps, onboarding, sign-in,
 * the API proxy, the dev gallery and the per-browser wishlist. They also
 * carry `robots: noindex` in their layouts where they render HTML.
 */
export const ROBOTS_DISALLOW = ['/app', '/brand', '/agency', '/admin', '/join', '/login', '/api', '/dev', '/saved'] as const;

/**
 * The tracked links, /r/{token}: served on the same host by the redirect
 * service (not a web route; the redirect also answers X-Robots-Tag: noindex).
 * No crawler should follow one: an Amazon.in link would create a Session on
 * the Amazon Site "by way of a robot" (Participation Requirements 27), and
 * Amazon excludes fees for Redirecting Links shown in organic search (OA §7).
 */
export const ROBOTS_DISALLOW_TRACKED_LINKS = '/r/';

/**
 * robots.txt. Open (`indexing`): the public site is allowed, the areas above
 * are not, and the sitemap is named. Pre-launch: `Disallow: /` for every
 * crawler and no sitemap line.
 */
export function robotsFor(base: string, indexing: boolean): MetadataRoute.Robots {
  if (!indexing) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [
      {
        userAgent: '*',
        // "/app" is a prefix and would also match /apple-icon.png; the longer
        // Allow wins (RFC 9309 §2.2.2, longest match).
        allow: ['/', '/apple-icon.png'],
        disallow: [...ROBOTS_DISALLOW, ROBOTS_DISALLOW_TRACKED_LINKS],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}

/**
 * Pages in the sitemap: the home page and the shop. /contact, /terms and
 * /privacy stay out while they are stubs ("will be published with the
 * launch", "being prepared"); add each here when it has content.
 */
export const SITEMAP_PATHS = ['/', '/shop'] as const;

/**
 * TEST-labelled catalogue rows (CLAUDE.md invariant 11): the network seed's
 * `--with-demo-programme` looks are titled "Demo look — <property>", and every
 * other TEST row starts with "Demo" too. They are served by the live API, so
 * the live/demo split alone would list them; the sitemap leaves them out.
 * Conservative: a real look whose title starts with the word "Demo" is merely
 * not listed.
 */
export function isTestLabelledTitle(title: string): boolean {
  return /^demo\b/i.test(title.trim());
}

/** The robots meta of a page that must never be indexed (see shopDetailMetadata). */
export const NOT_FOR_INDEX_ROBOTS = { index: false, follow: false } as const;

/**
 * A look or item page's metadata: pageMetadata plus `noindex, nofollow` when
 * the page shows TEST data — the web's own demo looks (`demo`: no
 * WEB_API_TOKEN, or the API unreachable) or a TEST-labelled look from the
 * live catalogue (`isTestLabelledTitle` on the look's or the item's title).
 * The sitemap already leaves them out, but /shop links to every look, so
 * without this a crawler would still find and index them once
 * SITE_INDEXING=on.
 */
export function shopDetailMetadata(
  path: string,
  title: string,
  opts: { demo: boolean; lookTitle: string },
): Metadata {
  const meta = pageMetadata(path, title);
  const testData = opts.demo || isTestLabelledTitle(opts.lookTitle) || isTestLabelledTitle(title);
  return testData ? { ...meta, robots: { ...NOT_FOR_INDEX_ROBOTS } } : meta;
}

/**
 * The sitemap: SITEMAP_PATHS plus one entry per live look. `looks` must be
 * the LIVE catalogue — the caller passes [] when the catalogue is demo data
 * (no WEB_API_TOKEN, or the API unreachable), so no demo look is ever listed —
 * and TEST-labelled looks (`isTestLabelledTitle`) are dropped here.
 * Pre-launch (`indexing` false) it lists nothing: an empty urlset, so no URL
 * is advertised even to a crawler that fetches /sitemap.xml directly.
 */
export function sitemapFor(
  base: string,
  looks: ReadonlyArray<{ id: string; title: string; publishedAt: string | null }>,
  indexing: boolean,
): MetadataRoute.Sitemap {
  if (!indexing) return [];
  const pages: MetadataRoute.Sitemap = SITEMAP_PATHS.map((path) => ({
    url: path === '/' ? `${base}/` : `${base}${path}`,
  }));
  const lookPages: MetadataRoute.Sitemap = looks.filter((look) => !isTestLabelledTitle(look.title)).map((look) => {
    const published = look.publishedAt ? new Date(look.publishedAt) : null;
    return {
      url: `${base}/looks/${encodeURIComponent(look.id)}`,
      ...(published && !Number.isNaN(published.getTime()) ? { lastModified: published.toISOString() } : {}),
    };
  });
  return [...pages, ...lookPages];
}

/**
 * A page about a celebrity (a look of the Spotted feed, a hub, a storefront):
 * pageMetadata, with the non-endorsement line as the share description
 * (og:description / twitter:description), so a link preview that names the
 * celebrity carries it too; the share image stays the site icon — a preview
 * never shows the celebrity's still. `noindex, nofollow` unless both
 * SITE_INDEXING and CELEBRITY_INDEXING are on, and always for demo data.
 */
export function celebrityPageMetadata(
  path: string,
  title: string,
  description: string,
  opts: { demo: boolean; indexing?: boolean; celebrityIndexing?: boolean },
): Metadata {
  const meta = pageMetadata(path, title);
  const og = { ...(meta.openGraph ?? {}), description };
  const tw = { ...(meta.twitter ?? {}), description };
  const open = (opts.indexing ?? siteIndexing()) && (opts.celebrityIndexing ?? celebrityIndexing()) && !opts.demo;
  return {
    ...meta,
    description,
    openGraph: og,
    twitter: tw,
    ...(open ? {} : { robots: { ...NOT_FOR_INDEX_ROBOTS } }),
  };
}

/** /shop's metadata: noindex while its Spotted feed shows a celebrity look and CELEBRITY_INDEXING is off. */
export function shopMetadata(opts: { celebrityContent: boolean; celebrityIndexing?: boolean }): Metadata {
  const meta = pageMetadata('/shop', 'Spotted');
  const allowed = opts.celebrityIndexing ?? celebrityIndexing();
  return opts.celebrityContent && !allowed ? { ...meta, robots: { ...NOT_FOR_INDEX_ROBOTS } } : meta;
}

/** Celebrity pages for the sitemap (from GET /v1/public/<org>/sitemap; never demo data). */
export interface CelebritySitemapInput {
  looks: ReadonlyArray<{ id: string; updated_at: string | null }>;
  celebrities: ReadonlyArray<string>;
  storefronts: ReadonlyArray<string>;
}

/**
 * The sitemap entries for celebrity pages: none unless SITE_INDEXING and
 * CELEBRITY_INDEXING are both on. The public API has already left out
 * everything that is not public now (unreviewed, blocked, minors,
 * never-listed, under takedown).
 */
export function celebritySitemapFor(base: string, input: CelebritySitemapInput | null, indexing: boolean, celebrity: boolean): MetadataRoute.Sitemap {
  if (!indexing || !celebrity || !input) return [];
  const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const looks = input.looks
    .filter((l) => uuid.test(l.id))
    .map((l) => {
      const t = l.updated_at ? new Date(l.updated_at) : null;
      return { url: `${base}/looks/${l.id}`, ...(t && !Number.isNaN(t.getTime()) ? { lastModified: t.toISOString() } : {}) };
    });
  const hubs = input.celebrities.filter((s) => slug.test(s)).map((s) => ({ url: `${base}/c/${s}` }));
  const fronts = input.storefronts.filter((s) => slug.test(s)).map((s) => ({ url: `${base}/s/${s}` }));
  return [...looks, ...hubs, ...fronts];
}
