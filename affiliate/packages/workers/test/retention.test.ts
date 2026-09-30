import { describe, expect, it, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDatabase } from '../../api/test/pgmem.js';
import { runRetentionPurge } from '../src/retention/purge.js';
import {
  loadRetentionConfig,
  type RetentionConfig,
} from '../src/retention/config.js';
import { postLedgerForConversionMirror } from '../src/ledger-mirror.js';

/**
 * Tests for the DPDP retention purge (src/retention/).
 *
 * No Redis is involved: runRetentionPurge takes a pg Pool directly, so the
 * tests exercise the real purge path (per-org transactions, audit rows)
 * against pg-mem. Each test seeds its own organisation, so no table cleanup
 * is needed between tests — the purge loops ALL orgs, and every assertion is
 * scoped to the test's own org_id.
 */

type PgMemPool = TestDatabase['Pool'] extends new () => infer P ? P : never;

let tdb: TestDatabase;
let pool: PgMemPool;

const OLD = `now() - interval '400 days'`;
const RECENT = `now() - interval '10 days'`;
const ANCIENT = `now() - interval '800 days'`;

function config(overrides: Partial<RetentionConfig> = {}): RetentionConfig {
  return {
    clickContextDays: 365,
    conversionRawDays: 365,
    outboxDays: 365,
    cron: '0 3 * * *',
    ...overrides,
  };
}

interface Chain {
  orgId: string;
  publisherId: string;
  programmeId: string;
  linkId: string;
  contractId: string;
}

