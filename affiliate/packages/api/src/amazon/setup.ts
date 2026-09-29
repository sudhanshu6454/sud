/**
 * Amazon.in Associates setup — creates (or converges) the merchant, the
 * programme, its capabilities, the Associates account, one campaign per
 * publisher of the declared properties, one placement per declared property,
 * the first contract version, and the tracking-ID mappings, in ONE
 * transaction. Run by the CLI (src/cli/amazon.ts setup) on the server; every
 * real value (store ID, tracking IDs, the properties) comes from its
 * arguments and a file kept on the server, never from this repository.
 *
 * Idempotent: a second run with the same inputs writes nothing new. What a
 * re-run never does (refused, nothing written):
 *   - change the store ID of an existing account (its account_ref keys every
 *     imported conversion);
 *   - remap a tracking ID to another placement, or give a placement a second
 *     tracking ID (mappings are append-only: an old sale must keep meaning
 *     what it meant);
 *   - declare a property that is not approved, one without a live
 *     owner_operated verification (PR 9: the tag only on "your site"; there
 *     is no setting that allows third parties), or one on a platform Amazon
 *     does not accept (AMAZON_ACCEPTED_PLATFORMS: Facebook, Instagram, the
 *     owner's website — never Snapchat or Telegram);
 *   - map the store ID itself (it is every unmapped placement's tag, so it
 *     can never name one placement);
 *   - store a disclosure that does not contain OA §10's statement word for
 *     word.
 * Set on insert only (a re-run keeps the operator's later changes): the
 * programme's status (kill switch), the account's status, contract terms.
 *
 * After COMMIT the redirect's cached routes of every link whose tag may have
 * changed are deleted (now and 2 s later, routes/programmes.ts
 * deleteRouteKeys); without Redis they expire within 600 s, and a sale in
 * that window carries the old tag and lands in suspense, never with the
 * wrong placement.
 */
import type { PoolClient } from 'pg';
import {
  AMAZON_ACCEPTED_PLATFORMS,
  AMAZON_ASSOCIATE_DISCLOSURE,
  AMAZON_CONNECTOR,
  AMAZON_IN_CURRENCY,
  AMAZON_IN_MARKETPLACE_HOST,
  AMAZON_IN_POLICY_URL,
  AMAZON_PRICE_MAX_AGE_HOURS,
  isAmazonAcceptedPlatform,
  validateTrackingId,
} from '@paparazzi/shared';
import { getPool } from '../db.js';
import { parseCsv } from '../delimited.js';

/** The platforms a property of the file may be on (@paparazzi/shared AMAZON_ACCEPTED_PLATFORMS). */
export const AMAZON_PLATFORMS = AMAZON_ACCEPTED_PLATFORMS;

/** placements.channel per platform (the same vocabulary as db/seed-network.ts). */
export const AMAZON_PLATFORM_CHANNEL: Readonly<Record<string, string>> = {
  instagram: 'instagram_bio',
  facebook: 'facebook_post',
  web: 'web_article',
};

/** Why a platform of the network is refused (Amazon's accepted networks, help G8TW5AE9XL2VX9VM). */
function platformRefusal(platform: string): string {
  return (
    `platform '${platform}' cannot carry Amazon links: this build declares ${AMAZON_PLATFORMS.join(' | ')} only ` +
    `(Amazon accepts "Facebook …, Instagram, Twitter, YouTube, Tik Tok, and Twitch.tv" and websites you own; ` +
    `Snapchat, Telegram and WhatsApp are not on that list)`
  );
}

export const DEFAULT_MERCHANT_NAME = 'Amazon.in';
export const DEFAULT_PROGRAMME_NAME = 'Amazon.in Associates';
export const CAMPAIGN_NAME = 'Amazon.in Associates';

/** placement_key of a declared property's Amazon placement. */
export function amazonPlacementKey(propertyId: string): string {
  return `amazon-${propertyId}`;
}

export interface PropertyDeclaration {
  /** 1-based data row of the properties file. */
  row: number;
  platform: string;
  /** external_account_id as db/seed-network.ts stores it. */
  account: string;
  trackingId: string | null;
}

