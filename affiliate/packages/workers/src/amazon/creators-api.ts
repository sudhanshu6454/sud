/**
 * Amazon Creators API client (the product API that replaced PA-API 5 —
 * policy brief §5; Amazon: "PA-API 5 has been deprecated and is being
 * replaced by the Creators API", PA-API calls now answer 403).
 *
 * What it does and nothing more: GetItems for up to 10 ASINs, returning the
 * buy-box price (exact paise, from the decimal TEXT, never float arithmetic)
 * and availability. No titles or images are requested (the shop shows the
 * operator's own copy; Amazon's images may not be stored or altered), no
 * search, no scraping.
 *
 * Auth (brief §5.3): OAuth 2.0 client credentials. India uses the "EU" row
 * of Amazon's table — credential version 3.2, token endpoint
 * https://api.amazon.co.uk/auth/o2/token, body
 * {"grant_type":"client_credentials","client_id":…,"client_secret":…,"scope":"creatorsapi::default"},
 * `expires_in` 3600 s. API host https://creatorsapi.amazon, POST
 * /catalog/v1/getItems with `Authorization: Bearer`, `x-marketplace` and the
 * required body fields `marketplace` and `partnerTag`. Rate limit: 1 request
 * per second and 8640 per day to start; 429 ThrottleException may carry
 * retryAfterSeconds. An account without the required recent sales gets 403
 * AssociateNotEligible — the integration works without the API (links and
 * conversions do not need it; prices are simply not shown).
 *
 * TO CONFIRM against Amazon's SDK once credentials exist: the `resources`
 * names below and the per-item error shape (the documented examples are
 * US-only and not consistent: `itemsResult` vs `itemResults`; both are read).
 *
 * Credentials come from the environment only (server-side, the workers
 * service): AMAZON_CREATORS_CREDENTIAL_ID / _SECRET / _VERSION. They are
 * never logged.
 */
import { AMAZON_IN_CURRENCY, parseDecimalMinorUnits } from '@paparazzi/shared';

export const DEFAULT_API_BASE = 'https://creatorsapi.amazon';
export const DEFAULT_CREDENTIAL_VERSION = '3.2';
/** Token endpoints by credential version (brief §5.3). Other versions need AMAZON_CREATORS_TOKEN_URL. */
export const TOKEN_URL_BY_VERSION: Readonly<Record<string, string>> = {
  '3.2': 'https://api.amazon.co.uk/auth/o2/token',
};
export const GET_ITEMS_PATH = '/catalog/v1/getItems';
export const MAX_ITEMS_PER_REQUEST = 10;
/** Resource names requested from GetItems (to confirm against the SDK). */
export const GET_ITEMS_RESOURCES = [
  'offersV2.listings.price',
  'offersV2.listings.availability',
  'offersV2.listings.isBuyBoxWinner',
  'offersV2.listings.condition',
] as const;

export interface CreatorsApiConfig {
  credentialId: string;
  credentialSecret: string;
  credentialVersion: string;
  tokenUrl: string;
  apiBase: string;
  /** e.g. www.amazon.in */
  marketplace: string;
  /** The Associates store ID the calls are made under. */
  partnerTag: string;
}

/** Null when the credentials are not configured (the refresh is then a logged no-op). */
export function creatorsApiConfigFromEnv(
  env: NodeJS.ProcessEnv,
  account: { marketplace_host: string; store_id: string },
): CreatorsApiConfig | null {
  const id = env.AMAZON_CREATORS_CREDENTIAL_ID?.trim();
  const secret = env.AMAZON_CREATORS_CREDENTIAL_SECRET?.trim();
  if (!id || !secret) return null;
  const version = env.AMAZON_CREATORS_CREDENTIAL_VERSION?.trim() || DEFAULT_CREDENTIAL_VERSION;
  const tokenUrl = env.AMAZON_CREATORS_TOKEN_URL?.trim() || TOKEN_URL_BY_VERSION[version];
  if (!tokenUrl) {
    throw new Error(
      `AMAZON_CREATORS_CREDENTIAL_VERSION '${version}' has no known token endpoint; set AMAZON_CREATORS_TOKEN_URL`,
    );
  }
  return {
    credentialId: id,
    credentialSecret: secret,
    credentialVersion: version,
    tokenUrl,
    apiBase: (env.AMAZON_CREATORS_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, ''),
    marketplace: account.marketplace_host,
    partnerTag: account.store_id,
  };
}