/** Minimal attribution chain: org -> merchant/programme, publisher -> ... -> link, approved contract. */
async function seedChain(slug: string, shareBps = 7000): Promise<Chain> {
  const orgId = randomUUID();
  await pool.query(`insert into organisations (id, name, slug) values ($1, $2, $3)`, [
    orgId,
    `Retention ${slug}`,
    `retention-${slug}-${orgId.slice(0, 8)}`,
  ]);
  const merchant = await pool.query(
    `insert into merchants (org_id, name) values ($1, 'M') returning id`,
    [orgId],
  );
  const merchantId = String(merchant.rows[0]!.id);
  const programme = await pool.query(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis)
     values ($1, $2, 'stub-network', 'P', 'active', 'sale') returning id`,
    [orgId, merchantId],
  );
  const programmeId = String(programme.rows[0]!.id);
  const publisher = await pool.query(
    `insert into publishers (org_id, legal_name, country, status) values ($1, 'Pub', 'IN', 'approved') returning id`,
    [orgId],
  );
  const publisherId = String(publisher.rows[0]!.id);
  const property = await pool.query(
    `insert into properties (org_id, publisher_id, platform, external_account_id, status)
     values ($1, $2, 'instagram', $3, 'approved') returning id`,
    [orgId, publisherId, `ig-${slug}`],
  );
  const campaign = await pool.query(
    `insert into campaigns (org_id, publisher_id, programme_id, name) values ($1, $2, $3, 'c1') returning id`,
    [orgId, publisherId, programmeId],
  );
  const placement = await pool.query(
    `insert into placements (org_id, campaign_id, property_id, channel, placement_key)
     values ($1, $2, $3, 'post', $4) returning id`,
    [orgId, String(campaign.rows[0]!.id), String(property.rows[0]!.id), `plc-${slug}`],
  );
  const product = await pool.query(
    `insert into products (org_id, brand, model, category) values ($1, 'b', 'm', 'c') returning id`,
    [orgId],
  );
  const variant = await pool.query(`insert into variants (org_id, product_id) values ($1, $2) returning id`, [
    orgId,
    String(product.rows[0]!.id),
  ]);
  const offer = await pool.query(
    `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status)
     values ($1, $2, $3, $4, 99900, 'https://example.com/p', now() + interval '1 day', 'active') returning id`,
    [orgId, String(variant.rows[0]!.id), programmeId, merchantId],
  );
  const link = await pool.query(
    `insert into links (org_id, token, placement_id, offer_id, route_signature)
     values ($1, $2, $3, $4, 'sig') returning id`,
    [orgId, `tok-${slug}`, String(placement.rows[0]!.id), String(offer.rows[0]!.id)],
  );
  const contract = await pool.query(
    `insert into contracts (org_id, publisher_id, programme_id, version, publisher_share_bps, status)
     values ($1, $2, $3, 1, $4, 'approved') returning id`,
    [orgId, publisherId, programmeId, shareBps],
  );
  return {
    orgId,
    publisherId,
    programmeId,
    linkId: String(link.rows[0]!.id),
    contractId: String(contract.rows[0]!.id),
  };
}

async function insertClick(
  chain: Chain,
  clickRef: string,
  occurredAtSql: string,
  context: Record<string, unknown> | null,
): Promise<string> {
  const { rows } = await pool.query(
    `insert into clicks (org_id, link_id, click_id, occurred_at, context)
     values ($1, $2, $3, ${occurredAtSql}, $4::jsonb) returning id`,
    [chain.orgId, chain.linkId, clickRef, context === null ? null : JSON.stringify(context)],
  );
  return String(rows[0]!.id);
}

async function insertConversion(
  chain: Chain,
  clickPk: string | null,
  txn: string,
  status: 'pending' | 'approved',
  receivedAtSql: string,
  raw: Record<string, unknown> | null,
  commissionMinor = 16000,
): Promise<string> {
  const { rows } = await pool.query(
    `insert into conversions
       (org_id, programme_id, provider_account_id, source_transaction_id, line_id,
        click_id, currency, eligible_value_minor, commission_minor,
        provider_status, provider_revision, status, occurred_at, received_at, raw)
     values
       ($1, $2, 'acct-1', $3, $4, $5, 'INR', 100000, $6,
        'approved', 1, $7, ${receivedAtSql}, ${receivedAtSql}, $8::jsonb)
     returning id`,
    [
      chain.orgId,
      chain.programmeId,
      txn,
      `line-${txn}`,
      clickPk,
      commissionMinor,
      status,
      raw === null ? null : JSON.stringify(raw),
    ],
  );
  return String(rows[0]!.id);
}

/**
 * Publisher-statement snapshot mirroring GET /v1/publisher/earnings:
 * approved = net publisher_liability from ledger_entries (credits - debits);
 * pending  = attributable pending conversions x latest approved contract share.
 * Money is summed in JS with Number() coercion (pg-mem bigint typing quirk).
 */
async function statementSnapshot(chain: Chain): Promise<string> {
  const ledger = await pool.query(
    `select currency, debit_minor, credit_minor from ledger_entries
      where org_id = $1 and publisher_id = $2 and account = 'publisher_liability'`,
    [chain.orgId, chain.publisherId],
  );
  const approved: Record<string, number> = {};
  for (const r of ledger.rows) {
    const cur = String(r.currency);
    approved[cur] = (approved[cur] ?? 0) + (Number(r.credit_minor) - Number(r.debit_minor));
  }

  const pendingConvs = await pool.query(
    `select c.currency as currency, c.commission_minor as commission_minor,
            o.programme_id as programme_id
       from conversions c
       join clicks cl      on cl.id = c.click_id        and cl.org_id = $1
       join links l        on l.id = cl.link_id         and l.org_id = $1
       join placements pl  on pl.id = l.placement_id    and pl.org_id = $1
       join campaigns ca   on ca.id = pl.campaign_id    and ca.org_id = $1
       join offers o       on o.id = l.offer_id         and o.org_id = $1
      where c.org_id = $1 and ca.publisher_id = $2 and c.status = 'pending'
      order by c.currency, c.commission_minor`,
    [chain.orgId, chain.publisherId],
  );
  const contracts = await pool.query(
    `select programme_id, publisher_share_bps, version from contracts
      where org_id = $1 and publisher_id = $2 and status = 'approved' order by version desc`,
    [chain.orgId, chain.publisherId],
  );
  const bpsByProgramme = new Map<string, number>();
  for (const r of contracts.rows) {
    const pid = String(r.programme_id);
    if (!bpsByProgramme.has(pid)) bpsByProgramme.set(pid, Number(r.publisher_share_bps));
  }
  const pending: Record<string, number> = {};
  for (const r of pendingConvs.rows) {
    const bps = bpsByProgramme.get(String(r.programme_id)) ?? 10000;
    const cur = String(r.currency);
    pending[cur] =
      (pending[cur] ?? 0) + Math.floor((Number(r.commission_minor) * bps) / 10000);
  }

  return JSON.stringify({ approved, pending });
}

async function tableCount(table: string, orgId: string): Promise<number> {
  const { rows } = await pool.query(`select count(*)::int as n from ${table} where org_id = $1`, [
    orgId,
  ]);
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  tdb = createTestDb();
  pool = new tdb.Pool();
});

describe('retention purge', () => {
  it('(a) nulls payloads older than the window, leaves newer rows untouched', async () => {
    const chain = await seedChain('aging');
    const oldClick = await insertClick(chain, 'click-old-1', OLD, { ua: 'old-agent' });
    const newClick = await insertClick(chain, 'click-new-1', RECENT, { ua: 'new-agent' });
    const oldConv = await insertConversion(chain, oldClick, 'txn-old-1', 'approved', OLD, {
      provider: 'old-blob',
    });
    const newConv = await insertConversion(chain, newClick, 'txn-new-1', 'approved', RECENT, {
      provider: 'new-blob',
    });

    const results = await runRetentionPurge(
      pool as unknown as Parameters<typeof runRetentionPurge>[0],
      config(),
    );
    const mine = results.find((r) => r.org_id === chain.orgId)!;
    expect(mine.classes.find((c) => c.class === 'click_context')!.rows_affected).toBe(1);
    expect(mine.classes.find((c) => c.class === 'conversion_raw')!.rows_affected).toBe(1);

    const clicks = await pool.query(`select id, context from clicks where org_id = $1 order by id`, [
      chain.orgId,
    ]);
    const byId = new Map(clicks.rows.map((r) => [String(r.id), r.context]));
    expect(byId.get(oldClick)).toBeNull();
    expect(byId.get(newClick)).toEqual({ ua: 'new-agent' });

    const convs = await pool.query(`select id, raw from conversions where org_id = $1 order by id`, [
      chain.orgId,
    ]);
    const convById = new Map(convs.rows.map((r) => [String(r.id), r.raw]));
    expect(convById.get(oldConv)).toBeNull();
    expect(convById.get(newConv)).toEqual({ provider: 'new-blob' });
  });

  it('(b) never touches ledger_entries, audit_log or adjustments — even when ancient', async () => {
    const chain = await seedChain('sacred');
    const clickPk = await insertClick(chain, 'click-sacred-1', ANCIENT, { ua: 'x' });
    const convId = await insertConversion(chain, clickPk, 'txn-sacred-1', 'approved', ANCIENT, {
      blob: 1,
    });

    // Ancient financial/governance rows that must survive any purge.
    await pool.query(
      `insert into ledger_entries
         (org_id, currency, account, debit_minor, credit_minor, conversion_id,
          publisher_id, contract_version_id, idempotency_key, created_at)
       values ($1, 'INR', 'publisher_liability', 0, 11200, $2, $3, $4, $5, ${ANCIENT})`,
      [chain.orgId, convId, chain.publisherId, chain.contractId, `ancient-ledger-${chain.orgId}`],
    );
    await pool.query(
      `insert into audit_log (org_id, actor_id, action, entity, entity_id, created_at)
       values ($1, null, 'test.ancient', 'x', 'y', ${ANCIENT})`,
      [chain.orgId],
    );
    await pool.query(
      `insert into adjustments (org_id, conversion_id, kind, commission_delta_minor, reason, created_at)
       values ($1, $2, 'reversal', 100, 'ancient', ${ANCIENT})`,
      [chain.orgId, convId],
    );

    const ledgerBefore = await pool.query(
      `select * from ledger_entries where org_id = $1 order by id`,
      [chain.orgId],
    );
    const adjBefore = await pool.query(`select * from adjustments where org_id = $1 order by id`, [
      chain.orgId,
    ]);
    const auditBefore = await pool.query(
      `select * from audit_log where org_id = $1 and action = 'test.ancient'`,
      [chain.orgId],
    );

    // Window 0: purge every payload in sight. The sacred tables must not move.
    await runRetentionPurge(
      pool as unknown as Parameters<typeof runRetentionPurge>[0],
      config({ clickContextDays: 0, conversionRawDays: 0, outboxDays: 0 }),
    );

    expect(await tableCount('ledger_entries', chain.orgId)).toBe(ledgerBefore.rows.length);
    const ledgerAfter = await pool.query(
      `select * from ledger_entries where org_id = $1 order by id`,
      [chain.orgId],
    );
    expect(JSON.stringify(ledgerAfter.rows)).toBe(JSON.stringify(ledgerBefore.rows));

    expect(await tableCount('adjustments', chain.orgId)).toBe(adjBefore.rows.length);
    const adjAfter = await pool.query(`select * from adjustments where org_id = $1 order by id`, [
      chain.orgId,
    ]);
    expect(JSON.stringify(adjAfter.rows)).toBe(JSON.stringify(adjBefore.rows));

    // The pre-existing audit row is untouched; the purge only ADDS its own rows.
    const auditAfter = await pool.query(
      `select * from audit_log where org_id = $1 and action = 'test.ancient'`,
      [chain.orgId],
    );
    expect(JSON.stringify(auditAfter.rows)).toBe(JSON.stringify(auditBefore.rows));
  });

  it('(c) publisher statements are reproducible after the purge (ledger-derived, payload-independent)', async () => {
    const chain = await seedChain('statement');
    const clickPk = await insertClick(chain, 'click-stmt-1', RECENT, { ua: 'stmt-agent' });
    const approvedId = await insertConversion(chain, clickPk, 'txn-stmt-approved', 'approved', RECENT, {
      provider: 'raw-blob',
    });
    await insertConversion(chain, clickPk, 'txn-stmt-pending', 'pending', RECENT, {
      provider: 'raw-blob-2',
    });

    const posted = await postLedgerForConversionMirror(
      pool as unknown as Parameters<typeof postLedgerForConversionMirror>[0],
      {
        id: approvedId,
        org_id: chain.orgId,
        programme_id: chain.programmeId,
        click_id: clickPk,
        currency: 'INR',
        commission_minor: '16000',
      },
    );
    expect(posted).toBe('posted');

    const before = await statementSnapshot(chain);
    // 16000 @7000bps -> publisher 11200 approved; pending floor(16000*7000/10000)=11200.
    expect(JSON.parse(before)).toEqual({ approved: { INR: 11200 }, pending: { INR: 11200 } });
    const ledgerCountBefore = await tableCount('ledger_entries', chain.orgId);

    // Window 0 purges every payload; balances must not move.
    await runRetentionPurge(
      pool as unknown as Parameters<typeof runRetentionPurge>[0],
      config({ clickContextDays: 0, conversionRawDays: 0, outboxDays: 0 }),
    );

    expect(await statementSnapshot(chain)).toBe(before);
    expect(await tableCount('ledger_entries', chain.orgId)).toBe(ledgerCountBefore);

    // And the purge really ran: payloads are gone, rows and money intact.
    const { rows: convRows } = await pool.query(`select raw from conversions where org_id = $1`, [
      chain.orgId,
    ]);
    expect(convRows.every((r) => r.raw === null)).toBe(true);
    const { rows: clickRows } = await pool.query(`select context from clicks where org_id = $1`, [
      chain.orgId,
    ]);
    expect(clickRows.every((r) => r.context === null)).toBe(true);
  });

  it('(d) writes one audit_log row per class with window + count, actor NULL', async () => {
    const chain = await seedChain('audit');
    const c1 = await insertClick(chain, 'click-audit-1', OLD, { ua: 'a' });
    await insertClick(chain, 'click-audit-2', OLD, { ua: 'b' });
    await insertClick(chain, 'click-audit-3', RECENT, { ua: 'c' });
    await insertConversion(chain, c1, 'txn-audit-1', 'approved', OLD, { blob: 1 });
    await pool.query(
      `insert into outbox (org_id, event_type, payload, payload_hash, occurred_at, published_at)
       values ($1, 'test.evt', '{}'::jsonb, 'h', ${OLD}, ${OLD})`,
      [chain.orgId],
    );

    await runRetentionPurge(
      pool as unknown as Parameters<typeof runRetentionPurge>[0],
      config(),
    );

    const { rows } = await pool.query(
      `select entity, entity_id, actor_id from audit_log
        where org_id = $1 and action = 'retention.purge' order by entity`,
      [chain.orgId],
    );
    expect(rows.map((r) => r.entity)).toEqual(['click_context', 'conversion_raw', 'outbox', 'reply_events']);
    for (const r of rows) {
      expect(r.actor_id).toBeNull();
      const summary = JSON.parse(String(r.entity_id)) as {
        window_days: number;
        rows_affected: number;
      };
      // reply_events: the 30-day placeholder (config() leaves it unset)
      expect(summary.window_days).toBe(r.entity === 'reply_events' ? 30 : 365);
      expect(typeof summary.rows_affected).toBe('number');
    }
    const byClass = new Map(rows.map((r) => [String(r.entity), JSON.parse(String(r.entity_id))]));
    expect((byClass.get('click_context') as { rows_affected: number }).rows_affected).toBe(2);
    expect((byClass.get('conversion_raw') as { rows_affected: number }).rows_affected).toBe(1);
    expect((byClass.get('outbox') as { rows_affected: number }).rows_affected).toBe(1);
  });

  it('(e) deletes only published outbox rows older than the window', async () => {
    const chain = await seedChain('outbox');
    await pool.query(
      `insert into outbox (org_id, event_type, payload, payload_hash, occurred_at, published_at)
       values
         ($1, 'test.old-published', '{}'::jsonb, 'h1', ${OLD}, ${OLD}),
         ($1, 'test.recent-published', '{}'::jsonb, 'h2', ${RECENT}, ${RECENT}),
         ($1, 'test.old-unpublished', '{}'::jsonb, 'h3', ${OLD}, null)`,
      [chain.orgId],
    );

    await runRetentionPurge(
      pool as unknown as Parameters<typeof runRetentionPurge>[0],
      config(),
    );

    const { rows } = await pool.query(
      `select event_type from outbox where org_id = $1 order by event_type`,
      [chain.orgId],
    );
    expect(rows.map((r) => r.event_type)).toEqual([
      'test.old-unpublished',
      'test.recent-published',
    ]);
  });

  it('is tenant-aware: one run purges per org and audits per org', async () => {
    const chainA = await seedChain('tenant-a');
    const chainB = await seedChain('tenant-b');
    const chainEmpty = await seedChain('tenant-empty');
    await insertClick(chainA, 'click-tenant-a', OLD, { ua: 'a' });
    await insertClick(chainB, 'click-tenant-b', OLD, { ua: 'b' });

    const results = await runRetentionPurge(
      pool as unknown as Parameters<typeof runRetentionPurge>[0],
      config(),
    );
    const byOrg = new Map(results.map((r) => [r.org_id, r]));
    expect(byOrg.get(chainA.orgId)!.classes.find((c) => c.class === 'click_context')!.rows_affected).toBe(1);
    expect(byOrg.get(chainB.orgId)!.classes.find((c) => c.class === 'click_context')!.rows_affected).toBe(1);
    // An org with nothing to purge still gets its audit rows (rows_affected 0).
    expect(
      byOrg.get(chainEmpty.orgId)!.classes.every((c) => c.rows_affected === 0),
    ).toBe(true);

    for (const chain of [chainA, chainB, chainEmpty]) {
      const { rows } = await pool.query(`select context from clicks where org_id = $1`, [
        chain.orgId,
      ]);
      expect(rows.every((r) => r.context === null)).toBe(true);
      // Audit rows land on the org they describe — one per class per org per run.
      const audit = await pool.query(
        `select entity from audit_log
          where org_id = $1 and action = 'retention.purge' order by entity`,
        [chain.orgId],
      );
      expect(audit.rows.map((r) => r.entity)).toEqual([
        'click_context',
        'conversion_raw',
        'outbox',
        'reply_events',
      ]);
    }
  });

  it('(f) deletes comment-reply events older than their window; keeps the opt-out list and the daily counts', async () => {
    const chain = await seedChain('replies');
    const prop = await pool.query(`select id from properties where org_id = $1 limit 1`, [chain.orgId]);
    const propertyId = String(prop.rows[0]!.id);
    const celeb = await pool.query(
      `insert into celebrities (org_id, name, name_key, slug) values ($1, 'Demo Star Ret', 'demo star ret', 'demo-star-ret') returning id`,
      [chain.orgId],
    );
    const look = await pool.query(`insert into looks (org_id, title, celebrity_id) values ($1, 'Demo', $2) returning id`, [chain.orgId, celeb.rows[0]!.id]);
    const rule = await pool.query(
      `insert into reply_rules (org_id, look_id, property_id, platform_post_id, keywords) values ($1, $2, $3, 'p', $4) returning id`,
      [chain.orgId, look.rows[0]!.id, propertyId, ['link']],
    );
    for (const [comment, at] of [
      ['ret-old', `now() - interval '40 days'`],
      ['ret-new', `now() - interval '2 days'`],
    ] as const) {
      await pool.query(
        `insert into reply_events (org_id, rule_id, property_id, platform, meta_account_id, comment_id, commenter_hash, matched_keyword, status, received_at)
         values ($1, $2, $3, 'instagram', '1', $4, $5, 'link', 'sent', ${at})`,
        [chain.orgId, rule.rows[0]!.id, propertyId, comment, 'b'.repeat(64)],
      );
    }
    await pool.query(`insert into reply_suppressions (org_id, platform, commenter_hash) values ($1, 'instagram', $2)`, [chain.orgId, 'c'.repeat(64)]);
    await pool.query(`insert into reply_daily (org_id, day, rule_id, received, sent) values ($1, '2026-08-01', $2, 1, 1)`, [chain.orgId, rule.rows[0]!.id]);
    const results = await runRetentionPurge(pool as unknown as Parameters<typeof runRetentionPurge>[0], config());
    const mine = results.find((r) => r.org_id === chain.orgId)!;
    expect(mine.classes.find((c) => c.class === 'reply_events')).toEqual({ class: 'reply_events', window_days: 30, rows_affected: 1 });
    const left = await pool.query(`select comment_id from reply_events where org_id = $1`, [chain.orgId]);
    expect(left.rows.map((r) => r.comment_id)).toEqual(['ret-new']);
    expect(await tableCount('reply_suppressions', chain.orgId)).toBe(1);
    expect(await tableCount('reply_daily', chain.orgId)).toBe(1);
  });

  it('dry-run reports counts without writing anything', async () => {
    const chain = await seedChain('dryrun');
    await insertClick(chain, 'click-dry-1', OLD, { ua: 'dry' });
    await insertConversion(chain, null, 'txn-dry-1', 'approved', OLD, { blob: 1 });

    const results = await runRetentionPurge(
      pool as unknown as Parameters<typeof runRetentionPurge>[0],
      config(),
      { dryRun: true },
    );
    const mine = results.find((r) => r.org_id === chain.orgId)!;
    expect(mine.dry_run).toBe(true);
    expect(mine.classes.find((c) => c.class === 'click_context')!.rows_affected).toBe(1);
    expect(mine.classes.find((c) => c.class === 'conversion_raw')!.rows_affected).toBe(1);

    const { rows: clicks } = await pool.query(`select context from clicks where org_id = $1`, [
      chain.orgId,
    ]);
    expect(clicks[0]!.context).toEqual({ ua: 'dry' });
    const { rows: convs } = await pool.query(`select raw from conversions where org_id = $1`, [
      chain.orgId,
    ]);
    expect(convs[0]!.raw).toEqual({ blob: 1 });
    expect(await tableCount('audit_log', chain.orgId)).toBe(0);
  });
});

describe('retention config', () => {
  it('defaults to 365-day conservative windows (comment-reply events: a 30-day placeholder)', () => {
    const cfg = loadRetentionConfig({});
    expect(cfg).toEqual({
      clickContextDays: 365,
      conversionRawDays: 365,
      outboxDays: 365,
      replyEventsDays: 30,
      cron: '0 3 * * *',
    });
    expect(loadRetentionConfig({ RETENTION_REPLY_EVENTS_DAYS: '7' }).replyEventsDays).toBe(7);
  });

  it('honours env overrides', () => {
    const cfg = loadRetentionConfig({
      RETENTION_CLICK_CONTEXT_DAYS: '90',
      RETENTION_CONVERSION_RAW_DAYS: '180',
      RETENTION_OUTBOX_DAYS: '30',
      RETENTION_CRON: '0 4 * * 0',
    });
    expect(cfg.clickContextDays).toBe(90);
    expect(cfg.conversionRawDays).toBe(180);
    expect(cfg.outboxDays).toBe(30);
    expect(cfg.cron).toBe('0 4 * * 0');
  });

  it('falls back to defaults on invalid windows (never widens silently)', () => {
    const cfg = loadRetentionConfig({
      RETENTION_CLICK_CONTEXT_DAYS: 'not-a-number',
      RETENTION_CONVERSION_RAW_DAYS: '-5',
      RETENTION_OUTBOX_DAYS: '1.5',
    });
    expect(cfg.clickContextDays).toBe(365);
    expect(cfg.conversionRawDays).toBe(365);
    expect(cfg.outboxDays).toBe(365);
  });

  it('allows an explicit 0-day window', () => {
    const cfg = loadRetentionConfig({ RETENTION_CLICK_CONTEXT_DAYS: '0' });
    expect(cfg.clickContextDays).toBe(0);
  });
});