export interface AmazonSetupOptions {
  orgSlug: string;
  storeId: string;
  marketplaceHost?: string;
  /** The properties file's rows: exactly the pages on the Associates website list. */
  declarations: PropertyDeclaration[];
  /** Needed only when a publisher has no contract for the programme yet. */
  publisherShareBps?: number | null;
  /** On insert only. */
  programmeStatus?: 'active' | 'draft';
  merchantName?: string;
  programmeName?: string;
  /** Must contain OA §10's statement word for word (AMAZON_ASSOCIATE_DISCLOSURE); default: the statement. */
  disclosureText?: string;
  validationDelayDays?: number;
  returnsWindowDays?: number;
  /** Host of the shop's own web property, to report its placement as web_placement_id. */
  shopHost?: string | null;
  now?: Date;
}

export interface SetupPlacement {
  platform: string;
  account: string;
  property_id: string;
  placement_id: string;
  tracking_id: string | null;
  tag: string;
}

export interface AmazonSetupSummary {
  org_id: string;
  merchant_id: string;
  programme_id: string;
  programme_status: string;
  account_id: string;
  account_ref: string;
  store_id: string;
  marketplace_host: string;
  campaigns: Array<{ publisher_id: string; campaign_id: string; contract_id: string }>;
  placements: SetupPlacement[];
  tracking_ids_added: number;
  web_placement_id: string | null;
  invalidated_routes: number;
  route_cache: 'invalidated' | 'no_redis' | 'nothing_to_invalidate';
}

export class SetupRefusal extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`amazon setup refused:\n  - ${problems.join('\n  - ')}`);
    this.name = 'SetupRefusal';
    this.problems = problems;
  }
}

function normaliseAccount(platform: string, raw: string): string {
  const v = raw.trim();
  return platform === 'web' ? v.toLowerCase().replace(/\.$/, '') : v.replace(/^@/, '').toLowerCase();
}

/**
 * The properties file (CSV, header required, columns case-insensitive):
 *   platform,account,tracking_id
 *   instagram,demo.afflino,demo-ig-21
 *   web,afflino.example.com,
 * One row per property declared on the Associates account's website list;
 * tracking_id empty = the property carries the store ID. `platform` and
 * `account` are the network file's (db/seed-network.ts). An optional `url`
 * column is for the reader only and ignored (the CLI's `template` command
 * writes it, so the operator recognises each page).
 */
export function parsePropertiesFile(text: string): { declarations: PropertyDeclaration[]; problems: string[] } {
  const problems: string[] = [];
  let records: string[][];
  try {
    records = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  } catch (err) {
    return { declarations: [], problems: [`properties file is not valid CSV: ${err instanceof Error ? err.message : err}`] };
  }
  if (records.length === 0) return { declarations: [], problems: ['properties file is empty'] };
  const header = (records[0] as string[]).map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const required of ['platform', 'account']) {
    if (col(required) < 0) problems.push(`properties file: missing column '${required}' (header: platform,account,tracking_id)`);
  }
  for (const h of header) {
    if (h !== '' && !['platform', 'account', 'tracking_id', 'url'].includes(h)) problems.push(`properties file: unknown column '${h}'`);
  }
  if (problems.length > 0) return { declarations: [], problems };

  const declarations: PropertyDeclaration[] = [];
  records.slice(1).forEach((cells, i) => {
    const row = i + 1;
    const get = (name: string) => (col(name) >= 0 ? (cells[col(name)] ?? '').trim() : '');
    const platform = get('platform').toLowerCase();
    if (!isAmazonAcceptedPlatform(platform)) {
      problems.push(`properties file row ${row}: ${platformRefusal(get('platform'))}`);
      return;
    }
    const account = normaliseAccount(platform, get('account'));
    if (!account) {
      problems.push(`properties file row ${row}: account is empty`);
      return;
    }
    const rawTag = get('tracking_id');
    let trackingId: string | null = null;
    if (rawTag !== '') {
      const t = validateTrackingId(rawTag);
      if (!t.ok) {
        problems.push(`properties file row ${row}: ${t.reason}`);
        return;
      }
      trackingId = t.value;
    }
    declarations.push({ row, platform, account, trackingId });
  });
  return { declarations, problems };
}

interface Db {
  query: PoolClient['query'];
}

async function rows<T extends Record<string, unknown>>(db: Db, sql: string, params: unknown[]): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

async function oneId(db: Db, sql: string, params: unknown[]): Promise<string> {
  const r = (await rows<{ id: string }>(db, sql, params))[0];
  if (!r) throw new Error(`amazon setup: expected a row from ${sql.slice(0, 80)}…`);
  return r.id;
}

