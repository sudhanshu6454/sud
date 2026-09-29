/**
 * Amazon offers by ASIN or amazon.in URL (src/cli/amazon.ts offers).
 *
 * One product + variant per ASIN (variants.merchant_sku = the ASIN) and one
 * offer per (programme, ASIN) (offers.merchant_item_ref = the ASIN):
 *   offer_url   = https://www.amazon.in/dp/<ASIN> — no tag (the redirect adds
 *                 the placement's), no query, whatever URL form was given;
 *   price_minor = NULL — a price may only come from Amazon's product API,
 *                 with its time, for 1 hour (the workers' refresh;
 *                 AMAZON_PRICE_MAX_AGE_HOURS); none is ever typed in or
 *                 scraped;
 *   fresh_until = now + ttl days: how long the offer stays linkable without
 *                 a refresh. Re-running extends it; the product-API refresh
 *                 extends it for every ASIN Amazon still returns.
 * brand / model / category are the OPERATOR'S OWN words (nothing is copied
 * from Amazon: its product text may be kept for 24 hours at most, OA §11).
 *
 * Looks (optional `look` column): the shop (GET /v1/looks) shows products
 * only inside published looks, so rows naming a look are grouped into one
 * look per title — created published, no category, no source page, not
 * sponsored, and with a placeholder cover (an `owned` asset with no public
 * URL: the shop draws its gradient artwork; no Amazon image is ever stored,
 * OA §11) — and each row's variant becomes an 'exact' item of it. A look's
 * status is set on insert only (a look paused or withdrawn later stays so);
 * nothing is ever removed from a look. Rows without a look are linkable
 * offers only (posts on the operator's own pages), not shown in the shop.
 *
 * Idempotent; status is set on insert only. A 'stale' offer that Amazon's
 * product API reported not accessible (stale_reason
 * 'merchant_not_accessible', the workers' refresh) STAYS stale when the
 * operator lists it again — it is counted in the summary
 * (`kept_not_accessible`) — unless the run says `reactivate` (the CLI's
 * --reactivate); the refresh itself reactivates it when Amazon lists the
 * item again. A 'stale' offer without that reason (it ran past fresh_until)
 * becomes 'active' again. A 'revoked' offer stays revoked.
 */
import type { PoolClient } from 'pg';
import {
  AMAZON_IN_CURRENCY,
  AMAZON_IN_MARKETPLACE_HOST,
  asinFromAmazonUrl,
  canonicalAmazonUrl,
  normaliseAsin,
} from '@paparazzi/shared';
import { getPool } from '../db.js';
import { parseCsv } from '../delimited.js';
import { SetupRefusal } from './setup.js';

export interface OfferDeclaration {
  row: number;
  asin: string;
  brand: string;
  model: string;
  category: string;
  size: string | null;
  colour: string | null;
  /** Title of the shop look the product goes into; null / absent = not shown in the shop. */
  look?: string | null;
}

/**
 * The offers file (CSV, header required, columns case-insensitive):
 *   asin_or_url,brand,model,category[,look][,size][,colour]
 * `asin_or_url` (or `asin` / `url`): an ASIN, or an amazon.in product URL
 * (/dp/<ASIN>, /gp/product/<ASIN>, …). Short links are refused (they would
 * have to be fetched from Amazon to resolve).
 */
export function parseOffersFile(
  text: string,
  marketplaceHost: string = AMAZON_IN_MARKETPLACE_HOST,
): { offers: OfferDeclaration[]; problems: string[] } {
  const problems: string[] = [];
  let records: string[][];
  try {
    records = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  } catch (err) {
    return { offers: [], problems: [`offers file is not valid CSV: ${err instanceof Error ? err.message : err}`] };
  }
  if (records.length < 2) return { offers: [], problems: ['offers file has no data rows'] };
  const header = (records[0] as string[]).map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
  const idCol = ['asin_or_url', 'asin', 'url'].map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  const col = (n: string) => header.indexOf(n);
  if (idCol < 0) problems.push("offers file: missing column 'asin_or_url' (or 'asin' / 'url')");
  for (const required of ['brand', 'model', 'category']) {
    if (col(required) < 0) problems.push(`offers file: missing column '${required}'`);
  }
  if (problems.length > 0) return { offers: [], problems };

  const offers: OfferDeclaration[] = [];
  const seen = new Map<string, number>();
  records.slice(1).forEach((cells, i) => {
    const row = i + 1;
    const get = (idx: number) => (idx >= 0 ? (cells[idx] ?? '').trim() : '');
    const idRaw = get(idCol);
    let asin = normaliseAsin(idRaw);
    if (!asin) {
      const fromUrl = asinFromAmazonUrl(idRaw, marketplaceHost);
      if (!fromUrl.ok) {
        problems.push(`offers file row ${row}: ${fromUrl.reason}`);
        return;
      }
      asin = fromUrl.asin;
    }
    const brand = get(col('brand'));
    const model = get(col('model'));
    const category = get(col('category'));
    for (const [name, v] of [
      ['brand', brand],
      ['model', model],
      ['category', category],
    ] as const) {
      if (v === '') problems.push(`offers file row ${row}: ${name} is empty (the operator's own words)`);
      else if (v.length > 200) problems.push(`offers file row ${row}: ${name} is longer than 200 characters`);
    }
    const look = get(col('look'));
    if (look.length > 120) problems.push(`offers file row ${row}: look is longer than 120 characters`);
    if (seen.has(asin)) problems.push(`offers file row ${row}: ASIN ${asin} is also on row ${seen.get(asin)}`);
    seen.set(asin, row);
    offers.push({
      row,
      asin,
      brand,
      model,
      category,
      size: get(col('size')) || null,
      colour: get(col('colour')) || null,
      look: look || null,
    });
  });
  return { offers, problems };
}