export interface FetchResponseLike {
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>;

export class CreatorsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;
  constructor(status: number, code: string, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'CreatorsApiError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ItemPrice {
  asin: string;
  /** Exact paise, or null when Amazon gave no usable price (then none is shown). */
  priceMinor: number | null;
  stockStatus: 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown';
}

export interface GetItemsResult {
  items: ItemPrice[];
  /** ASINs Amazon explicitly reported as not accessible / invalid. */
  notAccessible: string[];
}

const STOCK: Readonly<Record<string, ItemPrice['stockStatus']>> = {
  IN_STOCK: 'in_stock',
  OUT_OF_STOCK: 'out_of_stock',
  PREORDER: 'preorder',
};

/**
 * Exact paise from a Creators API money object. `displayAmount` (text, e.g.
 * "₹1,299.50") and `amount` (a JSON number, e.g. 1299.5) must agree; the
 * number is read through its shortest decimal text (String(1299.5) =
 * "1299.5", padded as text to "1299.50"), never multiplied as a float.
 * Anything that does not convert exactly, or another currency → null.
 */
export function exactPriceMinor(money: unknown, currency = AMAZON_IN_CURRENCY): number | null {
  if (!money || typeof money !== 'object') return null;
  const m = money as { amount?: unknown; currency?: unknown; displayAmount?: unknown };
  if (m.currency !== undefined && m.currency !== currency) return null;

  let fromAmount: number | null = null;
  if (typeof m.amount === 'number' && Number.isFinite(m.amount) && m.amount >= 0) {
    const text = String(m.amount);
    const [int, frac = ''] = text.split('.');
    if (frac.length <= 2 && int !== undefined && /^\d+$/.test(int) && /^\d*$/.test(frac)) {
      const r = parseDecimalMinorUnits(frac === '' ? int : `${int}.${frac.padEnd(2, '0')}`);
      fromAmount = r.ok ? r.minor : null;
    }
    if (fromAmount === null) return null;
  } else if (m.amount !== undefined) return null;

  let fromDisplay: number | null = null;
  if (typeof m.displayAmount === 'string') {
    const stripped = m.displayAmount.replace(/^\s*(₹|Rs\.?|INR)\s*/i, '').trim();
    const r = parseDecimalMinorUnits(stripped);
    fromDisplay = r.ok ? r.minor : null;
    if (fromDisplay === null && fromAmount === null) return null;
  }

  if (fromAmount !== null && fromDisplay !== null) return fromAmount === fromDisplay ? fromAmount : null;
  return fromAmount ?? fromDisplay;
}

interface RawListing {
  isBuyBoxWinner?: boolean;
  price?: { money?: unknown } | null;
  availability?: { type?: string } | null;
  condition?: { value?: string } | null;
}

export function parseGetItemsBody(body: unknown, requested: string[], currency = AMAZON_IN_CURRENCY): GetItemsResult {
  const b = (body ?? {}) as {
    itemsResult?: { items?: unknown[] };
    itemResults?: { items?: unknown[] };
    errors?: Array<{ code?: string; message?: string }>;
  };
  const rawItems = b.itemsResult?.items ?? b.itemResults?.items ?? [];
  const items: ItemPrice[] = [];
  for (const raw of rawItems) {
    const it = raw as { asin?: string; offersV2?: { listings?: RawListing[] } };
    if (typeof it.asin !== 'string' || !requested.includes(it.asin)) continue;
    const listings = it.offersV2?.listings ?? [];
    const listing =
      listings.find((l) => l.isBuyBoxWinner === true && (l.condition?.value ?? 'New') === 'New') ??
      listings.find((l) => l.isBuyBoxWinner === true) ??
      listings[0];
    items.push({
      asin: it.asin,
      priceMinor: listing ? exactPriceMinor(listing.price?.money, currency) : null,
      stockStatus: (listing?.availability?.type && STOCK[listing.availability.type]) || 'unknown',
    });
  }
  const notAccessible: string[] = [];
  for (const e of b.errors ?? []) {
    if (!e || !/ItemNotAccessible|InvalidParameterValue/i.test(String(e.code ?? ''))) continue;
    for (const asin of requested) {
      if (String(e.message ?? '').includes(asin) && !items.some((i) => i.asin === asin)) notAccessible.push(asin);
    }
  }
  return { items, notAccessible: [...new Set(notAccessible)] };
}

export class CreatorsApiClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly cfg: CreatorsApiConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly clock: () => number = Date.now,
  ) {}

  private async call(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.status >= 200 && res.status < 300) return json;
    const err = (json ?? {}) as { code?: string; message?: string; retryAfterSeconds?: number; errors?: Array<{ code?: string; message?: string }> };
    const first = err.errors?.[0];
    const code = String(err.code ?? first?.code ?? `HTTP_${res.status}`);
    const message = String(err.message ?? first?.message ?? `HTTP ${res.status}`).slice(0, 300);
    const retry = typeof err.retryAfterSeconds === 'number' ? err.retryAfterSeconds : null;
    throw new CreatorsApiError(res.status, code, message, retry);
  }

  async token(): Promise<string> {
    if (this.accessToken && this.clock() < this.tokenExpiresAt) return this.accessToken;
    const json = (await this.call(
      this.cfg.tokenUrl,
      { 'Content-Type': 'application/json', Accept: 'application/json' },
      {
        grant_type: 'client_credentials',
        client_id: this.cfg.credentialId,
        client_secret: this.cfg.credentialSecret,
        scope: 'creatorsapi::default',
      },
    )) as { access_token?: string; expires_in?: number } | null;
    if (!json?.access_token) throw new CreatorsApiError(502, 'TOKEN_MISSING', 'token endpoint returned no access_token');
    const ttl = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in : 3600;
    this.accessToken = json.access_token;
    // Renew a minute early.
    this.tokenExpiresAt = this.clock() + Math.max(ttl - 60, 30) * 1000;
    return this.accessToken;
  }

  async getItems(asins: string[]): Promise<GetItemsResult> {
    if (asins.length === 0 || asins.length > MAX_ITEMS_PER_REQUEST) {
      throw new Error(`getItems takes 1..${MAX_ITEMS_PER_REQUEST} ASINs`);
    }
    const token = await this.token();
    const json = await this.call(
      `${this.cfg.apiBase}${GET_ITEMS_PATH}`,
      {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-marketplace': this.cfg.marketplace,
      },
      {
        itemIds: asins,
        itemIdType: 'ASIN',
        marketplace: this.cfg.marketplace,
        partnerTag: this.cfg.partnerTag,
        resources: [...GET_ITEMS_RESOURCES],
      },
    );
    return parseGetItemsBody(json, asins);
  }
}