/** Validate the inputs that need no database. */
export function checkSetupOptions(opts: AmazonSetupOptions, env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const host = opts.marketplaceHost ?? AMAZON_IN_MARKETPLACE_HOST;
  if (host !== AMAZON_IN_MARKETPLACE_HOST) {
    problems.push(`marketplace host '${host}' is not supported: this build knows ${AMAZON_IN_MARKETPLACE_HOST} only`);
  }
  const store = validateTrackingId(opts.storeId);
  if (!store.ok) problems.push(`store ID: ${store.reason}`);
  if (opts.publisherShareBps !== undefined && opts.publisherShareBps !== null) {
    if (!Number.isInteger(opts.publisherShareBps) || opts.publisherShareBps < 0 || opts.publisherShareBps > 10000) {
      problems.push('publisher share must be an integer number of basis points, 0..10000');
    }
  }
  if (opts.disclosureText !== undefined && !opts.disclosureText.includes(AMAZON_ASSOCIATE_DISCLOSURE)) {
    problems.push(
      `the disclosure must contain OA §10's statement word for word ("${AMAZON_ASSOCIATE_DISCLOSURE}"); it is shown beside every Amazon button`,
    );
  }
  if (opts.disclosureText !== undefined && opts.disclosureText.trim().length > 500) {
    problems.push('the disclosure is longer than 500 characters');
  }
  for (const [name, v] of [
    ['validation delay', opts.validationDelayDays],
    ['returns window', opts.returnsWindowDays],
  ] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 365)) problems.push(`${name} must be 0..365 days`);
  }
  if (opts.declarations.length === 0) {
    problems.push('no properties declared: the properties file (one row per page on the Associates website list) is empty');
  }
  const storeId = store.ok ? store.value : null;
  const seenProps = new Map<string, number>();
  const seenTags = new Map<string, number>();
  for (const d of opts.declarations) {
    if (!isAmazonAcceptedPlatform(d.platform)) problems.push(`properties file row ${d.row}: ${platformRefusal(d.platform)}`);
    const key = `${d.platform}/${d.account}`;
    if (seenProps.has(key)) problems.push(`properties file row ${d.row}: ${key} is also on row ${seenProps.get(key)}`);
    seenProps.set(key, d.row);
    if (d.trackingId) {
      const t = validateTrackingId(d.trackingId);
      if (!t.ok) problems.push(`properties file row ${d.row}: ${t.reason}`);
      if (d.trackingId === storeId) {
        problems.push(
          `properties file row ${d.row}: the store ID ${storeId} cannot be mapped to one property (it is the tag of every property without its own tracking ID)`,
        );
      }
      if (seenTags.has(d.trackingId)) {
        problems.push(`properties file row ${d.row}: tracking ID ${d.trackingId} is also on row ${seenTags.get(d.trackingId)}`);
      }
      seenTags.set(d.trackingId, d.row);
    }
  }
  if (env.NODE_ENV === 'production') {
    const testValues = [storeId, ...opts.declarations.map((d) => d.trackingId)].filter(
      (v): v is string => typeof v === 'string' && /^demo/.test(v),
    );
    if (testValues.length > 0) {
      problems.push(`REFUSING under NODE_ENV=production: TEST values (${testValues.slice(0, 3).join(', ')}) are fixtures, not a real account`);
    }
  }
  return problems;
}

