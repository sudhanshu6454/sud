// TEST fixtures for the Amazon.in Associates suites: an organisation shaped like
// the owner's in-house network (one approved, active publisher; approved
// properties with an owner_operated verification, as db/seed-network.ts writes
// them), one property WITHOUT that verification, owner-operated Snapchat and
// Telegram properties (platforms Amazon links never go on), and a third-party
// publisher.
// Every value is TEST-labelled: demo handles, *.example.com hosts, the store ID
// demo-21, tracking IDs demo-*-21 and ASINs B0DEMO….

import type { TestDatabase } from './pgmem.js';

export type PoolLike = TestDatabase['Pool'] extends new () => infer P ? P : never;

export const AMZ = {
  STORE: 'demo-21',
  IG_TAG: 'demo-ig-21',
  FB_TAG: 'demo-fb-21',
  ASIN: 'B0DEMO0001',
  ASIN2: 'B0DEMO0002',
  SHOP_HOST: 'shop.example.com',
} as const;

export interface OwnNetwork {
  orgId: string;
  slug: string;
  publisherId: string;
  adminId: string;
  props: { ig: string; fb: string; web: string; fbUnverified: string; snap: string; tg: string; thirdParty: string };
  thirdPartyPublisherId: string;
}

async function id(pool: PoolLike, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await pool.query(sql, params);
  return String(rows[0]!.id);
}

export async function seedOwnNetwork(pool: PoolLike, orgId: string, slug: string, adminId: string): Promise<OwnNetwork> {
  await pool.query(`insert into organisations (id, name, slug) values ($1, $2, $3)`, [orgId, `Demo ${slug}`, slug]);
  await pool.query(`insert into users (id, email) values ($1, $2)`, [adminId, `network_admin@${slug}.example.com`]);
  const publisherId = await id(
    pool,
    `insert into publishers (org_id, legal_name, country, status, onboarding_state)
     values ($1, 'Demo in-house network', 'IN', 'approved', 'active') returning id`,
    [orgId],
  );
  const prop = async (platform: string, account: string, verified: boolean, publisher = publisherId) => {
    const p = await id(
      pool,
      `insert into properties (org_id, publisher_id, platform, external_account_id, canonical_url, status)
       values ($1, $2, $3, $4, $5, 'approved') returning id`,
      [orgId, publisher, platform, account, `https://${platform}.example.com/${account}`],
    );
    if (verified) {
      await pool.query(
        `insert into verifications (org_id, property_id, method, verified_by, verified_at, expires_at)
         values ($1, $2, 'owner_operated', $3, now(), null)`,
        [orgId, p, adminId],
      );
    }
    return p;
  };
  const thirdPartyPublisherId = await id(
    pool,
    `insert into publishers (org_id, legal_name, country, status, onboarding_state)
     values ($1, 'Demo Creator', 'IN', 'approved', 'active') returning id`,
    [orgId],
  );
  return {
    orgId,
    slug,
    publisherId,
    adminId,
    thirdPartyPublisherId,
    props: {
      ig: await prop('instagram', `demo.${slug}`, true),
      fb: await prop('facebook', `demo.${slug}`, true),
      web: await prop('web', `${slug}.${AMZ.SHOP_HOST}`, true),
      fbUnverified: await prop('facebook', `demo.unverified.${slug}`, false),
      snap: await prop('snapchat', `demo.snap.${slug}`, true),
      tg: await prop('telegram', `demo_tg_${slug}`, true),
      thirdParty: await prop('instagram', `demo.creator.${slug}`, false, thirdPartyPublisherId),
    },
  };
}

/** The properties-file declarations of the own network: ig and fb mapped, the shop on the store ID. */
export function declarations(net: OwnNetwork) {
  return [
    { row: 1, platform: 'instagram', account: `demo.${net.slug}`, trackingId: AMZ.IG_TAG as string | null },
    { row: 2, platform: 'facebook', account: `demo.${net.slug}`, trackingId: AMZ.FB_TAG as string | null },
    { row: 3, platform: 'web', account: `${net.slug}.${AMZ.SHOP_HOST}`, trackingId: null as string | null },
  ];
}

/** A tab-separated earnings report in the documented layout (layout to confirm with a real export). */
export function earningsTsv(rows: Array<Partial<Record<string, string>>>, opts: { title?: boolean; bom?: boolean } = {}): string {
  const cols = [
    'Category',
    'Name',
    'ASIN',
    'Seller',
    'Tracking ID',
    'Date Shipped',
    'Price(Rs.)',
    'Items Shipped',
    'Returns',
    'Revenue(Rs.)',
    'Ad Fees(Rs.)',
    'Device Type Group',
  ];
  const defaults: Record<string, string> = {
    Category: 'Home',
    Name: 'Demo Kettle',
    ASIN: AMZ.ASIN,
    Seller: 'Demo Seller',
    'Tracking ID': AMZ.IG_TAG,
    'Date Shipped': '2026-09-20',
    'Price(Rs.)': '1000.00',
    'Items Shipped': '1',
    Returns: '0',
    'Revenue(Rs.)': '1000.00',
    'Ad Fees(Rs.)': '160.00',
    'Device Type Group': 'PHONE',
  };
  const lines = [
    ...(opts.title ? ['Fee-Earnings reports from 2026-09-01 to 2026-09-30 (TEST)'] : []),
    cols.join('\t'),
    ...rows.map((r) => cols.map((c) => r[c] ?? defaults[c] ?? '').join('\t')),
  ];
  return `${opts.bom ? '﻿' : ''}${lines.join('\n')}\n`;
}
