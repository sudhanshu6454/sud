/**
 * Demo seed for the Paparazzi Affiliate Commerce Platform.
 *
 * `seedDemo(query)` inserts a fixed, minimal demo graph (all money in minor
 * units / paise) and returns the ids the demo script needs:
 *
 *   organisation "Demo Org"
 *   users: publisher-owner, finance-operator, finance-approver (+ memberships)
 *   publisher (approved) + property (approved, instagram/demo.paparazzi)
 *     + verifications row
 *   merchant + programme (connector 'stub-network', active, INR,
 *     allowed_domains ['shop.example.com'], 30/7/30 day windows)
 *   contract v1 (approved, 7000 bps publisher share, INR 100 threshold)
 *   product + variant + offer (https://shop.example.com/p/demo-sku, active,
 *     fresh for 30 days)
 *   asset + look (published; source_page 'Demo Candid Frames', sponsored false,
 *     cover_asset_id = the asset) + look item
 *   campaign + placement
 *
 * Run-once semantics: rows keyed by a natural unique key (organisations.slug,
 * users.email, properties(platform, external_account_id),
 * placements.placement_key, contracts(publisher, programme, version)) are
 * merged on re-run; the rest are plain inserts and will duplicate if you
 * re-run against the same database. Prefer a fresh database per run.
 *
 * Direct usage (real Postgres):  DATABASE_URL=... pnpm seed
 * (see db/README.md). The in-process demo calls `seedDemo` with a pg-mem
 * pool instead and never touches this file's main guard.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Minimal query surface: satisfied by pg.Client and pg-mem's Pool adapter. */
export type SeedQuery = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

export interface SeedIds {
  orgId: string;
  publisherId: string;
  propertyId: string;
  programmeId: string;
  offerId: string;
  placementId: string;
  users: {
    owner: string;
    operator: string;
    approver: string;
  };
}

