/**
 * Amazon.in Associates — the pure rules shared by the api (link minting, the
 * earnings-report import, the setup CLI), the redirect (the destination's
 * query parameters) and the workers (the product-data refresh). No I/O.
 *
 * Sources are Amazon's own pages as summarised in the policy brief of
 * 2026-09-29 (packages/api/ASSUMPTIONS.md "Amazon.in Associates"): LR =
 * Linking Requirements, PR = Participation Requirements, OA = Operating
 * Agreement.
 */

/** programmes.connector of an Amazon Associates programme. */
export const AMAZON_CONNECTOR = 'amazon-associates';

/** OA: "“Amazon Site” means the www.amazon.in site." The only marketplace this build supports. */
export const AMAZON_IN_MARKETPLACE_HOST = 'www.amazon.in';
export const AMAZON_IN_CURRENCY = 'INR';

/** The Associates ID ("tag") query parameter (LR; help GGXJF6V8XHHJNQBY). */
export const AMAZON_TAG_PARAM = 'tag';

/**
 * Removed from every Amazon destination before the tag is set, so neither a
 * stale tag nor a per-click id can ride along: `tag` (replaced), `ascsubtag`
 * and the platform's own `subid`. No click id is ever put on an Amazon URL:
 * LR — "Under no circumstances may you associate any sub-tag with a specific
 * end user of your site (e.g., you may not dynamically assign sub-tags to
 * users as they arrive on your site …)". A per-click id is exactly that, so
 * no approval makes it allowed; there is no setting that turns it on.
 */
export const AMAZON_STRIPPED_PARAMS: readonly string[] = ['tag', 'ascsubtag', 'subid'];

/**
 * The platforms whose properties may carry Amazon links. Amazon (help
 * G8TW5AE9XL2VX9VM): "We currently only accept the following social
 * networks: Facebook (including open group pages and fan pages, but
 * excluding personal pages), Instagram, Twitter, YouTube, Tik Tok, and
 * Twitch.tv"; websites the Associate owns. Of the in-house network's
 * platforms (db/seed-network.ts: instagram | facebook | youtube | snapchat |
 * telegram | web) the brief builds Facebook, Instagram and the owner's own
 * web property only (§1.8: "allow Amazon offers only on web and declared
 * FB/IG pages"). Snapchat and Telegram are not on Amazon's list and never
 * get an Amazon link. YouTube is on Amazon's list but the owner has listed
 * no channel: adding 'youtube' here (and to the website list) is the whole
 * change when one is.
 */
export const AMAZON_ACCEPTED_PLATFORMS = ['facebook', 'instagram', 'web'] as const;

export function isAmazonAcceptedPlatform(platform: string | null | undefined): boolean {
  return typeof platform === 'string' && (AMAZON_ACCEPTED_PLATFORMS as readonly string[]).includes(platform);
}

/** OA §10, verbatim: the statement every Associate must show. */
export const AMAZON_ASSOCIATE_DISCLOSURE = 'As an Amazon Associate I earn from qualifying purchases.';

/**
 * How long a product-API price (and its availability) may be shown: ONE hour.
 * Two of Amazon's texts differ, and the stricter one is built:
 *   - OA §11: Product Advertising Content that is not an image may be stored
 *     "for caching purposes for up to 24 hours" (AMAZON_OA_CONTENT_MAX_AGE_HOURS);
 *   - the Creators API's best-programming-practices cache table (the
 *     Specifications OA §11 also binds the Associate to): "Offers | 1 hour |
 *     BrowseNodeInfo | 1 hour | All other … 1 day".
 * The conflict is recorded for counsel (docs/counsel-briefing.md §9). The
 * workers refresh hourly, so a listed price is re-fetched about when it expires.
 */
export const AMAZON_PRICE_MAX_AGE_HOURS = 1;

/** OA §11's outer limit for non-image Product Advertising Content (see AMAZON_PRICE_MAX_AGE_HOURS). */
export const AMAZON_OA_CONTENT_MAX_AGE_HOURS = 24;

/**
 * DRAFT PENDING COUNSEL: the link-level label that starts every post of the
 * link sheet (`links.csv` column post_label). Amazon asks for a disclosure
 * "near any affiliate link" ("as simple as "(paid link)", "#ad", or
 * "#CommissionsEarned"", help GPXFHVYZMTGPUMPE) and for no link that makes
 * it "unclear that you are linking to an Amazon Site" (LR). The ASCI wording
 * and the nominative use of "Amazon.in" are counsel's (§9).
 */
export const AMAZON_POST_LABEL = '#ad · Buy on Amazon.in';

/**
 * DRAFT PENDING COUNSEL: the page the redirect serves to link-preview
 * crawlers, prefetches and HEAD requests (packages/redirect). It is what
 * Facebook's and WhatsApp's link cards show under every post, so every
 * "Amazon.in" in it is one of the trademark uses listed for counsel (§9).
 * No tagged URL, no price, no product data.
 */