export async function setupAmazonAssociates(
  opts: AmazonSetupOptions,
  hooks: { invalidate?: (tokens: string[]) => Promise<{ deleted: number; redisAvailable: boolean }> } = {},
): Promise<AmazonSetupSummary> {
  const early = checkSetupOptions(opts);
  if (early.length > 0) throw new SetupRefusal(early);

  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const host = opts.marketplaceHost ?? AMAZON_IN_MARKETPLACE_HOST;
  const storeId = (validateTrackingId(opts.storeId) as { value: string }).value;
  const accountRef = `${AMAZON_CONNECTOR}:${storeId}`;
  const merchantName = opts.merchantName ?? DEFAULT_MERCHANT_NAME;
  const programmeName = opts.programmeName ?? DEFAULT_PROGRAMME_NAME;
  const disclosure = (opts.disclosureText ?? AMAZON_ASSOCIATE_DISCLOSURE).trim();

  const client = await getPool().connect();
  let summary: AmazonSetupSummary;
  let tokensToInvalidate: string[] = [];
  try {
    await client.query('BEGIN');
    const db: Db = client;
    const problems: string[] = [];

    const org = (await rows<{ id: string }>(db, `select id from organisations where slug = $1`, [opts.orgSlug]))[0];
    if (!org) throw new SetupRefusal([`no organisation '${opts.orgSlug}' (run db/seed-network.ts first)`]);
    const orgId = org.id;

    // -- the declared properties ------------------------------------------------
    interface Prop {
      id: string;
      publisher_id: string;
      platform: string;
      account: string;
      status: string;
      owner: boolean;
      trackingId: string | null;
      row: number;
    }
    const props = new Map<string, Prop>();
    const ownerOperated = new Set(
      (
        await rows<{ property_id: string }>(
          db,
          `select distinct v.property_id as property_id
             from verifications v
            where v.org_id = $1 and v.method = 'owner_operated' and v.verified_at is not null
              and (v.expires_at is null or v.expires_at > now())`,
          [orgId],
        )
      ).map((r) => r.property_id),
    );
    for (const d of opts.declarations) {
      const p = (
        await rows<{ id: string; publisher_id: string; status: string }>(
          db,
          `select id, publisher_id, status from properties
            where org_id = $1 and platform = $2 and external_account_id = $3`,
          [orgId, d.platform, d.account],
        )
      )[0];
      if (!p) {
        problems.push(`properties file row ${d.row}: no property ${d.platform}/${d.account} in '${opts.orgSlug}' (seed it with db/seed-network.ts)`);
        continue;
      }
      props.set(p.id, {
        ...p,
        platform: d.platform,
        account: d.account,
        owner: ownerOperated.has(p.id),
        trackingId: d.trackingId,
        row: d.row,
      });
    }
    for (const p of props.values()) {
      const where = `properties file row ${p.row}`;
      if (p.status !== 'approved') problems.push(`${where}: ${p.platform}/${p.account} is '${p.status}', not approved`);
      else if (!p.owner) {
        problems.push(
          `${where}: ${p.platform}/${p.account} has no live owner_operated verification; Amazon links go on the operator's own properties only (PR 9)`,
        );
      }
    }
    if (props.size === 0 && problems.length === 0) problems.push('no approved owner-operated property to declare');

    // -- the existing account (never re-keyed) ----------------------------------
    const existing = (
      await rows<{
        id: string;
        programme_id: string;
        store_id: string;
        disclosure_text: string;
        status: string;
      }>(
        db,
        `select id, programme_id, store_id, disclosure_text, status
           from amazon_associates_accounts where org_id = $1 and marketplace_host = $2`,
        [orgId, host],
      )
    )[0];
    if (existing && existing.store_id !== storeId) {
      problems.push(
        `the ${host} account of '${opts.orgSlug}' has store ID ${existing.store_id}; it cannot become ${storeId} (every imported conversion is keyed by it)`,
      );
    }
    const otherOrg = (
      await rows<{ org_id: string }>(db, `select org_id from amazon_associates_accounts where account_ref = $1`, [accountRef])
    )[0];
    if (otherOrg && otherOrg.org_id !== orgId) problems.push(`store ID ${storeId} already belongs to another organisation`);

    // -- existing mappings: append-only -------------------------------------------
    const existingMappings = existing
      ? await rows<{ tracking_id: string; placement_id: string; property_id: string }>(
          db,
          `select t.tracking_id, t.placement_id, pl.property_id
             from amazon_tracking_ids t
             join placements pl on pl.id = t.placement_id and pl.org_id = $1
            where t.org_id = $1 and t.account_id = $2`,
          [orgId, existing.id],
        )
      : [];
    const mappedByTag = new Map(existingMappings.map((m) => [m.tracking_id, m]));
    const mappedByProperty = new Map(existingMappings.map((m) => [m.property_id, m]));
    for (const p of props.values()) {
      if (!p.trackingId) continue;
      const byTag = mappedByTag.get(p.trackingId);
      if (byTag && byTag.property_id !== p.id) {
        problems.push(`properties file row ${p.row}: tracking ID ${p.trackingId} is already mapped to another property; mappings are never changed`);
      }
      const byProp = mappedByProperty.get(p.id);
      if (byProp && byProp.tracking_id !== p.trackingId) {
        problems.push(
          `properties file row ${p.row}: ${p.platform}/${p.account} already has tracking ID ${byProp.tracking_id}; mappings are never changed`,
        );
      }
    }
    if (problems.length > 0) throw new SetupRefusal(problems);

    // -- merchant, programme, capabilities -----------------------------------------
    const merchantId =
      (await rows<{ id: string }>(db, `select id from merchants where org_id = $1 and name = $2 limit 1`, [orgId, merchantName]))[0]?.id ??
      (await oneId(db, `insert into merchants (org_id, name) values ($1, $2) returning id`, [orgId, merchantName]));

    let programmeId = existing?.programme_id ?? null;
    if (!programmeId) {
      programmeId =
        (
          await rows<{ id: string }>(
            db,
            `select id from programmes where org_id = $1 and connector = $2 and name = $3 limit 1`,
            [orgId, AMAZON_CONNECTOR, programmeName],
          )
        )[0]?.id ??
        (await oneId(
          db,
          `insert into programmes
             (org_id, merchant_id, connector, name, status,
              attribution_window_days, validation_delay_days, returns_window_days,
              commission_basis, effective_from)
           values ($1, $2, $3, $4, $5, 1, $6, $7, 'associates_fee_schedule', $8::timestamptz)
           returning id`,
          [
            orgId,
            merchantId,
            AMAZON_CONNECTOR,
            programmeName,
            opts.programmeStatus ?? 'active',
            opts.validationDelayDays ?? 60,
            opts.returnsWindowDays ?? 30,
            nowIso,
          ],
        ));
    } else {
      // Terms given on a re-run converge; terms not given stay as they are.
      if (opts.validationDelayDays !== undefined) {
        await db.query(`update programmes set validation_delay_days = $3 where org_id = $1 and id = $2`, [
          orgId,
          programmeId,
          opts.validationDelayDays,
        ]);
      }
      if (opts.returnsWindowDays !== undefined) {
        await db.query(`update programmes set returns_window_days = $3 where org_id = $1 and id = $2`, [
          orgId,
          programmeId,
          opts.returnsWindowDays,
        ]);
      }
    }
    const programmeStatus =
      (await rows<{ status: string }>(db, `select status from programmes where org_id = $1 and id = $2`, [orgId, programmeId]))[0]?.status ??
      'unknown';

    await db.query(
      `insert into programme_capabilities
         (programme_id, countries, currency, allowed_domains, subpublisher_allowed, policy_url, price_max_age_hours)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (programme_id)
         do update set countries = excluded.countries,
                       currency = excluded.currency,
                       allowed_domains = excluded.allowed_domains,
                       subpublisher_allowed = excluded.subpublisher_allowed,
                       policy_url = excluded.policy_url,
                       price_max_age_hours = excluded.price_max_age_hours`,
      // subpublisher_allowed stays false: the owner's tag on the owner's own properties only (PR 9).
      [programmeId, ['IN'], AMAZON_IN_CURRENCY, [host], false, AMAZON_IN_POLICY_URL, AMAZON_PRICE_MAX_AGE_HOURS],
    );

    // -- the account ----------------------------------------------------------------
    let accountId: string;
    if (existing) {
      accountId = existing.id;
      // The disclosure is not part of the cached route: nothing to invalidate.
      if (existing.disclosure_text !== disclosure) {
        await db.query(
          `update amazon_associates_accounts set disclosure_text = $3, updated_at = now() where org_id = $1 and id = $2`,
          [orgId, accountId, disclosure],
        );
      }
    } else {
      accountId = await oneId(
        db,
        `insert into amazon_associates_accounts
           (org_id, programme_id, marketplace_host, store_id, account_ref, currency, disclosure_text)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning id`,
        [orgId, programmeId, host, storeId, accountRef, AMAZON_IN_CURRENCY, disclosure],
      );
    }

    // -- campaigns (one per publisher) and contracts ------------------------------------
    const publishers = [...new Set([...props.values()].map((p) => p.publisher_id))].sort();
    const campaigns: AmazonSetupSummary['campaigns'] = [];
    const campaignOf = new Map<string, string>();
    const missingContract: string[] = [];
    for (const publisherId of publishers) {
      const campaignId =
        (
          await rows<{ id: string }>(
            db,
            `select id from campaigns where org_id = $1 and publisher_id = $2 and programme_id = $3 order by created_at, id limit 1`,
            [orgId, publisherId, programmeId],
          )
        )[0]?.id ??
        (await oneId(
          db,
          `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, $4) returning id`,
          [orgId, publisherId, programmeId, CAMPAIGN_NAME],
        ));
      campaignOf.set(publisherId, campaignId);
      let contractId =
        (
          await rows<{ id: string }>(
            db,
            `select id from contracts where org_id = $1 and publisher_id = $2 and programme_id = $3 order by version desc limit 1`,
            [orgId, publisherId, programmeId],
          )
        )[0]?.id ?? null;
      if (!contractId) {
        if (opts.publisherShareBps === undefined || opts.publisherShareBps === null) {
          missingContract.push(publisherId);
          continue;
        }
        contractId = await oneId(
          db,
          `insert into contracts
             (org_id, publisher_id, programme_id, version, publisher_share_bps, payout_threshold_minor, status, effective_from)
           values ($1, $2, $3, 1, $4, 0, 'approved', $5::timestamptz)
           returning id`,
          [orgId, publisherId, programmeId, opts.publisherShareBps, nowIso],
        );
      }
      campaigns.push({ publisher_id: publisherId, campaign_id: campaignId, contract_id: contractId });
    }
    if (missingContract.length > 0) {
      throw new SetupRefusal([
        `no contract yet between ${missingContract.length} publisher(s) and the programme: give the publisher share (--publisher-share-bps, basis points)`,
      ]);
    }

    // -- placements and tracking IDs -------------------------------------------------------
    const placements: SetupPlacement[] = [];
    const newlyMapped: string[] = [];
    const ordered = [...props.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.account.localeCompare(b.account));
    for (const p of ordered) {
      const res = await rows<{ id: string }>(
        db,
        `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
         values ($1, $2, $3, $4, $5)
         on conflict (placement_key)
           do update set campaign_id = excluded.campaign_id, channel = excluded.channel
           where placements.org_id = excluded.org_id and placements.property_id = excluded.property_id
         returning id`,
        [orgId, campaignOf.get(p.publisher_id), p.id, AMAZON_PLATFORM_CHANNEL[p.platform] ?? 'web_article', amazonPlacementKey(p.id)],
      );
      const placementId = res[0]?.id;
      if (!placementId) throw new SetupRefusal([`placement key ${amazonPlacementKey(p.id)} belongs to another organisation`]);
      let tag = storeId;
      let trackingId: string | null = mappedByProperty.get(p.id)?.tracking_id ?? null;
      if (p.trackingId && !trackingId) {
        await db.query(
          `insert into amazon_tracking_ids (org_id, account_id, tracking_id, placement_id, effective_from)
           values ($1, $2, $3, $4, $5::timestamptz)`,
          [orgId, accountId, p.trackingId, placementId, nowIso],
        );
        trackingId = p.trackingId;
        newlyMapped.push(placementId);
      }
      if (trackingId) tag = trackingId;
      placements.push({ platform: p.platform, account: p.account, property_id: p.id, placement_id: placementId, tracking_id: trackingId, tag });
    }

    // -- the cached routes whose tag changed (a placement that just got its tracking ID) ------
    for (const placementId of newlyMapped) {
      const t = await rows<{ token: string }>(
        db,
        `select token from links where org_id = $1 and placement_id = $2 and status = 'active'`,
        [orgId, placementId],
      );
      tokensToInvalidate.push(...t.map((r) => r.token));
    }

    const shopHost = opts.shopHost?.trim().toLowerCase() || null;
    summary = {
      org_id: orgId,
      merchant_id: merchantId,
      programme_id: programmeId,
      programme_status: programmeStatus,
      account_id: accountId,
      account_ref: accountRef,
      store_id: storeId,
      marketplace_host: host,
      campaigns,
      placements,
      tracking_ids_added: newlyMapped.length,
      web_placement_id: shopHost ? (placements.find((p) => p.platform === 'web' && p.account === shopHost)?.placement_id ?? null) : null,
      invalidated_routes: tokensToInvalidate.length,
      route_cache: 'nothing_to_invalidate',
    };
    await client.query('COMMIT');
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

  if (tokensToInvalidate.length > 0 && hooks.invalidate) {
    const res = await hooks.invalidate(tokensToInvalidate);
    summary.route_cache = res.redisAvailable ? 'invalidated' : 'no_redis';
  }
  return summary;
}