async function one(
  query: SeedQuery,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>> {
  const { rows } = await query(sql, params);
  const row = rows[0];
  if (!row) throw new Error(`seed: expected one row from: ${sql.slice(0, 90)}…`);
  return row;
}

function idOf(row: Record<string, unknown>): string {
  const id = row.id;
  if (typeof id !== 'string' || id.length === 0) throw new Error('seed: row has no uuid id');
  return id;
}

export async function seedDemo(query: SeedQuery): Promise<SeedIds> {
  const nowIso = new Date().toISOString();
  const freshUntil = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const verifiedUntil = new Date(Date.now() + 365 * 86_400_000).toISOString();

  // -- organisation ---------------------------------------------------------
  const orgId = idOf(
    await one(
      query,
      `insert into organisations (name, slug)
       values ('Demo Org', 'demo-org')
       on conflict (slug) do update set name = excluded.name
       returning id`,
    ),
  );

  // -- users + memberships ---------------------------------------------------
  async function seedUser(email: string, displayName: string, role: string): Promise<string> {
    const userId = idOf(
      await one(
        query,
        `insert into users (email, display_name)
         values ($1, $2)
         on conflict (email) do update set display_name = excluded.display_name
         returning id`,
        [email, displayName],
      ),
    );
    await query(
      `insert into memberships (user_id, org_id, role)
       values ($1, $2, $3)
       on conflict do nothing`,
      [userId, orgId, role],
    );
    return userId;
  }

  const owner = await seedUser(
    'publisher-owner@demo.example',
    'Demo Publisher Owner',
    'publisher_owner',
  );
  const operator = await seedUser(
    'finance-operator@demo.example',
    'Demo Finance Operator',
    'finance_operator',
  );
  const approver = await seedUser(
    'finance-approver@demo.example',
    'Demo Finance Approver',
    'finance_approver',
  );

  // -- publisher graph -------------------------------------------------------
  const publisherId = idOf(
    await one(
      query,
      `insert into publishers (org_id, legal_name, country, status, onboarding_state)
       values ($1, 'Demo Paparazzi', 'IN', 'approved', 'active')
       returning id`,
      [orgId],
    ),
  );

  const propertyId = idOf(
    await one(
      query,
      `insert into properties (org_id, publisher_id, platform, external_account_id, canonical_url, status)
       values ($1, $2, 'instagram', 'demo.paparazzi', 'https://instagram.com/demo.paparazzi', 'approved')
       on conflict (platform, external_account_id)
         do update set status = excluded.status, publisher_id = excluded.publisher_id
       returning id`,
      [orgId, publisherId],
    ),
  );

  await query(
    `insert into verifications (org_id, property_id, method, verified_by, verified_at, expires_at)
     values ($1, $2, 'manual', $3, $4::timestamptz, $5::timestamptz)`,
    [orgId, propertyId, owner, nowIso, verifiedUntil],
  );

  // -- merchant + programme ---------------------------------------------------
  const merchantId = idOf(
    await one(
      query,
      `insert into merchants (org_id, name) values ($1, 'Demo Merchant') returning id`,
      [orgId],
    ),
  );

  const programmeId = idOf(
    await one(
      query,
      `insert into programmes
         (org_id, merchant_id, connector, name, status,
          attribution_window_days, validation_delay_days, returns_window_days,
          commission_basis)
       values ($1, $2, 'stub-network', 'Demo Festive Programme', 'active',
               30, 7, 30,
               'order_value')
       returning id`,
      [orgId, merchantId],
    ),
  );

  await query(
    `insert into programme_capabilities (programme_id, countries, currency, allowed_domains)
     values ($1, $2, 'INR', $3)
     on conflict (programme_id)
       do update set currency = excluded.currency, allowed_domains = excluded.allowed_domains`,
    [programmeId, ['IN'], ['shop.example.com']],
  );

  // -- contract v1: 70/30 split, INR 50 payout threshold ------------------------
  // NOTE: the demo threshold is intentionally low (INR 50) so the demo's
  // post-reversal earnings (INR 56) clear it and the payout steps run.
  // The threshold gate itself is covered by the test suite (below-threshold
  // publishers are excluded with 422).
  await one(
    query,
    `insert into contracts
       (org_id, publisher_id, programme_id, version,
        publisher_share_bps, payout_threshold_minor, status, effective_from)
     values ($1, $2, $3, 1, 7000, 5000, 'approved', $4::timestamptz)
     on conflict (publisher_id, programme_id, version)
       do update set status = excluded.status,
                     publisher_share_bps = excluded.publisher_share_bps,
                     payout_threshold_minor = excluded.payout_threshold_minor
     returning id`,
    [orgId, publisherId, programmeId, nowIso],
  );

  // -- catalogue --------------------------------------------------------------
  const productId = idOf(
    await one(
      query,
      `insert into products (org_id, brand, model, category)
       values ($1, 'Demo Brand', 'Festive Kurta', 'apparel')
       returning id`,
      [orgId],
    ),
  );

  const variantId = idOf(
    await one(
      query,
      `insert into variants (org_id, product_id, size_text, colour, merchant_sku)
       values ($1, $2, 'M', 'Red', 'DEMO-SKU-001')
       returning id`,
      [orgId, productId],
    ),
  );

  const offerId = idOf(
    await one(
      query,
      `insert into offers
         (org_id, variant_id, programme_id, merchant_id,
          price_minor, currency, offer_url, fresh_until, status)
       values ($1, $2, $3, $4, 200000, 'INR',
               'https://shop.example.com/p/demo-sku', $5::timestamptz, 'active')
       returning id`,
      [orgId, variantId, programmeId, merchantId, freshUntil],
    ),
  );

  // -- look ---------------------------------------------------------------------
  const assetId = idOf(
    await one(
      query,
      `insert into assets (org_id, storage_key, license, territory)
       values ($1, 'demo/looks/look-1.jpg', 'owned', 'IN')
       returning id`,
      [orgId],
    ),
  );

  // 0005 columns: where the look was spotted (source_page), the ASCI
  // "Sponsored" flag (false: not a paid placement), and the cover asset.
  const lookId = idOf(
    await one(
      query,
      `insert into looks (org_id, title, locale, status, published_at, source_page, sponsored, cover_asset_id)
       values ($1, 'Demo festive look', 'en', 'published', $2::timestamptz, 'Demo Candid Frames', false, $3)
       returning id`,
      [orgId, nowIso, assetId],
    ),
  );

  await query(
    `insert into look_items (org_id, look_id, asset_id, variant_id, match_type)
     values ($1, $2, $3, $4, 'exact')`,
    [orgId, lookId, assetId, variantId],
  );

  // -- tracking: campaign + placement --------------------------------------------
  const campaignId = idOf(
    await one(
      query,
      `insert into campaigns (org_id, publisher_id, programme_id, name)
       values ($1, $2, $3, 'Demo Festive Campaign')
       returning id`,
      [orgId, publisherId, programmeId],
    ),
  );

  const placementId = idOf(
    await one(
      query,
      `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
       values ($1, $2, $3, 'instagram_bio', 'demo-ig-bio-1')
       on conflict (placement_key)
         do update set campaign_id = excluded.campaign_id,
                       property_id = excluded.property_id
       returning id`,
      [orgId, campaignId, propertyId],
    ),
  );

  return {
    orgId,
    publisherId,
    propertyId,
    programmeId,
    offerId,
    placementId,
    users: { owner, operator, approver },
  };
}

// -- main guard: `pnpm seed` against a real Postgres ------------------------------
const isMainEntry =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  main().catch((err) => {
    console.error('seed failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required: pnpm seed targets a real Postgres (see db/README.md)');
  }
  // Borrow the api package's pg driver (repo root has no pg dependency).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(path.join(here, 'seed.ts'));
  const { Client } = require('../packages/api/node_modules/pg') as {
    Client: new (opts: { connectionString: string }) => {
      connect(): Promise<void>;
      query(
        sql: string,
        params?: unknown[],
      ): Promise<{ rows: Array<Record<string, unknown>> }>;
      end(): Promise<void>;
    };
  };

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const ids = await seedDemo((sql, params) => client.query(sql, params ?? []));
    console.log('seeded demo graph:');
    console.log(JSON.stringify(ids, null, 2));
  } finally {
    await client.end();
  }
}