export const AMAZON_PREVIEW_PAGE = {
  title: 'Afflino link to Amazon.in',
  heading: 'A link to a product on Amazon.in',
  body: 'Open this link in a browser to continue to Amazon.in. Afflino earns from qualifying purchases made through it.',
} as const;

/** The Operating Agreement (programme_capabilities.policy_url). */
export const AMAZON_IN_POLICY_URL = 'https://affiliate-program.amazon.in/help/operating/agreement';

const ASIN_RE = /^[A-Z0-9]{10}$/;

/** A 10-character ASIN (upper-cased), or null. ISBN-10 book ASINs are digits only and pass. */
export function normaliseAsin(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  return ASIN_RE.test(v) ? v : null;
}

/**
 * The only destination form stored in offers.offer_url for an Amazon offer:
 * `https://<host>/dp/<ASIN>`, no query string, no fragment, no tag (the
 * redirect adds the tag per placement).
 */
export function canonicalAmazonUrl(marketplaceHost: string, asin: string): string {
  const a = normaliseAsin(asin);
  if (!a) throw new Error(`canonicalAmazonUrl: '${asin}' is not an ASIN`);
  return `https://${marketplaceHost}/dp/${a}`;
}

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `url` is exactly canonicalAmazonUrl(host, <some ASIN>): https,
 * that host, /dp/<10 upper-case characters>, nothing else (no port, query,
 * fragment, credentials or trailing slash). A plain string match: this
 * package carries no URL parser (it compiles without Node's types).
 */
export function isCanonicalAmazonOfferUrl(url: string, marketplaceHost: string): boolean {
  return new RegExp(`^https://${escapeRe(marketplaceHost)}/dp/[A-Z0-9]{10}$`).test(url);
}

/**
 * The ASIN of an amazon.in product URL: /dp/<ASIN>, /<slug>/dp/<ASIN>,
 * /gp/product/<ASIN>, /gp/aw/d/<ASIN>. The query (and any tag in it) is
 * ignored. Short links (amzn.to, amzn.in, …) are refused: resolving them
 * would mean fetching Amazon's pages, and nothing here fetches or scrapes.
 * The host must be the marketplace's own (www., bare or m.), with no
 * credentials and no port.
 */
export function asinFromAmazonUrl(
  raw: string,
  marketplaceHost: string,
): { ok: true; asin: string } | { ok: false; reason: string } {
  const m = /^(https?):\/\/([^/?#]*)([^?#]*)/i.exec(raw.trim());
  if (!m) return { ok: false, reason: `'${raw}' is not an http(s) URL` };
  const host = (m[2] ?? '').toLowerCase();
  const path = m[3] ?? '';
  const bare = marketplaceHost.replace(/^www\./, '');
  if (host !== marketplaceHost && host !== bare && host !== `m.${bare}`) {
    return {
      ok: false,
      reason: `'${raw}' is not a ${marketplaceHost} product URL (short links are not resolved: nothing here fetches Amazon pages)`,
    };
  }
  const found =
    /(?:^|\/)dp\/([A-Za-z0-9]{10})(?:\/|$)/.exec(path) ??
    /\/gp\/product\/([A-Za-z0-9]{10})(?:\/|$)/.exec(path) ??
    /\/gp\/aw\/d\/([A-Za-z0-9]{10})(?:\/|$)/.exec(path);
  const asin = found ? normaliseAsin(found[1] as string) : null;
  if (!asin) return { ok: false, reason: `no ASIN found in the path of '${raw}' (expected /dp/<ASIN>)` };
  return { ok: true, asin };
}

/**
 * PR 12 / OA §7: no Proprietary Term in an Associates ID. OA §7:
 * "“Proprietary Term” means keywords … that include the word “amazon,”
 * “Kindle,” or any other trademark of Amazon or its affiliates (see a
 * non-exhaustive list of our trademarks)". Refused: amazon / Kindle and
 * their misspellings (brief §1.3), and the marks of that list most likely in
 * an ID (ALEXA, ECHO, PRIME, PRIME VIDEO, AUDIBLE, FIRE TV, IMDb, ZAPPOS,
 * WHOLE FOODS). Amazon's list is NON-EXHAUSTIVE: this is not the whole of
 * it, and the owner checks every ID against Amazon's own list. Deliberately
 * broad (a substring match on the ID without hyphens) — a false refusal
 * costs a rename, a false pass costs the account.
 */
export const AMAZON_PROPRIETARY_TERMS: readonly string[] = [
  'amazon', 'amzn', 'amazn', 'amzon', 'amaz0n', 'amaozn', 'amzaon',
  'kindle', 'kindel', 'kindl', 'kndle',
  'alexa', 'echo', 'prime', 'primevideo', 'audible', 'firetv', 'firestick',
  'imdb', 'zappos', 'wholefoods',
];
const PROPRIETARY_TERMS = AMAZON_PROPRIETARY_TERMS;

/**
 * An amazon.in tracking ID / store ID: lower-case letters, digits and
 * hyphens, ending in "-21" (help GM6CHU93RDXZV7D8: "our software
 * automatically adds "-21" to the end of all Associate IDs"), at most 63
 * characters, and no proprietary term. Returned lower-cased.
 */
export function validateTrackingId(raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const v = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,59})-21$/.test(v)) {
    return {
      ok: false,
      reason: `'${raw}' is not an amazon.in tracking ID (letters, digits and hyphens ending in -21, at most 63 characters)`,
    };
  }
  const stem = v.slice(0, -3).replace(/-/g, '');
  const term = PROPRIETARY_TERMS.find((t) => stem.includes(t));
  if (term) {
    return {
      ok: false,
      reason: `'${raw}' contains '${term}': Amazon forbids its proprietary terms in an Associates ID (PR 12; Amazon's list of its marks is non-exhaustive, check the ID against it)`,
    };
  }
  return { ok: true, value: v };
}

