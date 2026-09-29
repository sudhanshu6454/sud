/**
 * Tracked-link rules for the creator app: offer browser (1d), offer detail /
 * get link (1e) and the link generator + "My links" (3c).
 *
 * - composeDemoLink: the design's readable link format
 *   (afflino.com/r/{handle}/{offer}?s={sub-id}). DEMO ONLY: the platform
 *   mints /r/{32-hex token} (packages/redirect sets no cookies and resolves
 *   no handles); a live link always shows the URL POST /v1/links returns.
 * - validateLandingPage: the page must be on one of the offer's allowed
 *   hosts, matched exactly as the API matches an offer destination against
 *   the programme's allowed_domains. Sub-IDs use validateSubId
 *   (lib/validators.ts: a–z, 0–9, hyphen, ≤32).
 * - parsePayout / estimatedPayoutMinor / sortOffers: "Sort: Highest payout".
 *   A flat payout is worth its amount; a percentage payout is worth
 *   percent × the offer's reference order value when it has one. Offers
 *   with no rupee estimate rank after every offer that has one (by percent),
 *   and ties keep their listed order.
 * - mintLiveLink: POST /v1/links (the live path of the restored LinkBuilder,
 *   unchanged): the API composes the URL; an unreachable API (network
 *   failure, or the /api proxy's 502 UPSTREAM_UNAVAILABLE) yields a
 *   labelled, untracked demo URL on the RFC 2606 host redirect.demo.invalid;
 *   guard errors map through linkErrorMessage().
 * - qrFileName: the downloaded QR's file name. The QR itself (qrMatrix /
 *   qrPng) is in lib/qr.ts, imported only by the Download QR action, so the
 *   pages that list or sort offers do not ship the QR generator.
 *
 * Relative imports only (vitest has no @/ alias).
 */

import { ApiError, apiFetch, linkErrorMessage, type CreateLinkBody, type CreateLinkResponse } from './api';
import type { OfferPayout } from './format';
import { validateSubId, type ValidationResult } from './validators';

/* ---------- demo link composition ---------- */

/** Host of the design's readable demo links. Never a minted link. */
export const DEMO_LINK_HOST = 'afflino.com';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface DemoLinkParts {
  /** Creator handle slug ("demo-priya"). */
  handle: string;
  /** Offer slug ("demo-style"). */
  offerSlug: string;
  /** Optional sub-ID; must pass validateSubId. */
  subId?: string;
}

/**
 * "afflino.com/r/demo-priya/demo-style?s=short-diwali-02" (no scheme, as
 * drawn). Throws on a malformed handle, offer slug or sub-ID: validate the
 * sub-ID with validateSubId() first.
 */
export function composeDemoLink({ handle, offerSlug, subId }: DemoLinkParts): string {
  if (!SLUG.test(handle)) throw new Error(`composeDemoLink: bad handle "${handle}"`);
  if (!SLUG.test(offerSlug)) throw new Error(`composeDemoLink: bad offer slug "${offerSlug}"`);
  const sub = validateSubId(subId ?? '');
  if (!sub.ok) throw new Error(`composeDemoLink: ${sub.message}`);
  return `${DEMO_LINK_HOST}/r/${handle}/${offerSlug}${sub.value ? `?s=${sub.value}` : ''}`;
}

/**
 * The RFC 2606 reserved host a demo link's payload uses (Copy link,
 * Download QR, Share). The readable afflino.com/r/{handle}/{offer} format is
 * only drawn, not implemented (the platform mints /r/{32-hex}), so what a
 * creator copies from a demo link must never be a working-looking URL on a
 * public domain; like the offline fallback's redirect.demo.invalid, it
 * cannot resolve.
 */
export const DEMO_LINK_PAYLOAD_HOST = 'afflino.demo.invalid';

/** "afflino.com/r/demo-priya/demo-style?s=…" → "https://afflino.demo.invalid/r/demo-priya/demo-style?s=…". */
export function demoLinkHref(display: string): string {
  const prefix = `${DEMO_LINK_HOST}/`;
  const bare = display.replace(/^https?:\/\//i, '');
  if (!bare.startsWith(prefix)) throw new Error(`demoLinkHref: not a demo link "${display}"`);
  return `https://${DEMO_LINK_PAYLOAD_HOST}/${bare.slice(prefix.length)}`;
}

/** The clickable / copyable form of a displayed link: adds https:// when the display drops the scheme. */
export function linkHref(display: string): string {
  return /^https?:\/\//i.test(display) ? display : `https://${display}`;
}

/* ---------- landing page ---------- */

const pass = (value: string): ValidationResult => ({ ok: true, message: '', value });
const fail = (message: string): ValidationResult => ({ ok: false, message });

/** Exact, case-insensitive host match (a trailing dot ignored). */
export function hostAllowed(host: string, allowedDomains: ReadonlyArray<string>): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  return h !== '' && allowedDomains.some((d) => d.trim().toLowerCase().replace(/\.$/, '') === h);
}

