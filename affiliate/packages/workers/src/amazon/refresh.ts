/**
 * Amazon offer refresh — applies the price age limit quoted from Amazon's
 * texts (1 hour: the Creators API's "Offers | 1 hour", stricter than OA
 * §11's 24 hours; AMAZON_PRICE_MAX_AGE_HOURS) and keeps everything else
 * working without prices. Not a compliance claim.
 *
 * Every run (hourly by default, AMAZON_REFRESH_CRON on the feeds queue):
 *   1. EXPIRE: every Amazon offer whose price is older than
 *      AMAZON_PRICE_MAX_AGE_HOURS loses it (price_minor, price_as_of →
 *      NULL). This runs with or without API credentials.
 *   2. REFRESH (only with credentials, per active account not paused, see
 *      below): GetItems in batches of 10, oldest price first, at most
 *      AMAZON_REFRESH_MAX_REQUESTS requests per run (300 × 24 runs = 7200 <
 *      the 8640 a day Amazon starts an account with, for its first 30 days
 *      only: docs/capacity-plan.md) and at least 1.1 s apart (1 request per
 *      second). An item Amazon returns: price_minor + price_as_of = now +
 *      stock_status, and fresh_until pushed to now + AMAZON_OFFER_TTL_DAYS
 *      (the listing still exists). An item Amazon returns without a usable
 *      price, or does not return: no price. An item Amazon explicitly
 *      reports as not accessible: offer status 'stale' with stale_reason
 *      'merchant_not_accessible' (its links serve the paused page; re-listing
 *      it with the offers CLI keeps it stale unless --reactivate); such an
 *      offer is asked again on later runs and becomes 'active' again when
 *      Amazon returns the item.
 *   3. BACK OFF: a 429 ThrottleException pauses the account's refresh
 *      (amazon_associates_accounts.api_paused_until) for retryAfterSeconds
 *      when Amazon gives it, else until the next UTC day (an exhausted daily
 *      allowance: Amazon does not say when its day starts); a 401 / 403
 *      (e.g. AssociateNotEligible: too few recent sales; access returns
 *      "within two days after your referred sales are shipped") pauses it
 *      until the next UTC day. Other failures stop this run only. Meanwhile
 *      the prices age out — links and conversions do not depend on the API.
 *
 * Workers carry no tenantQuery: every statement names its org_id, and the
 * accounts are iterated one by one (as the retention purge iterates orgs).
 */
import type { Pool } from 'pg';
import { AMAZON_PRICE_MAX_AGE_HOURS } from '@paparazzi/shared';
import { CreatorsApiError, MAX_ITEMS_PER_REQUEST, type GetItemsResult } from './creators-api';

export interface RefreshAccount {
  id: string;
  org_id: string;
  programme_id: string;
  store_id: string;
  marketplace_host: string;
  status: string;
  /** timestamptz: pg returns string, pg-mem Date; null = not paused. */
  api_paused_until?: string | Date | null;
}

export interface ItemsClient {
  getItems(asins: string[]): Promise<GetItemsResult>;
}

export interface RefreshDeps {
  /** The API client for an account, or null when no credentials are configured. */
  clientFor(account: RefreshAccount): ItemsClient | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxRequestsPerRun?: number;
  offerTtlDays?: number;
  minIntervalMs?: number;
  log?: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
}

export interface RefreshSummary {
  accounts: number;
  expired_prices: number;
  priced: number;
  unpriced: number;
  stale: number;
  requests: number;
  skipped_no_credentials: number;
  /** Accounts not asked this run: paused after a 429 / 401 / 403 until the time given. */
  skipped_paused: Array<{ account_id: string; until: string }>;
  reactivated: number;
  stopped: Array<{ account_id: string; status: number; code: string; paused_until: string | null }>;
}

/** Start of the next UTC day after `at`. */
export function nextUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
}

/** Until when an API refusal pauses the account's refresh (null = no pause, just stop this run). */
export function pauseUntil(status: number, retryAfterSeconds: number | null, at: Date): Date | null {
  if (status === 429) {
    return retryAfterSeconds !== null && retryAfterSeconds > 0
      ? new Date(at.getTime() + retryAfterSeconds * 1000)
      : nextUtcDay(at);
  }
  if (status === 401 || status === 403) return nextUtcDay(at);
  return null;
}

type Q = Pick<Pool, 'query'>;