/** storage_key of a look's placeholder cover (no file exists behind it: the shop draws its artwork). */
export function lookAssetKey(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `amazon-looks/${slug || 'look'}`;
}

export interface AddOffersOptions {
  orgSlug: string;
  offers: OfferDeclaration[];
  /** Days the offer stays linkable without a refresh (1..365, default 30). */
  ttlDays?: number;
  /** Also reactivate offers Amazon's product API reported not accessible (the CLI's --reactivate). */
  reactivate?: boolean;
  marketplaceHost?: string;
  now?: Date;
}

export interface AddOffersSummary {
  org_id: string;
  programme_id: string;
  offers: Array<{
    row: number;
    asin: string;
    offer_id: string;
    variant_id: string;
    product_id: string;
    created: boolean;
    status: string;
    fresh_until: string;
    look_id: string | null;
  }>;
  looks: Array<{ title: string; look_id: string; status: string; created: boolean; items_added: number }>;
  /** ASINs listed again that stay stale: Amazon reported them not accessible (pass reactivate to override). */
  kept_not_accessible: string[];
}

type Db = { query: PoolClient['query'] };

async function rows<T extends Record<string, unknown>>(db: Db, sql: string, params: unknown[]): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

async function oneId(db: Db, sql: string, params: unknown[]): Promise<string> {
  const r = (await rows<{ id: string }>(db, sql, params))[0];
  if (!r) throw new Error(`amazon offers: expected a row from ${sql.slice(0, 80)}…`);
  return r.id;
}

