// Phase-3 acceptance tests: tenant isolation, link-creation guards, kill
// switch, publisher onboarding, disputes, contract versioning — against pg-mem.
//
// Same environment notes as money-loop.test.ts: DATABASE_URL/JWT_SECRET are
// set before the API modules are imported; API_PORT=0/REDIRECT_PORT=0 keep
// the import-time main() side effects on ephemeral ports; auth is the JWT
// stub; no Idempotency-Key headers are sent; the redirect app is built with
// buildRedirectApp({pool}) and exercised via inject().

process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_phase3';
process.env.JWT_SECRET ??= 'phase3-test-secret';
process.env.API_PORT ??= '0';
process.env.REDIRECT_PORT ??= '0';

import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import { createTestDb, type TestDatabase } from './pgmem.js';
import { __setRedis } from '../src/redis.js';
import { buildRedirectApp } from '../../redirect/src/index.js';

type PoolLike = TestDatabase['Pool'] extends new () => infer P ? P : never;

let pool: PoolLike;
let app: FastifyInstance;
let redirectApp: FastifyInstance;

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const USERS = {
  AD: { id: '00000000-0000-0000-0000-000000000003', role: 'network_admin' },
  ED: { id: '00000000-0000-0000-0000-000000000004', role: 'editor' },
  OW: { id: '00000000-0000-0000-0000-000000000005', role: 'publisher_owner' },
} as const;

function bearer(user: { id: string; role: string }, orgId: string) {
  const token = jwt.sign(
    { sub: user.id, org_id: orgId, role: user.role },
    process.env.JWT_SECRET as string,
  );
  return { authorization: `Bearer ${token}` };
}

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

interface Chain {
  publisherId: string;
  propertyId: string;
  programmeId: string;
  offerId: string;
  placementId: string;
}

async function insertReturningId(text: string, params: unknown[]): Promise<string> {
  const { rows } = await pool.query(text, params);
  return String(rows[0]!.id);
}

interface SeedOpts {
  publisher: string;
  onboarding?: string;
  propertyStatus?: string;
  programmeStatus?: string;
  offerStatus?: string;
  freshDays?: number;
  offerHost?: string;
  allowedDomains?: string[];
  bps?: number;
  threshold?: number;
}

/** Full mintable chain, with knobs for every guard under test. */
async function seedChain(orgId: string, merchantId: string, o: SeedOpts): Promise<Chain> {
  const publisherId = await insertReturningId(
    `insert into publishers (org_id, legal_name, country, status, onboarding_state)
     values ($1, $2, 'IN', 'approved', $3) returning id`,
    [orgId, o.publisher, o.onboarding ?? 'active'],
  );
  const propertyId = await insertReturningId(
    `insert into properties (org_id, publisher_id, platform, external_account_id, status)
     values ($1, $2, 'instagram', $3, $4) returning id`,
    [orgId, publisherId, `ig-${o.publisher}`, o.propertyStatus ?? 'approved'],
  );
  const programmeId = await insertReturningId(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'stub-network', $3, $4, 'sale') returning id`,
    [orgId, merchantId, `${o.publisher}-prog`, o.programmeStatus ?? 'active'],
  );
  await pool.query(
    `insert into programme_capabilities (programme_id, countries, currency, allowed_domains)
     values ($1, $2, 'INR', $3)`,
    [programmeId, ['IN'], o.allowedDomains ?? ['shop.example.com']],
  );
  await insertReturningId(
    `insert into contracts (org_id, publisher_id, programme_id, version, publisher_share_bps, payout_threshold_minor, status)
     values ($1, $2, $3, 1, $4, $5, 'approved') returning id`,
    [orgId, publisherId, programmeId, o.bps ?? 7000, String(o.threshold ?? 0)],
  );
  const productId = await insertReturningId(
    `insert into products (org_id, brand, model, category) values ($1, 'brand', 'model', 'cat') returning id`,
    [orgId],
  );
  const variantId = await insertReturningId(`insert into variants (org_id, product_id) values ($1, $2) returning id`, [
    orgId,
    productId,
  ]);
  const offerId = await insertReturningId(
    `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status)
     values ($1, $2, $3, $4, 99900, $5, $6::timestamptz, $7) returning id`,
    [
      orgId,
      variantId,
      programmeId,
      merchantId,
      `https://${o.offerHost ?? 'shop.example.com'}/p`,
      daysFromNow(o.freshDays ?? 30),
      o.offerStatus ?? 'active',
    ],
  );
  const campaignId = await insertReturningId(
    `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, 'camp') returning id`,
    [orgId, publisherId, programmeId],
  );
  const placementId = await insertReturningId(
    `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
     values ($1, $2, $3, 'post', $4) returning id`,
    [orgId, campaignId, propertyId, `plc-${o.publisher}-${randomUUID().slice(0, 8)}`],
  );
  return { publisherId, propertyId, programmeId, offerId, placementId };
}