/**
 * How the redirect shapes an Amazon destination (shared by the api's cache
 * warm at mint time and the redirect's DB fallback, so both produce the same
 * route payload).
 */
export interface AmazonRouteParams {
  /** Removed before `set_params` is applied. */
  strip_params: string[];
  /** Set on the destination, replacing any value already there: the tag. */
  set_params: Record<string, string>;
  /** Query param that carries the click id: always null for Amazon (see AMAZON_STRIPPED_PARAMS). */
  subid_field: null;
  /** Automated clients (crawlers, previews, prefetches, HEAD) get the preview page: no click, no tagged URL. */
  crawler_guard: true;
  /** Where the tag came from, for logs and tests. */
  tag_source: 'placement' | 'store_default';
}

export function amazonRouteParams(opts: { storeId: string; placementTrackingId: string | null }): AmazonRouteParams {
  const tag = opts.placementTrackingId ?? opts.storeId;
  return {
    strip_params: [...AMAZON_STRIPPED_PARAMS],
    set_params: { [AMAZON_TAG_PARAM]: tag },
    subid_field: null,
    crawler_guard: true,
    tag_source: opts.placementTrackingId ? 'placement' : 'store_default',
  };
}

/**
 * User agents of software rather than a person: link-preview fetchers,
 * search / SEO crawlers, headless browsers, HTTP libraries and command-line
 * clients. PR 27: "You will not artificially generate clicks or impressions
 * on your site or create Sessions on the Amazon Site, whether by way of a
 * robot or software program or otherwise", so these never get the tagged
 * Amazon redirect (brief §7). A HEURISTIC, for counsel to confirm (§9): named
 * previewers first, then generic tokens (bot / crawl / spider / preview /
 * headless) and common HTTP clients. `(?<!cu)bot` keeps CUBOT phones (a
 * device name in real browsers' user agents) out of the generic token.
 * In-app browsers (Instagram, FBAN/FBAV, …) are real people and are
 * deliberately NOT matched.
 */
export const LINK_PREVIEW_CRAWLER_RE =
  /(facebookexternalhit|facebookcatalog|facebot|meta-externalagent|twitterbot|whatsapp\/|telegrambot|slackbot|linkedinbot|discordbot|googlebot|google-inspectiontool|google-pagerenderer|googleother|adsbot-google|mediapartners-google|feedfetcher|bingbot|bingpreview|pinterest(?:bot)?\/|skypeuripreview|redditbot|applebot|embedly|iframely|vkshare|bitlybot|yandexbot|baiduspider|duckduckbot|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|lighthouse|(?<!cu)bot|crawl|spider|scrap|preview|headless|phantomjs|puppeteer|playwright|selenium|curl\/|wget|python-requests|python-urllib|aiohttp|httpx|go-http-client|okhttp|libwww|java\/|httpclient|axios\/|node-fetch|undici|guzzle|postman)/i;

/**
 * True for software (LINK_PREVIEW_CRAWLER_RE), and for a request with no
 * user agent at all: every browser sends one.
 */
export function isLinkPreviewCrawler(userAgent: string | undefined): boolean {
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return true;
  return LINK_PREVIEW_CRAWLER_RE.test(userAgent);
}

/**
 * A speculative fetch the person did not click: Chrome's `Sec-Purpose:
 * prefetch` / `prefetch;prerender`, the older `Purpose: prefetch`, Safari's
 * `X-Purpose: preview`, Firefox's `X-Moz: prefetch`. Treated like HEAD (the
 * preview page, no click row): PR 25 — Amazon pages may not open "other than
 * as a result of the customer clicking on a Special Link on your site".
 */
export function isSpeculativeRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const v = (name: string) => {
    const h = headers[name];
    return (Array.isArray(h) ? h.join(',') : (h ?? '')).toLowerCase();
  };
  return (
    /prefetch|prerender/.test(v('sec-purpose')) ||
    /prefetch|prerender|preview/.test(v('purpose')) ||
    /prefetch|preview/.test(v('x-purpose')) ||
    /prefetch/.test(v('x-moz'))
  );
}