export async function addAmazonOffers(opts: AddOffersOptions, env: NodeJS.ProcessEnv = process.env): Promise<AddOffersSummary> {
  const ttlDays = opts.ttlDays ?? 30;
  const problems: string[] = [];
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 365) problems.push('ttl days must be 1..365');
  if (opts.offers.length === 0) problems.push('no offers given');
  if (env.NODE_ENV === 'production') {
    const demo = opts.offers.filter((o) => /^B0DEMO/.test(o.asin)).map((o) => o.asin);
    if (demo.length > 0) problems.push(`REFUSING under NODE_ENV=production: TEST ASINs (${demo.slice(0, 3).join(', ')})`);
  }
  if (problems.length > 0) throw new SetupRefusal(problems);

  const host = opts.marketplaceHost ?? AMAZON_IN_MARKETPLACE_HOST;
  const now = opts.now ?? new Date();
  const freshUntil = new Date(now.getTime() + ttlDays * 86_400_000).toISOString();

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const db: Db = client;
    const org = (await rows<{ id: string }>(db, `select id from organisations where slug = $1`, [opts.orgSlug]))[0];
    if (!org) throw new SetupRefusal([`no organisation '${opts.orgSlug}'`]);
    const orgId = org.id;
    const account = (
      await rows<{ programme_id: string; merchant_id: string; status: string }>(
        db,
        `select a.programme_id, p.merchant_id, a.status
           from amazon_associates_accounts a
           join programmes p on p.id = a.programme_id and p.org_id = $1
          where a.org_id = $1 and a.marketplace_host = $2`,
        [orgId, host],
      )
    )[0];
    if (!account) throw new SetupRefusal([`no ${host} Associates account in '${opts.orgSlug}' (run the setup first)`]);

    const out: AddOffersSummary['offers'] = [];
    const keptNotAccessible: string[] = [];
    for (const o of opts.offers) {
      const existingVariant = (
        await rows<{ id: string; product_id: string }>(
          db,
          `select id, product_id from variants where org_id = $1 and merchant_sku = $2 order by created_at, id limit 1`,
          [orgId, o.asin],
        )
      )[0];
      let productId: string;
      let variantId: string;
      if (existingVariant) {
        productId = existingVariant.product_id;
        variantId = existingVariant.id;
        await db.query(`update products set brand = $3, model = $4, category = $5 where org_id = $1 and id = $2`, [
          orgId,
          productId,
          o.brand,
          o.model,
          o.category,
        ]);
        await db.query(`update variants set size_text = $3, colour = $4 where org_id = $1 and id = $2`, [
          orgId,
          variantId,
          o.size,
          o.colour,
        ]);
      } else {
        productId = await oneId(
          db,
          `insert into products (org_id, brand, model, category) values ($1, $2, $3, $4) returning id`,
          [orgId, o.brand, o.model, o.category],
        );
        variantId = await oneId(
          db,
          `insert into variants (org_id, product_id, size_text, colour, merchant_sku) values ($1, $2, $3, $4, $5) returning id`,
          [orgId, productId, o.size, o.colour, o.asin],
        );
      }

      const url = canonicalAmazonUrl(host, o.asin);
      const existingOffer = (
        await rows<{ id: string; status: string; stale_reason: string | null }>(
          db,
          `select id, status, stale_reason from offers
            where org_id = $1 and programme_id = $2 and merchant_item_ref = $3 order by created_at, id limit 1`,
          [orgId, account.programme_id, o.asin],
        )
      )[0];
      let offerId: string;
      let status: string;
      if (existingOffer) {
        offerId = existingOffer.id;
        const notAccessible = existingOffer.status === 'stale' && existingOffer.stale_reason === 'merchant_not_accessible';
        if (notAccessible && !opts.reactivate) {
          status = 'stale';
          keptNotAccessible.push(o.asin);
        } else {
          status = existingOffer.status === 'stale' ? 'active' : existingOffer.status;
        }
        await db.query(
          `update offers set offer_url = $3, fresh_until = $4::timestamptz, status = $5, variant_id = $6,
                  stale_reason = case when $5 = 'stale' then stale_reason else null end
            where org_id = $1 and id = $2`,
          [orgId, offerId, url, freshUntil, status, variantId],
        );
      } else {
        status = 'active';
        offerId = await oneId(
          db,
          `insert into offers
             (org_id, variant_id, programme_id, merchant_id, price_minor, currency, stock_status,
              offer_url, fresh_until, status, merchant_item_ref)
           values ($1, $2, $3, $4, null, $5, 'unknown', $6, $7::timestamptz, 'active', $8)
           returning id`,
          [orgId, variantId, account.programme_id, account.merchant_id, AMAZON_IN_CURRENCY, url, freshUntil, o.asin],
        );
      }
      out.push({
        row: o.row,
        asin: o.asin,
        offer_id: offerId,
        variant_id: variantId,
        product_id: productId,
        created: !existingOffer,
        status,
        fresh_until: freshUntil,
        look_id: null,
      });
    }

    // -- looks (the shop's shelves) ----------------------------------------------
    const looks: AddOffersSummary['looks'] = [];
    const titles = [...new Set(opts.offers.map((o) => o.look ?? null).filter((t): t is string => t !== null))];
    for (const title of titles) {
      const found = (
        await rows<{ id: string; status: string; cover_asset_id: string | null }>(
          db,
          `select id, status, cover_asset_id from looks where org_id = $1 and title = $2 order by created_at, id limit 1`,
          [orgId, title],
        )
      )[0];
      let lookId: string;
      let lookStatus: string;
      let assetId: string | null = found?.cover_asset_id ?? null;
      if (!assetId) {
        assetId = await oneId(
          db,
          `insert into assets (org_id, storage_key, license, territory) values ($1, $2, 'owned', 'IN') returning id`,
          [orgId, lookAssetKey(title)],
        );
      }
      if (found) {
        lookId = found.id;
        lookStatus = found.status;
        if (!found.cover_asset_id) {
          await db.query(`update looks set cover_asset_id = $3 where org_id = $1 and id = $2`, [orgId, lookId, assetId]);
        }
      } else {
        lookId = await oneId(
          db,
          `insert into looks (org_id, title, locale, category, status, published_at, source_page, sponsored, cover_asset_id)
           values ($1, $2, 'en-IN', null, 'published', $3::timestamptz, null, false, $4)
           returning id`,
          [orgId, title, now.toISOString(), assetId],
        );
        lookStatus = 'published';
      }
      let added = 0;
      for (const o of out) {
        const decl = opts.offers.find((d) => d.row === o.row);
        if ((decl?.look ?? null) !== title) continue;
        o.look_id = lookId;
        const has = await rows<{ id: string }>(
          db,
          `select id from look_items where org_id = $1 and look_id = $2 and variant_id = $3 limit 1`,
          [orgId, lookId, o.variant_id],
        );
        if (has.length > 0) continue;
        await db.query(
          `insert into look_items (org_id, look_id, asset_id, variant_id, match_type) values ($1, $2, $3, $4, 'exact')`,
          [orgId, lookId, assetId, o.variant_id],
        );
        added += 1;
      }
      looks.push({ title, look_id: lookId, status: lookStatus, created: !found, items_added: added });
    }

    await client.query('COMMIT');
    return { org_id: orgId, programme_id: account.programme_id, offers: out, looks, kept_not_accessible: keptNotAccessible };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}
