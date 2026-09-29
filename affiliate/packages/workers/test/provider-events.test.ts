import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { buildEnvelope, type EventEnvelope } from '@paparazzi/shared';
import { createProviderEventsProcessor, type ProviderEventsJobData } from '../src/workers/provider-events.js';
import { createTestDb, type TestDatabase } from '../../api/test/pgmem.js';

/**
 * Tests for the provider-events worker's normalisation core.
 *
 * No Redis is involved: we call the processor function returned by
 * createProviderEventsProcessor directly with a fake job. The pool is a
 * pg-mem in-memory Postgres (see packages/api/test/pgmem.ts).
 */

type PgMemPool = TestDatabase['Pool'] extends new () => infer P ? P : never;

let tdb: TestDatabase;
let pool: PgMemPool;
let processEvent: (job: { id: string; data: ProviderEventsJobData }) => Promise<void>;

const ORG_ID = '22222222-2222-2222-2222-222222222222';
let programmeId: string;
let knownClickRef: string;

function rawConversion(overrides: Record<string, unknown> = {}) {
  return {
    provider_account_id: 'acct-1',
    source_transaction_id: 'txn-1',
    line_id: 'line-1',
    returned_click_ref: null,
    currency: 'INR',
    eligible_value_minor: 100000,
    commission_minor: 16000,
    provider_status: 'approved',
    provider_revision: 1,
    occurred_at: '2026-09-20T10:00:00.000Z',
    received_at: '2026-09-20T10:00:05.000Z',
    raw: { source: 'fixture' },
    ...overrides,
  };
}

function makeJob(envelope: EventEnvelope): { id: string; data: ProviderEventsJobData } {
  return { id: 'j1', data: { envelope, org_id: ORG_ID, programme_id: programmeId } };
}

async function count(table: string): Promise<number> {
  const { rows } = await pool.query(`select count(*)::int as n from ${table}`);
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  tdb = createTestDb();
  pool = new tdb.Pool();
  // The processor is typed against pg's Pool; pg-mem's adapter is wire-compatible.
  processEvent = createProviderEventsProcessor(pool as unknown as Parameters<typeof createProviderEventsProcessor>[0]);

  await pool.query(`insert into organisations (id, name, slug) values ($1, 'Test Org', 'test-org')`, [ORG_ID]);
  const merchant = await pool.query(
    `insert into merchants (org_id, name) values ($1, 'Test Merchant') returning id`,
    [ORG_ID],
  );
  const programme = await pool.query(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'stub-network', 'Test Programme', 'active', 'sale') returning id`,
    [ORG_ID, String(merchant.rows[0]!.id)],
  );
  programmeId = String(programme.rows[0]!.id);

  // Minimal attribution chain so one test can assert a KNOWN click ref resolves.
  const publisher = await pool.query(
    `insert into publishers (org_id, legal_name, country, status) values ($1, 'Pub', 'IN', 'approved') returning id`,
    [ORG_ID],
  );
  const publisherId = String(publisher.rows[0]!.id);
  const property = await pool.query(
    `insert into properties (org_id, publisher_id, platform, external_account_id, status)
     values ($1, $2, 'instagram', 'ig-1', 'approved') returning id`,
    [ORG_ID, publisherId],
  );
  const campaign = await pool.query(
    `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, 'c1') returning id`,
    [ORG_ID, publisherId, programmeId],
  );
  const placement = await pool.query(
    `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
     values ($1, $2, $3, 'post', 'plc-1') returning id`,
    [ORG_ID, String(campaign.rows[0]!.id), String(property.rows[0]!.id)],
  );
  const product = await pool.query(
    `insert into products (org_id, brand, model, category) values ($1, 'b', 'm', 'c') returning id`,
    [ORG_ID],
  );
  const variant = await pool.query(
    `insert into variants (org_id, product_id) values ($1, $2) returning id`,
    [ORG_ID, String(product.rows[0]!.id)],
  );
  const offer = await pool.query(
    `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status)
     values ($1, $2, $3, $4, 99900, 'https://example.com/p', now() + interval '1 day', 'active') returning id`,
    [ORG_ID, String(variant.rows[0]!.id), programmeId, String(merchant.rows[0]!.id)],
  );
  const link = await pool.query(
    `insert into links (org_id, token, placement_id, offer_id, route_signature)
     values ($1, 'tok-1', $2, $3, 'sig') returning id`,
    [ORG_ID, String(placement.rows[0]!.id), String(offer.rows[0]!.id)],
  );
  knownClickRef = 'click-known-1';
  await pool.query(`insert into clicks (org_id, link_id, click_id) values ($1, $2, $3)`, [
    ORG_ID,
    String(link.rows[0]!.id),
    knownClickRef,
  ]);
});

beforeEach(async () => {
  await pool.query('delete from outbox');
  await pool.query('delete from conversions');
  // NOTE: clicks are NOT cleared — the seeded attribution chain persists.
});

describe('provider-events processor', () => {
  it('drops an envelope whose payload_hash was tampered with and writes nothing', async () => {
    const envelope = buildEnvelope({
      source: 'test',
      event_type: 'conversion.raw',
      payload: rawConversion(),
    });
    // Tamper AFTER the hash was computed.
    (envelope.payload as Record<string, unknown>).commission_minor = 999999;

    await processEvent(makeJob(envelope));

    expect(await count('conversions')).toBe(0);
    expect(await count('outbox')).toBe(0);
  });

  it('stores an unknown returned_click_ref as suspense (click_id NULL) and emits one outbox row', async () => {
    const envelope = buildEnvelope({
      source: 'test',
      event_type: 'conversion.raw',
      payload: rawConversion({ returned_click_ref: 'click-that-does-not-exist' }),
    });

    await processEvent(makeJob(envelope));

    const { rows } = await pool.query(
      `select click_id, status from conversions where source_transaction_id = 'txn-1'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.click_id).toBeNull();
    expect(rows[0]!.status).toBe('approved');

    const outbox = await pool.query(`select event_type from outbox`);
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]!.event_type).toBe('conversion.normalized');
  });

  it('collapses a duplicate delivery to a single conversion row', async () => {
    const envelope = buildEnvelope({
      source: 'test',
      event_type: 'conversion.raw',
      payload: rawConversion(),
    });
    const job = makeJob(envelope);

    await processEvent(job);
    await processEvent(job); // redelivery: webhook retry / webhook+poll overlap

    expect(await count('conversions')).toBe(1);
    expect(await count('outbox')).toBe(1);
  });

  it('resolves a known returned_click_ref to the click row', async () => {
    const envelope = buildEnvelope({
      source: 'test',
      event_type: 'conversion.raw',
      payload: rawConversion({ returned_click_ref: knownClickRef }),
    });
    await processEvent(makeJob(envelope));

    const { rows } = await pool.query(
      `select c.id as click_pk, conv.click_id as conv_click_id
         from conversions conv join clicks c on c.click_id = $1`,
      [knownClickRef],
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.conv_click_id)).toBe(String(rows[0]!.click_pk));
  });
});