let chainA: Chain; // ORG_A, fully mintable
let chainB: Chain; // ORG_B, fully mintable
let merchantA: string;

beforeAll(async () => {
  // rollback: true — the kill-switch atomicity test needs ROLLBACK to undo
  // (pg-mem's own does not; see pgmem.ts). Transactions here run one at a time.
  const tdb = createTestDb({ rollback: true });
  pool = new tdb.Pool();

  const dbMod = await import('../src/db.js');
  dbMod.__setPool(pool as unknown as Parameters<typeof dbMod.__setPool>[0]);
  const { buildApp } = await import('../src/index.js');
  app = await buildApp();
  await app.ready();
  redirectApp = await buildRedirectApp({ pool: pool as unknown as Parameters<typeof buildRedirectApp>[0]['pool'] });
  await redirectApp.ready();

  for (const [orgId, slug] of [[ORG_A, 'org-a'], [ORG_B, 'org-b']] as const) {
    await pool.query(`insert into organisations (id, name, slug) values ($1, $2, $3)`, [orgId, slug, slug]);
  }
  for (const u of Object.values(USERS)) {
    await pool.query(`insert into users (id, email) values ($1, $2)`, [u.id, `${u.role}@phase3.example.com`]);
  }
  merchantA = await insertReturningId(`insert into merchants (org_id, name) values ($1, 'mA') returning id`, [ORG_A]);
  const merchantB = await insertReturningId(`insert into merchants (org_id, name) values ($1, 'mB') returning id`, [ORG_B]);

  chainA = await seedChain(ORG_A, merchantA, { publisher: 'Pub A' });
  chainB = await seedChain(ORG_B, merchantB, { publisher: 'Pub B' });
}, 30000);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mintLinkBody(c: Chain) {
  return {
    property_id: c.propertyId,
    programme_id: c.programmeId,
    offer_id: c.offerId,
    placement_id: c.placementId,
  };
}

async function mintLink(c: Chain, orgId: string, user = USERS.OW) {
  return app.inject({
    method: 'POST',
    url: '/v1/links',
    headers: bearer(user, orgId),
    payload: mintLinkBody(c),
  });
}

function conversionBody(txn: string, clickRef: string, overrides: Record<string, unknown> = {}) {
  return {
    provider_account_id: 'acct-1',
    source_transaction_id: txn,
    line_id: `line-${txn}`,
    returned_click_ref: clickRef,
    currency: 'INR',
    eligible_value_minor: 100000,
    commission_minor: 16000,
    provider_status: 'approved',
    provider_revision: 1,
    occurred_at: new Date().toISOString(),
    ...overrides,
  };
}

async function postEvent(body: Record<string, unknown>, orgId: string, user = USERS.ED) {
  return app.inject({
    method: 'POST',
    url: '/v1/integrations/stub-network/events',
    headers: bearer(user, orgId),
    payload: body,
  });
}

async function publisherLiabilityNet(orgId: string, publisherId: string): Promise<number> {
  const { rows } = await pool.query(
    `select coalesce(sum(credit_minor - debit_minor), 0) as net
       from ledger_entries
      where org_id = $1 and account = 'publisher_liability' and publisher_id = $2`,
    [orgId, publisherId],
  );
  return Number(rows[0]!.net);
}

// ---------------------------------------------------------------------------
// tenant isolation
// ---------------------------------------------------------------------------