function domainList(allowedDomains: ReadonlyArray<string>): string {
  if (allowedDomains.length <= 1) return allowedDomains[0] ?? 'an allowed domain';
  return `${allowedDomains.slice(0, -1).join(', ')} or ${allowedDomains[allowedDomains.length - 1]}`;
}

/**
 * Landing page for a tracked link: an http(s) page on one of the offer's
 * allowed hosts. Accepts "shop.example.com/diwali-sale" (https:// assumed),
 * "https://shop.example.com/…" and "//shop.example.com/…". Rejects other
 * schemes (javascript:, mailto:, data:), credentials in the URL, whitespace
 * and any other host (including look-alikes such as
 * shop.example.com.evil.test). Normalised to the full URL.
 */
export function validateLandingPage(input: string, allowedDomains: ReadonlyArray<string>): ValidationResult {
  const raw = input.trim();
  if (raw === '') return fail('Enter the landing page.');
  if (/\s/.test(raw)) return fail('A web address has no spaces.');

  let candidate: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (!/^https?:\/\//i.test(raw)) return fail('Use a web page address (https://…).');
    candidate = raw;
  } else if (raw.startsWith('//')) {
    candidate = `https:${raw}`;
  } else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw)) {
    // "javascript:…", "mailto:…" — a scheme, not "host:port".
    return fail('Use a web page address (https://…).');
  } else {
    candidate = `https://${raw}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fail('That is not a web address.');
  }
  if (url.username || url.password) return fail('A landing page cannot contain a user name or password.');
  if (!hostAllowed(url.hostname, allowedDomains)) {
    return fail(`Use a page on ${domainList(allowedDomains)} — the brand only accepts traffic there.`);
  }
  return pass(url.toString());
}

/* ---------- payouts: parse, estimate, sort ---------- */

/**
 * Parse a payout as the design prints it: "₹180 / sign-up", "₹1,250 / lead",
 * "₹6.50 / click", "12% / sale", "4.5% / booking" ("per" also accepted in
 * place of "/"). Rupees become integer paise without floating point.
 * Returns null for anything else. Inverse of formatPayout() (lib/format.ts)
 * for whole-rupee amounts.
 */
export function parsePayout(text: string): OfferPayout | null {
  const m = /^\s*(?:₹\s*(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d{1,2}))?|(\d+(?:\.\d+)?)\s*%)\s*(?:\/|per\b)\s*([a-z][a-z-]*(?: [a-z-]+)*)\s*$/i.exec(
    text,
  );
  if (!m) return null;
  const per = m[4]!.toLowerCase();
  if (m[1] !== undefined) {
    const digits = m[1].replace(/,/g, '');
    const paise = (m[2] ?? '').padEnd(2, '0');
    return { type: 'flat', amountMinor: Number(digits) * 100 + Number(paise), per };
  }
  const percent = Number(m[3]);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  return { type: 'percent', percent, per };
}

/**
 * Rupee value of one conversion, minor units: a flat payout's amount, or
 * percent × typicalOrderMinor for a percentage payout (rounded to the
 * paisa). null when a percentage offer has no reference order value.
 */
export function estimatedPayoutMinor(payout: OfferPayout, typicalOrderMinor?: number): number | null {
  if (payout.type === 'flat') return payout.amountMinor;
  if (typicalOrderMinor === undefined || !Number.isFinite(typicalOrderMinor) || typicalOrderMinor <= 0) return null;
  return Math.round((typicalOrderMinor * payout.percent) / 100);
}

export type OfferSort = 'payout-desc' | 'payout-asc' | 'name';

export const OFFER_SORTS: ReadonlyArray<{ value: OfferSort; label: string }> = [
  { value: 'payout-desc', label: 'Highest payout' },
  { value: 'payout-asc', label: 'Lowest payout' },
  { value: 'name', label: 'Brand A–Z' },
];

export interface SortableOffer {
  name: string;
  payout: OfferPayout;
  typicalOrderMinor?: number;
}

/**
 * Sort offers (a new array; stable, so ties keep their order).
 * payout-desc / payout-asc: by estimatedPayoutMinor; offers without an
 * estimate always come after the ones with one, ordered by percent (highest
 * first for payout-desc, lowest first for payout-asc). name: A–Z.
 */
export function sortOffers<T extends SortableOffer>(offers: ReadonlyArray<T>, sort: OfferSort): T[] {
  const list = offers.map((offer, index) => ({ offer, index, value: estimatedPayoutMinor(offer.payout, offer.typicalOrderMinor) }));
  const dir = sort === 'payout-asc' ? 1 : -1;
  list.sort((a, b) => {
    if (sort === 'name') {
      return a.offer.name.localeCompare(b.offer.name, 'en-IN', { sensitivity: 'base' }) || a.index - b.index;
    }
    if (a.value !== null && b.value !== null) return (a.value - b.value) * dir || a.index - b.index;
    if (a.value !== null) return -1;
    if (b.value !== null) return 1;
    const pa = a.offer.payout.type === 'percent' ? a.offer.payout.percent : 0;
    const pb = b.offer.payout.type === 'percent' ? b.offer.payout.percent : 0;
    return (pa - pb) * dir || a.index - b.index;
  });
  return list.map((entry) => entry.offer);
}

export interface FilterableOffer {
  name: string;
  category: string;
  model: string;
}

/**
 * The 1d search + category filter. The query matches brand name, category
 * and model (case-insensitive; every word must match somewhere); category
 * null means "All".
 */
export function filterOffers<T extends FilterableOffer>(
  offers: ReadonlyArray<T>,
  { query = '', category = null }: { query?: string; category?: string | null } = {},
): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return offers.filter((offer) => {
    if (category !== null && offer.category !== category) return false;
    if (words.length === 0) return true;
    const haystack = `${offer.name} ${offer.category} ${offer.model}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/** "My links" filter: every word must appear in the offer, URL, sub-ID, platform or status. */
export function filterLinks<T extends { offer: string; url: string; subId?: string; platformName?: string; status: string }>(
  links: ReadonlyArray<T>,
  query: string,
): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...links];
  return links.filter((link) => {
    const haystack = `${link.offer} ${link.url} ${link.subId ?? ''} ${link.platformName ?? ''} ${link.status}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/* ---------- live minting (POST /v1/links) ---------- */

export type MintResult =
  /** Minted by the API: the tracked /r/{token} URL it composed. */
  | { kind: 'live'; url: string; token: string }
  /** API unreachable: a labelled, UNTRACKED demo URL (earns nothing). */
  | { kind: 'fallback'; url: string; token: string }
  /** The API refused (guard error) or failed. */
  | { kind: 'error'; code: string; message: string };

/** Host of the offline demo mint (RFC 2606 .invalid: it can never resolve). */
export const FALLBACK_REDIRECT_BASE = 'https://redirect.demo.invalid/r/';

function randomDemoToken(): string {
  return `demo-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One of the four ids for POST /v1/links, typed or pasted (there is no
 * listing endpoint): a uuid, stored lower-case. `what` names it in the
 * message ("property id").
 */
export function validateUuid(input: string, what: string): ValidationResult {
  const raw = input.trim();
  if (raw === '') return fail(`Enter the ${what}.`);
  if (!UUID.test(raw)) return fail(`That is not a uuid: the ${what} has 32 hex digits in groups of 8-4-4-4-12.`);
  return pass(raw.toLowerCase());
}

/** localStorage key for the last ids the live mint form used (this browser only). */
export const LIVE_MINT_IDS_KEY = 'afflino_live_mint_ids_v1';

/**
 * POST /v1/links with the four ids. Never rebuilds the URL: a live result
 * carries exactly the `url` the API returned. `idempotencyKey` (one per
 * unchanged payload, lib/idempotency.ts) makes a retry after a timeout
 * replay the first answer instead of minting a second link.
 */
export async function mintLiveLink(
  body: CreateLinkBody,
  deps: { fetcher?: typeof apiFetch; demoToken?: () => string; idempotencyKey?: string } = {},
): Promise<MintResult> {
  const fetcher = deps.fetcher ?? apiFetch;
  try {
    const data = await fetcher<CreateLinkResponse>('/v1/links', {
      method: 'POST',
      body,
      ...(deps.idempotencyKey ? { headers: { 'Idempotency-Key': deps.idempotencyKey } } : {}),
    });
    if (!data || typeof data.url !== 'string' || data.url === '') {
      return { kind: 'error', code: 'INTERNAL', message: 'link creation failed — the API returned no URL' };
    }
    return { kind: 'live', url: data.url, token: data.token };
  } catch (err) {
    if (err instanceof ApiError) {
      // Unreachable: the browser could not reach the API (NETWORK_UNREACHABLE), or the
      // same-origin /api proxy could not (502 UPSTREAM_UNAVAILABLE, app/api/[...path]).
      if (err.code === 'NETWORK_UNREACHABLE' || err.code === 'UPSTREAM_UNAVAILABLE') {
        const token = (deps.demoToken ?? randomDemoToken)();
        return { kind: 'fallback', url: `${FALLBACK_REDIRECT_BASE}${token}`, token };
      }
      return { kind: 'error', code: err.code, message: linkErrorMessage(err.code) };
    }
    return { kind: 'error', code: 'INTERNAL', message: 'Link creation failed — unexpected error.' };
  }
}

/** File name for a downloaded QR: "afflino-qr-demo-style-short-diwali-02.png". */
export function qrFileName(...parts: ReadonlyArray<string | undefined>): string {
  const slug = parts
    .filter((p): p is string => Boolean(p))
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `afflino-qr${slug ? `-${slug}` : ''}.png`;
}