export async function refreshAmazonOffers(pool: Q, deps: RefreshDeps): Promise<RefreshSummary> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRequests = deps.maxRequestsPerRun ?? 300;
  const ttlDays = deps.offerTtlDays ?? 30;
  const minInterval = deps.minIntervalMs ?? 1100;
  const log = deps.log ?? (() => undefined);

  const summary: RefreshSummary = {
    accounts: 0,
    expired_prices: 0,
    priced: 0,
    unpriced: 0,
    stale: 0,
    requests: 0,
    skipped_no_credentials: 0,
    skipped_paused: [],
    reactivated: 0,
    stopped: [],
  };

  const { rows: accounts } = await pool.query<RefreshAccount>(
    `select id, org_id, programme_id, store_id, marketplace_host, status, api_paused_until
       from amazon_associates_accounts order by org_id, id`,
  );
  summary.accounts = accounts.length;

  // 1) Expire prices older than the limit — every account, credentials or not.
  const cutoff = new Date(now().getTime() - AMAZON_PRICE_MAX_AGE_HOURS * 3_600_000).toISOString();
  for (const a of accounts) {
    const expired = await pool.query<{ id: string }>(
      `update offers set price_minor = null, price_as_of = null
        where org_id = $1 and programme_id = $2 and price_as_of is not null and price_as_of < $3::timestamptz
        returning id`,
      [a.org_id, a.programme_id, cutoff],
    );
    summary.expired_prices += expired.rows.length;
  }

  // 2) Refresh.
  let lastRequestAt = 0;
  for (const a of accounts) {
    if (a.status !== 'active') continue;
    if (a.api_paused_until && new Date(a.api_paused_until).getTime() > now().getTime()) {
      summary.skipped_paused.push({ account_id: a.id, until: new Date(a.api_paused_until).toISOString() });
      continue;
    }
    const client = deps.clientFor(a);
    if (!client) {
      summary.skipped_no_credentials += 1;
      log('info', 'no Creators API credentials: Amazon prices stay hidden (links and conversions are unaffected)', {
        account_id: a.id,
      });
      continue;
    }
    const budget = maxRequests - summary.requests;
    if (budget <= 0) break;
    const { rows: offers } = await pool.query<{ id: string; merchant_item_ref: string; fresh_until: string | Date; status: string }>(
      `select id, merchant_item_ref, fresh_until, status
         from offers
        where org_id = $1 and programme_id = $2 and merchant_item_ref is not null
          and (status = 'active' or (status = 'stale' and stale_reason = 'merchant_not_accessible'))
        order by price_as_of asc nulls first, id
        limit $3`,
      [a.org_id, a.programme_id, budget * MAX_ITEMS_PER_REQUEST],
    );
    for (let i = 0; i < offers.length; i += MAX_ITEMS_PER_REQUEST) {
      const batch = offers.slice(i, i + MAX_ITEMS_PER_REQUEST);
      const wait = lastRequestAt + minInterval - Date.now();
      if (lastRequestAt > 0 && wait > 0) await sleep(wait);
      lastRequestAt = Date.now();
      summary.requests += 1;
      let result: GetItemsResult;
      try {
        result = await client.getItems(batch.map((o) => o.merchant_item_ref));
      } catch (err) {
        if (err instanceof CreatorsApiError) {
          const until = pauseUntil(err.status, err.retryAfterSeconds, now());
          if (until) {
            await pool.query(
              `update amazon_associates_accounts set api_paused_until = $3::timestamptz, updated_at = now()
                where org_id = $1 and id = $2`,
              [a.org_id, a.id, until.toISOString()],
            );
          }
          summary.stopped.push({ account_id: a.id, status: err.status, code: err.code, paused_until: until ? until.toISOString() : null });
          log('warn', until ? 'Creators API refused the refresh; this account is paused' : 'Creators API refused the refresh; stopping this account for this run', {
            account_id: a.id,
            status: err.status,
            code: err.code,
            retry_after_seconds: err.retryAfterSeconds,
            paused_until: until ? until.toISOString() : null,
          });
          break;
        }
        throw err;
      }
      const at = now();
      const atIso = at.toISOString();
      const extendTo = new Date(at.getTime() + ttlDays * 86_400_000);
      for (const o of batch) {
        const item = result.items.find((it) => it.asin === o.merchant_item_ref);
        if (result.notAccessible.includes(o.merchant_item_ref)) {
          if (o.status === 'active') {
            await pool.query(
              `update offers set status = 'stale', stale_reason = 'merchant_not_accessible', price_minor = null, price_as_of = null
                where org_id = $1 and id = $2 and status = 'active'`,
              [a.org_id, o.id],
            );
            summary.stale += 1;
          }
          continue;
        }
        if (item && o.status === 'stale') {
          // Amazon lists the item again: the offer it had reported not accessible comes back.
          await pool.query(
            `update offers set status = 'active', stale_reason = null
              where org_id = $1 and id = $2 and status = 'stale' and stale_reason = 'merchant_not_accessible'`,
            [a.org_id, o.id],
          );
          summary.reactivated += 1;
        } else if (!item && o.status === 'stale') {
          continue; // still not returned: stays stale, nothing else to change
        }
        if (item && item.priceMinor !== null) {
          const fresh = new Date(o.fresh_until).getTime() > extendTo.getTime() ? new Date(o.fresh_until) : extendTo;
          await pool.query(
            `update offers set price_minor = $3, price_as_of = $4::timestamptz, stock_status = $5, fresh_until = $6::timestamptz
              where org_id = $1 and id = $2`,
            [a.org_id, o.id, String(item.priceMinor), atIso, item.stockStatus, fresh.toISOString()],
          );
          summary.priced += 1;
        } else {
          // Returned without a usable price, or not returned: show none. A
          // returned item still exists, so its offer stays linkable longer.
          const fresh = item && new Date(o.fresh_until).getTime() < extendTo.getTime() ? extendTo : new Date(o.fresh_until);
          await pool.query(
            `update offers set price_minor = null, price_as_of = null, stock_status = $3, fresh_until = $4::timestamptz
              where org_id = $1 and id = $2`,
            [a.org_id, o.id, item?.stockStatus ?? 'unknown', fresh.toISOString()],
          );
          summary.unpriced += 1;
        }
      }
    }
  }
  return summary;
}