describe('tenant isolation', () => {
  it("publisher A cannot read publisher B's earnings (404)", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/publisher/earnings?publisher_id=${chainB.publisherId}`,
      headers: bearer(USERS.OW, ORG_A),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it("publisher A cannot mint links against publisher B's property (403 PROPERTY_FORBIDDEN)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/links',
      headers: bearer(USERS.OW, ORG_A),
      payload: {
        property_id: chainB.propertyId,
        programme_id: chainA.programmeId,
        offer_id: chainA.offerId,
        placement_id: chainA.placementId,
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PROPERTY_FORBIDDEN');
  });

  it("publisher A cannot use publisher B's offer in a link (422 OFFER_STALE — scoped lookup)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/links',
      headers: bearer(USERS.OW, ORG_A),
      payload: {
        property_id: chainA.propertyId,
        programme_id: chainA.programmeId,
        offer_id: chainB.offerId,
        placement_id: chainA.placementId,
      },
    });
    // The offer lookup is org-scoped: B's offer is invisible to A, so the
    // mint fails exactly as if the offer did not exist / were stale.
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OFFER_STALE');
  });

  it('GET /v1/offers only returns the caller org’s offers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/offers',
      headers: bearer(USERS.OW, ORG_A),
    });
    expect(res.statusCode).toBe(200);
    const offers = res.json().data as Array<{ id: string }>;
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every((o) => o.id !== chainB.offerId)).toBe(true);
    expect(offers.some((o) => o.id === chainA.offerId)).toBe(true);
  });

  it("org A admin cannot pause org B's programme (404)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/programmes/${chainB.programmeId}/pause`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('dispute lists are tenant-scoped', async () => {
    const inB = await app.inject({
      method: 'POST',
      url: '/v1/disputes',
      headers: bearer(USERS.OW, ORG_B),
      payload: { subject: 'missing commission, org B' },
    });
    expect(inB.statusCode).toBe(201);

    const listA = await app.inject({
      method: 'GET',
      url: '/v1/disputes',
      headers: bearer(USERS.OW, ORG_A),
    });
    const disputes = listA.json().data as Array<{ id: string }>;
    expect(disputes.every((d) => d.id !== String(inB.json().data.id))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// link-creation guards (brief verification table)
// ---------------------------------------------------------------------------

describe('link creation guards', () => {
  it('unapproved property -> 403 PROPERTY_FORBIDDEN', async () => {
    const c = await seedChain(ORG_A, merchantA, {
      publisher: 'Pub UnapprovedProp',
      propertyStatus: 'pending',
    });
    const res = await mintLink(c, ORG_A);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PROPERTY_FORBIDDEN');
  });

  it('pending publisher (onboarding not active) -> 403 PUBLISHER_NOT_ACTIVE', async () => {
    const c = await seedChain(ORG_A, merchantA, {
      publisher: 'Pub Pending',
      onboarding: 'contract', // approved property, but onboarding incomplete
    });
    const res = await mintLink(c, ORG_A);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PUBLISHER_NOT_ACTIVE');
  });

  it('stale offer (status stale) -> 422 OFFER_STALE, no link created', async () => {
    const c = await seedChain(ORG_A, merchantA, {
      publisher: 'Pub StaleOffer',
      offerStatus: 'stale',
    });
    const res = await mintLink(c, ORG_A);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OFFER_STALE');
    const { rows } = await pool.query(`select count(*)::int as n from links where offer_id = $1`, [c.offerId]);
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('expired offer (fresh_until in the past) -> 422 OFFER_STALE', async () => {
    const c = await seedChain(ORG_A, merchantA, {
      publisher: 'Pub ExpiredOffer',
      freshDays: -1,
    });
    const res = await mintLink(c, ORG_A);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('OFFER_STALE');
  });

  it('unsupported merchant URL (host not in programme allow-list) -> 403 PROGRAMME_NOT_APPROVED, no link', async () => {
    const c = await seedChain(ORG_A, merchantA, {
      publisher: 'Pub BadHost',
      offerHost: 'unknown-merchant.example',
      allowedDomains: ['shop.example.com'],
    });
    const res = await mintLink(c, ORG_A);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PROGRAMME_NOT_APPROVED');
    const { rows } = await pool.query(`select count(*)::int as n from links where offer_id = $1`, [c.offerId]);
    expect(Number(rows[0]!.n)).toBe(0);
  });

  it('GET /v1/offers never serves stale offers — no fabricated prices', async () => {
    const stale = await seedChain(ORG_A, merchantA, {
      publisher: 'Pub NeverListed',
      offerStatus: 'stale',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/offers',
      headers: bearer(USERS.OW, ORG_A),
    });
    expect(res.statusCode).toBe(200);
    const offers = res.json().data as Array<{ id: string; price_minor: number }>;
    expect(offers.some((o) => o.id === stale.offerId)).toBe(false);
    // …while live offers keep their merchant-supplied price, verbatim.
    const live = offers.find((o) => o.id === chainA.offerId);
    expect(live?.price_minor).toBe(99900);
  });

  it('stale offer behind an existing link serves the paused page — never a fabricated price', async () => {
    const c = await seedChain(ORG_A, merchantA, { publisher: 'Pub GoesStale', freshDays: 30 });
    const token = randomUUID().replace(/-/g, '');
    await pool.query(
      `insert into links (org_id, token, placement_id, offer_id, route_signature)
       values ($1, $2, $3, $4, 'sig')`,
      [ORG_A, token, c.placementId, c.offerId],
    );
    // Offer goes stale after the link was minted.
    await pool.query(`update offers set status = 'stale' where id = $1`, [c.offerId]);

    const res = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('paused');
  });

  it('consent-denial behaviour: the platform sets no cookies anywhere on the click path', async () => {
    // There is no consent-gated personalization on the hot path: the
    // redirect and link APIs neither read nor write cookies, so denying
    // consent changes nothing observable — documented in ASSUMPTIONS.md.
    const minted = await mintLink(chainA, ORG_A);
    expect(minted.statusCode).toBe(201);
    expect(minted.headers['set-cookie']).toBeUndefined();
    const token = String(minted.json().data.token);

    const r = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
    expect([200, 302]).toContain(r.statusCode);
    expect(r.headers['set-cookie']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// kill switch
// ---------------------------------------------------------------------------

describe('programme kill switch', () => {
  it('pause -> paused page + cache invalidation + blocked minting; resume -> 302 again', async () => {
    const c = await seedChain(ORG_A, merchantA, { publisher: 'Pub KillSwitch' });
    const minted = await mintLink(c, ORG_A);
    expect(minted.statusCode).toBe(201);
    const token = String(minted.json().data.token);

    const before = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
    expect(before.statusCode).toBe(302);

    // Fake Redis to observe the invalidation without a real server.
    const deletedKeys: string[] = [];
    const fakeRedis = {
      get: async (_k: string) => null,
      set: async () => 'OK',
      del: async (...keys: string[]) => {
        deletedKeys.push(...keys);
        return keys.length;
      },
    };
    __setRedis(fakeRedis as unknown as Redis);

    const paused = await app.inject({
      method: 'POST',
      url: `/v1/programmes/${c.programmeId}/pause`,
      headers: bearer(USERS.AD, ORG_A),
    });
    __setRedis(undefined);
    expect(paused.statusCode).toBe(200);
    expect(paused.json().data.status).toBe('paused');
    expect(paused.json().data.redis_available).toBe(true);
    // In-flight redirect cache entry for the programme's link was deleted.
    expect(deletedKeys).toContain(`route:${token}`);

    // Existing links now serve the paused page (no redirect, no click minted).
    const during = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
    expect(during.statusCode).toBe(200);
    expect(during.body).toContain('paused');

    // New link creation is blocked immediately.
    const blocked = await mintLink(c, ORG_A);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PROGRAMME_NOT_APPROVED');

    // Corrections/outbox event + audit trail were emitted.
    const { rows: outbox } = await pool.query(
      `select event_type from outbox where org_id = $1 and event_type = 'programme.paused'`,
      [ORG_A],
    );
    expect(outbox.length).toBeGreaterThan(0);
    const { rows: audit } = await pool.query(
      `select action from audit_log where org_id = $1 and entity = 'programme' and entity_id = $2`,
      [ORG_A, c.programmeId],
    );
    expect(audit.some((r) => r.action === 'programme.pause')).toBe(true);

    // Resume restores the redirect.
    const resumed = await app.inject({
      method: 'POST',
      url: `/v1/programmes/${c.programmeId}/resume`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().data.status).toBe('active');

    const after = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
    expect(after.statusCode).toBe(302);
    expect(String(after.headers.location)).toContain('subid=');
  });

  it('pause is idempotent; resume of a non-paused programme is 409', async () => {
    const c = await seedChain(ORG_A, merchantA, { publisher: 'Pub IdempotentPause' });
    const p1 = await app.inject({
      method: 'POST',
      url: `/v1/programmes/${c.programmeId}/pause`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(p1.statusCode).toBe(200);
    const p2 = await app.inject({
      method: 'POST',
      url: `/v1/programmes/${c.programmeId}/pause`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(p2.statusCode).toBe(200);
    expect(p2.json().data.status).toBe('paused');

    const r1 = await app.inject({
      method: 'POST',
      url: `/v1/programmes/${c.programmeId}/resume`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/programmes/${c.programmeId}/resume`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error.code).toBe('CONFLICT');
  });

  it('a failing audit insert leaves the status unchanged: status + audit + outbox are one transaction', async () => {
    const c = await seedChain(ORG_A, merchantA, { publisher: 'Pub AtomicSwitch' });
    const minted = await mintLink(c, ORG_A);
    expect(minted.statusCode).toBe(201);
    const token = String(minted.json().data.token);

    // A network_admin whose subject is not a users row: audit_log.actor_id
    // references users(id), so the audit insert fails (the runbook's "a
    // subject that is not a user id fails the call").
    const ghost = { id: randomUUID(), role: 'network_admin' };
    const counts = async () => {
      const outbox = await pool.query(
        `select count(*) as n from outbox where org_id = $1 and event_type in ('programme.paused', 'programme.resumed')
            and payload::text like $2`,
        [ORG_A, `%${c.programmeId}%`],
      );
      const audit = await pool.query(
        `select count(*) as n from audit_log where org_id = $1 and entity = 'programme' and entity_id = $2`,
        [ORG_A, c.programmeId],
      );
      return { outbox: Number(outbox.rows[0]!.n), audit: Number(audit.rows[0]!.n) };
    };
    const status = async () =>
      String((await pool.query(`select status from programmes where id = $1`, [c.programmeId])).rows[0]!.status);

    const deletedKeys: string[] = [];
    __setRedis({
      get: async () => null,
      set: async () => 'OK',
      del: async (...keys: string[]) => {
        deletedKeys.push(...keys);
        return keys.length;
      },
    } as unknown as Redis);
    try {
      const failedPause = await app.inject({
        method: 'POST',
        url: `/v1/programmes/${c.programmeId}/pause`,
        headers: bearer(ghost, ORG_A),
      });
      expect(failedPause.statusCode).toBe(500);
      // Nothing took effect: still active, no event, no audit row, the link
      // still redirects, and the cache was not touched (invalidation runs
      // only after a commit).
      expect(await status()).toBe('active');
      expect(await counts()).toEqual({ outbox: 0, audit: 0 });
      expect(deletedKeys).toEqual([]);
      const still = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
      expect(still.statusCode).toBe(302);
      expect(String(still.headers.location)).toContain('subid=');

      // The same for resume: a real admin pauses, the ghost's resume fails
      // and leaves it paused.
      const paused = await app.inject({
        method: 'POST',
        url: `/v1/programmes/${c.programmeId}/pause`,
        headers: bearer(USERS.AD, ORG_A),
      });
      expect(paused.statusCode).toBe(200);
      expect(await counts()).toEqual({ outbox: 1, audit: 1 });
      expect(deletedKeys).toContain(`route:${token}`);
      deletedKeys.length = 0;

      const failedResume = await app.inject({
        method: 'POST',
        url: `/v1/programmes/${c.programmeId}/resume`,
        headers: bearer(ghost, ORG_A),
      });
      expect(failedResume.statusCode).toBe(500);
      expect(await status()).toBe('paused');
      expect(await counts()).toEqual({ outbox: 1, audit: 1 });
      expect(deletedKeys).toEqual([]);
      const during = await redirectApp.inject({ method: 'GET', url: `/r/${token}` });
      expect(during.statusCode).toBe(200);
      expect(during.body).toContain('paused');
    } finally {
      __setRedis(undefined);
    }
  });

  it('non-admin roles cannot pull the kill switch (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/programmes/${chainA.programmeId}/pause`,
      headers: bearer(USERS.ED, ORG_A),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// publisher onboarding state machine
// ---------------------------------------------------------------------------

describe('publisher onboarding', () => {
  const STATES = [
    'application',
    'identity_review',
    'property_verification',
    'programme_eligibility',
    'contract',
    'active',
  ];

  it('walks application -> active one step at a time; skips are 409', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/publishers',
      headers: bearer(USERS.OW, ORG_A),
      payload: { legal_name: 'Onboarding Test Ltd', country: 'IN' },
    });
    expect(created.statusCode).toBe(201);
    const publisherId = String(created.json().data.id);
    expect(created.json().data.onboarding_state).toBe('application');

    const advance = (state: string, user = USERS.AD) =>
      app.inject({
        method: 'POST',
        url: `/v1/publishers/${publisherId}/onboarding/advance`,
        headers: bearer(user, ORG_A),
        payload: { state },
      });

    // Skipping ahead is rejected.
    const skip = await advance('contract');
    expect(skip.statusCode).toBe(409);
    expect(skip.json().error.code).toBe('CONFLICT');

    // Non-admins cannot advance.
    const forbidden = await advance('identity_review', USERS.ED);
    expect(forbidden.statusCode).toBe(403);

    // Walk the full chain.
    for (const state of STATES.slice(1)) {
      const res = await advance(state);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.onboarding_state).toBe(state);
    }

    // Re-advancing to the current state is idempotent.
    const again = await advance('active');
    expect(again.statusCode).toBe(200);
    expect(again.json().data.advanced).toBe(false);

    const got = await app.inject({
      method: 'GET',
      url: `/v1/publishers/${publisherId}`,
      headers: bearer(USERS.OW, ORG_A),
    });
    expect(got.json().data.onboarding_state).toBe('active');
  });

  it('a pending publisher cannot mint links until onboarding reaches active', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/publishers',
      headers: bearer(USERS.OW, ORG_A),
      payload: { legal_name: 'Draft Only Ltd', country: 'IN' },
    });
    const publisherId = String(created.json().data.id);

    // Approved property on a still-pending publisher.
    const propertyId = await insertReturningId(
      `insert into properties (org_id, publisher_id, platform, external_account_id, status)
       values ($1, $2, 'instagram', $3, 'approved') returning id`,
      [ORG_A, publisherId, `ig-draftonly-${randomUUID().slice(0, 8)}`],
    );
    const campaignId = await insertReturningId(
      `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, 'camp') returning id`,
      [ORG_A, publisherId, chainA.programmeId],
    );
    const placementId = await insertReturningId(
      `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
       values ($1, $2, $3, 'post', $4) returning id`,
      [ORG_A, campaignId, propertyId, `plc-draftonly-${randomUUID().slice(0, 8)}`],
    );

    const blocked = await app.inject({
      method: 'POST',
      url: '/v1/links',
      headers: bearer(USERS.OW, ORG_A),
      payload: {
        property_id: propertyId,
        programme_id: chainA.programmeId,
        offer_id: chainA.offerId,
        placement_id: placementId,
      },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PUBLISHER_NOT_ACTIVE');

    // Walk to active, then minting works.
    for (const state of STATES.slice(1)) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/publishers/${publisherId}/onboarding/advance`,
        headers: bearer(USERS.AD, ORG_A),
        payload: { state },
      });
      expect(res.statusCode).toBe(200);
    }
    const allowed = await app.inject({
      method: 'POST',
      url: '/v1/links',
      headers: bearer(USERS.OW, ORG_A),
      payload: {
        property_id: propertyId,
        programme_id: chainA.programmeId,
        offer_id: chainA.offerId,
        placement_id: placementId,
      },
    });
    expect(allowed.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// disputes (missing commission)
// ---------------------------------------------------------------------------

describe('disputes', () => {
  it('opens a missing-commission ticket with no conversion; lists are tenant-scoped', async () => {
    const opened = await app.inject({
      method: 'POST',
      url: '/v1/disputes',
      headers: bearer(USERS.OW, ORG_A),
      payload: {
        kind: 'missing_commission',
        subject: 'Sale on 2026-09-20 never reported',
        claim_ref: 'merchant-order-123',
        evidence: { screenshot_url: 'https://example.com/shot.png' },
      },
    });
    expect(opened.statusCode).toBe(201);
    expect(opened.json().data.status).toBe('open');
    expect(opened.json().data.conversion_id).toBeNull();
    const disputeId = String(opened.json().data.id);

    const list = await app.inject({
      method: 'GET',
      url: '/v1/disputes?kind=missing_commission',
      headers: bearer(USERS.OW, ORG_A),
    });
    expect(list.statusCode).toBe(200);
    expect((list.json().data as Array<{ id: string }>).some((d) => d.id === disputeId)).toBe(true);
  });

  it("a screenshot alone never creates a payable sale: 'resolved' requires provider verification", async () => {
    const opened = await app.inject({
      method: 'POST',
      url: '/v1/disputes',
      headers: bearer(USERS.OW, ORG_A),
      payload: { subject: 'Missing sale, screenshot attached' },
    });
    const disputeId = String(opened.json().data.id);

    const unverified = await app.inject({
      method: 'POST',
      url: `/v1/disputes/${disputeId}/resolve`,
      headers: bearer(USERS.AD, ORG_A),
      payload: {
        outcome: 'resolved',
        resolution_note: 'Publisher sent a screenshot of the order confirmation.',
        provider_verified: false,
      },
    });
    expect(unverified.statusCode).toBe(422);
    expect(unverified.json().error.code).toBe('VALIDATION_ERROR');

    const verified = await app.inject({
      method: 'POST',
      url: `/v1/disputes/${disputeId}/resolve`,
      headers: bearer(USERS.AD, ORG_A),
      payload: {
        outcome: 'resolved',
        resolution_note: 'Provider re-reported the transaction (txn-merchant-order-123) via webhook; matched to click.',
        provider_verified: true,
      },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().data.status).toBe('resolved');

    // Already resolved -> 409.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/disputes/${disputeId}/resolve`,
      headers: bearer(USERS.AD, ORG_A),
      payload: { outcome: 'rejected', resolution_note: 'duplicate review attempt', provider_verified: false },
    });
    expect(again.statusCode).toBe(409);
  });

  it('rejects tickets referencing another org’s conversion (404)', async () => {
    const conv = await postEvent(conversionBody('disp-txn-1', 'disp-click-1'), ORG_B);
    expect(conv.statusCode).toBe(202);
    const conversionId = String(conv.json().data.conversion_id);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/disputes',
      headers: bearer(USERS.OW, ORG_A),
      payload: { conversion_id: conversionId, subject: 'wrong amount?', kind: 'wrong_amount' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('non-admin roles cannot resolve disputes (403)', async () => {
    const opened = await app.inject({
      method: 'POST',
      url: '/v1/disputes',
      headers: bearer(USERS.OW, ORG_A),
      payload: { subject: 'another missing sale' },
    });
    const disputeId = String(opened.json().data.id);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/disputes/${disputeId}/resolve`,
      headers: bearer(USERS.OW, ORG_A),
      payload: { outcome: 'rejected', resolution_note: 'publisher tried to self-resolve', provider_verified: false },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// contract versioning
// ---------------------------------------------------------------------------

describe('contract versioning', () => {
  it('new versions are effective-dated; old conversions keep their v1 snapshot', async () => {
    const c = await seedChain(ORG_A, merchantA, { publisher: 'Pub ContractV' });

    // v1 contract id (seeded approved @7000bps).
    const list1 = await app.inject({
      method: 'GET',
      url: `/v1/contracts?publisher_id=${c.publisherId}&programme_id=${c.programmeId}`,
      headers: bearer(USERS.OW, ORG_A),
    });
    const v1 = (list1.json().data as Array<{ id: string; version: number }>)[0]!;
    expect(v1.version).toBe(1);

    // Conversion under v1: 16000 @7000bps -> publisher 11200.
    const click1 = `cver-click-1`;
    const linkId1 = await insertReturningId(
      `insert into links (org_id, token, placement_id, offer_id, route_signature)
       values ($1, $2, $3, $4, 'sig') returning id`,
      [ORG_A, randomUUID().replace(/-/g, ''), c.placementId, c.offerId],
    );
    await pool.query(`insert into clicks (org_id, link_id, click_id) values ($1, $2, $3)`, [
      ORG_A,
      linkId1,
      click1,
    ]);
    const conv1 = await postEvent(conversionBody('cver-txn-1', click1), ORG_A);
    expect(conv1.statusCode).toBe(202);
    expect(conv1.json().data.ledger).toBe('posted');
    const conv1Id = String(conv1.json().data.conversion_id);

    // v2 with an effective_from earlier than v1's is rejected.
    // (seeded v1 has NULL effective_from, so first give v1 an effective date.)
    await pool.query(`update contracts set effective_from = $2 where id = $1`, [
      v1.id,
      daysFromNow(-10),
    ]);
    const early = await app.inject({
      method: 'POST',
      url: '/v1/contracts',
      headers: bearer(USERS.AD, ORG_A),
      payload: {
        publisher_id: c.publisherId,
        programme_id: c.programmeId,
        publisher_share_bps: 6000,
        payout_threshold_minor: 0,
        effective_from: daysFromNow(-20),
      },
    });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('CONFLICT');

    // Proper v2: 6000bps, effective yesterday.
    const created = await app.inject({
      method: 'POST',
      url: '/v1/contracts',
      headers: bearer(USERS.AD, ORG_A),
      payload: {
        publisher_id: c.publisherId,
        programme_id: c.programmeId,
        publisher_share_bps: 6000,
        payout_threshold_minor: 0,
        effective_from: daysFromNow(-1),
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.version).toBe(2);
    expect(created.json().data.status).toBe('draft');
    const v2Id = String(created.json().data.id);

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/contracts/${v2Id}/approve`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.status).toBe('approved');

    // New conversion uses the v2 split: 16000 @6000bps -> publisher 9600.
    const click2 = `cver-click-2`;
    const linkId2 = await insertReturningId(
      `insert into links (org_id, token, placement_id, offer_id, route_signature)
       values ($1, $2, $3, $4, 'sig') returning id`,
      [ORG_A, randomUUID().replace(/-/g, ''), c.placementId, c.offerId],
    );
    await pool.query(`insert into clicks (org_id, link_id, click_id) values ($1, $2, $3)`, [
      ORG_A,
      linkId2,
      click2,
    ]);
    const conv2 = await postEvent(conversionBody('cver-txn-2', click2), ORG_A);
    expect(conv2.json().data.ledger).toBe('posted');

    // Old conversion keeps its v1 snapshot: still 11200 publisher, v1 id pinned.
    const { rows: snap } = await pool.query(
      `select contract_version_id from conversions where id = $1`,
      [conv1Id],
    );
    expect(String(snap[0]!.contract_version_id)).toBe(v1.id);
    expect(await publisherLiabilityNet(ORG_A, c.publisherId)).toBe(11200 + 9600);

    // A v3 with a FUTURE effective_from does not take effect yet.
    const future = await app.inject({
      method: 'POST',
      url: '/v1/contracts',
      headers: bearer(USERS.AD, ORG_A),
      payload: {
        publisher_id: c.publisherId,
        programme_id: c.programmeId,
        publisher_share_bps: 5000,
        payout_threshold_minor: 0,
        effective_from: daysFromNow(30),
      },
    });
    expect(future.statusCode).toBe(201);
    const v3Id = String(future.json().data.id);
    const approved3 = await app.inject({
      method: 'POST',
      url: `/v1/contracts/${v3Id}/approve`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(approved3.statusCode).toBe(200);

    const click3 = `cver-click-3`;
    const linkId3 = await insertReturningId(
      `insert into links (org_id, token, placement_id, offer_id, route_signature)
       values ($1, $2, $3, $4, 'sig') returning id`,
      [ORG_A, randomUUID().replace(/-/g, ''), c.placementId, c.offerId],
    );
    await pool.query(`insert into clicks (org_id, link_id, click_id) values ($1, $2, $3)`, [
      ORG_A,
      linkId3,
      click3,
    ]);
    const conv3 = await postEvent(conversionBody('cver-txn-3', click3), ORG_A);
    expect(conv3.json().data.ledger).toBe('posted');
    // Still the v2 split (9600), not the future v3 (8000).
    expect(await publisherLiabilityNet(ORG_A, c.publisherId)).toBe(11200 + 9600 + 9600);
  });

  it('creating a contract for another org’s publisher is 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/contracts',
      headers: bearer(USERS.AD, ORG_A),
      payload: {
        publisher_id: chainB.publisherId,
        programme_id: chainA.programmeId,
        publisher_share_bps: 7000,
        payout_threshold_minor: 0,
        effective_from: new Date().toISOString(),
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('only drafts can be approved; double approval is 409', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/contracts',
      headers: bearer(USERS.ED, ORG_A),
      payload: {
        publisher_id: chainA.publisherId,
        programme_id: chainA.programmeId,
        publisher_share_bps: 6500,
        payout_threshold_minor: 0,
        effective_from: new Date().toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const id = String(created.json().data.id);

    // editor cannot approve (network_admin only).
    const forbidden = await app.inject({
      method: 'POST',
      url: `/v1/contracts/${id}/approve`,
      headers: bearer(USERS.ED, ORG_A),
    });
    expect(forbidden.statusCode).toBe(403);

    const okOnce = await app.inject({
      method: 'POST',
      url: `/v1/contracts/${id}/approve`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(okOnce.statusCode).toBe(200);
    const okTwice = await app.inject({
      method: 'POST',
      url: `/v1/contracts/${id}/approve`,
      headers: bearer(USERS.AD, ORG_A),
    });
    expect(okTwice.statusCode).toBe(409);
  });
});
