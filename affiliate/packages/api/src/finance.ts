import type { Pool, QueryResult, QueryResultRow } from 'pg';
import {
  AppError,
  assertEntriesBalanced,
  assertMinorUnits,
  buildAdjustmentEntries,
  buildConversionEntries,
  checkBooksBalanced,
  type LedgerEntryDraft,
} from '@paparazzi/shared';

/**
 * Finance: conversion → ledger posting, reversals, payout eligibility,
 * settlement allocation, and the books-balanced gate.
 *
 * Double-entry invariant: every posting writes balanced drafts
 * (assertEntriesBalanced before anything is written; checkBooksBalanced
 * verifies the stored books afterwards).
 *
 * IDEMPOTENCY-KEY CONVENTION (see db/migrations/0002_money_loop.sql):
 * every posting writes several rows that SHARE one posting key
 * ('conv:<conversion_id>', 'adj:<adjustment_id>',
 * 'payout:<batch_id>:<publisher_id>'), and the dedupe unit is
 * (idempotency_key, account) — bare ON CONFLICT DO NOTHING (pg-mem does not
 * honour multi-column arbiters; the only other unique is the uuid pkey, so
 * a skip is always a true duplicate). A plain per-row unique key would
 * persist only the first row of each posting and silently break
 * double-entry.
 */

export interface DbClient {
  query: Pool['query'];
}

/**
 * Build `($k, $k+1, …)` placeholders for an IN list.
 * pg-mem silently returns zero rows for `uuid_col = any($uuid_array)`,
 * so array params are expanded instead (valid on real Postgres too).
 */
function inPlaceholders(count: number, start: number): string {
  return `(${Array.from({ length: count }, (_, i) => `$${start + i}`).join(', ')})`;
}

export interface ConversionRow {
  id: string;
  org_id: string;
  programme_id: string;
  /** clicks.id (PK) — NULL for suspense/unknown-attribution conversions. */
  click_id: string | null;
  /**
   * placements.id when attributed through a tracking-ID mapping instead of a
   * click (Amazon.in Associates; never together with click_id).
   */
  placement_id?: string | null;
  currency: string;
  /** bigint from pg arrives as a string. */
  commission_minor: string;
}

/** bigint-ish (string|number) → validated MinorUnits. */
export function toMinorUnits(value: string | number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  assertMinorUnits(n);
  return n;
}

/** Insert ledger drafts; idempotent per (idempotency_key, account). */
type DraftInput = Omit<LedgerEntryDraft, 'contract_version_id'> & {
  /** Payout completion entries carry no contract version (DB column nullable). */
  contract_version_id?: string | null;
};

async function insertLedgerDrafts(db: DbClient, drafts: DraftInput[]): Promise<void> {
  assertEntriesBalanced(drafts);
  for (const d of drafts) {
    await db.query(
      `insert into ledger_entries
         (org_id, currency, account, debit_minor, credit_minor,
          conversion_id, adjustment_id, contract_version_id, publisher_id,
          idempotency_key, memo)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       -- Bare ON CONFLICT (no arbiter): pg-mem does not honour multi-column
       -- arbiters. Safe: the only other unique is the uuid pkey, and posting
       -- keys are deterministic, so a skip is always a true duplicate.
       on conflict do nothing`,
      [
        d.org_id,
        d.currency,
        d.account,
        String(d.debit_minor),
        String(d.credit_minor),
        d.conversion_id ?? null,
        d.adjustment_id ?? null,
        d.contract_version_id ?? null,
        d.publisher_id ?? null,
        d.idempotency_key,
        d.memo ?? null,
      ],
    );
  }
}

/**
 * Posts ledger entries for an approved conversion.
 *
 * Publisher resolution walks the attribution chain:
 *   conversion.click_id → clicks → links → placements → campaigns.publisher_id
 * or, for a conversion attributed through a tracking-ID mapping (no click):
 *   conversion.placement_id → placements → campaigns.publisher_id
 * — the same chain from its second hop — with the programme being the
 * conversion's own, which must also be the campaign's.
 *
 * Unknown attribution stays unknown: when conversion.click_id is NULL
 * (suspense) we NEVER guess a publisher — the conversion is logged and
 * skipped. Likewise when no approved contract exists for the
 * publisher+programme (TODO: contract onboarding/backfill workflow).
 *
 * On a successful posting, conversions.contract_version_id is set to the
 * contract row used, so reversals can snapshot the ORIGINAL split.
 * Re-posting is a no-op via the (idempotency_key, account) dedupe.
 */
export async function postLedgerForConversion(
  db: DbClient,
  conversion: ConversionRow,
): Promise<'posted' | 'skipped'> {
  let hop: { publisher_id: string; programme_id: string } | undefined;
  if (conversion.click_id) {
    const chain = await db.query<{
      publisher_id: string;
      programme_id: string;
    }>(
      `select ca.publisher_id as publisher_id, o.programme_id as programme_id
         from clicks cl
         join links l        on l.id = cl.link_id       and l.org_id = $1
         join placements pl on pl.id = l.placement_id  and pl.org_id = $1
         join campaigns ca  on ca.id = pl.campaign_id  and ca.org_id = $1
         join offers o      on o.id = l.offer_id       and o.org_id = $1
        where cl.id = $2 and cl.org_id = $1
        limit 1`,
      [conversion.org_id, conversion.click_id],
    );
    hop = chain.rows[0];
  } else if (conversion.placement_id) {
    const chain = await db.query<{ publisher_id: string; programme_id: string }>(
      `select ca.publisher_id as publisher_id, ca.programme_id as programme_id
         from placements pl
         join campaigns ca on ca.id = pl.campaign_id and ca.org_id = $1
        where pl.id = $2 and pl.org_id = $1 and ca.programme_id = $3
        limit 1`,
      [conversion.org_id, conversion.placement_id, conversion.programme_id],
    );
    hop = chain.rows[0];
  } else {
    // Suspense conversion: unattributable by policy. No ledger entries.
    return 'skipped';
  }
  if (!hop) return 'skipped'; // chain broken; do not invent attribution

  // Latest approved contract for this publisher+programme whose
  // effective_from has arrived (null = effective immediately). New contract
  // versions are effective-dated at creation (POST /v1/contracts); a future
  // version must not take effect early.
  const contracts = await db.query<{
    id: string;
    publisher_share_bps: number;
  }>(
    `select id, publisher_share_bps
       from contracts
      where org_id = $1 and publisher_id = $2 and programme_id = $3
        and status = 'approved'
        and (effective_from is null or effective_from <= now())
      order by version desc
      limit 1`,
    [conversion.org_id, hop.publisher_id, hop.programme_id],
  );
  const contract = contracts.rows[0];
  if (!contract) return 'skipped'; // TODO: contract onboarding/backfill workflow

  const drafts = buildConversionEntries({
    org_id: conversion.org_id,
    currency: conversion.currency,
    conversion_id: conversion.id,
    publisher_id: hop.publisher_id,
    contract_version_id: contract.id,
    commission_minor: toMinorUnits(conversion.commission_minor),
    publisher_share_bps: contract.publisher_share_bps,
    memo: `conversion ${conversion.id}`,
  });
  await insertLedgerDrafts(db, drafts);

  // Snapshot the contract version used — reversals must mirror the ORIGINAL
  // split even if the contract has since been superseded.
  await db.query(
    `update conversions set contract_version_id = $2
      where id = $3 and org_id = $1`,
    [conversion.org_id, contract.id, conversion.id],
  );
  return 'posted';
}

export interface AdjustmentReversalInput {
  adjustmentId: string;
  conversionId: string;
}

/**
 * Posts the mirror-image ledger entries for a reversal adjustment.
 *
 * Mirrors postLedgerForConversion: the split (publisher vs platform share)
 * comes from the ORIGINAL contract — conversions.contract_version_id,
 * snapshotted when the conversion was posted — never from the contract
 * current today. Posting key: 'adj:<adjustment_id>'.
 *
 * Returns 'skipped' when the original conversion was never posted (no
 * contract_version_id): there is nothing in the ledger to mirror, so the
 * adjustment row is recorded as a financial fact but no entries are written.
 */
export async function postAdjustmentForReversal(
  db: DbClient,
  input: AdjustmentReversalInput,
): Promise<'posted' | 'skipped'> {
  const adjustments = await db.query<{
    org_id: string;
    commission_delta_minor: string;
  }>(
    `select org_id, commission_delta_minor::text as commission_delta_minor
       from adjustments where id = $1`,
    [input.adjustmentId],
  );
  const adjustment = adjustments.rows[0];
  if (!adjustment) {
    throw new AppError('NOT_FOUND', `Adjustment ${input.adjustmentId} not found`, 404);
  }
  const orgId = adjustment.org_id;

  const conversions = await db.query<{
    currency: string;
    contract_version_id: string | null;
  }>(
    `select currency, contract_version_id
       from conversions where id = $1 and org_id = $2`,
    [input.conversionId, orgId],
  );
  const conversion = conversions.rows[0];
  if (!conversion) {
    throw new AppError('NOT_FOUND', `Conversion ${input.conversionId} not found`, 404);
  }
  if (!conversion.contract_version_id) {
    // Original conversion never posted — nothing to mirror.
    return 'skipped';
  }

  const contracts = await db.query<{
    publisher_id: string;
    publisher_share_bps: number;
  }>(
    `select publisher_id, publisher_share_bps
       from contracts where id = $1 and org_id = $2`,
    [conversion.contract_version_id, orgId],
  );
  const contract = contracts.rows[0];
  if (!contract) return 'skipped'; // original contract row gone; do not invent a split

  // Publisher that the original posting credited (belt-and-braces: prefer the
  // ledger's own record over re-walking the attribution chain).
  const credited = await db.query<{ publisher_id: string | null }>(
    `select publisher_id from ledger_entries
      where org_id = $1 and conversion_id = $2
        and account = 'publisher_liability' and publisher_id is not null
      limit 1`,
    [orgId, input.conversionId],
  );

  const drafts = buildAdjustmentEntries({
    org_id: orgId,
    currency: conversion.currency,
    adjustment_id: input.adjustmentId,
    contract_version_id: conversion.contract_version_id,
    reversal_commission_minor: toMinorUnits(adjustment.commission_delta_minor),
    publisher_share_bps: contract.publisher_share_bps,
    publisher_id: credited.rows[0]?.publisher_id ?? contract.publisher_id,
    memo: `reversal of conversion ${input.conversionId}`,
  });
  await insertLedgerDrafts(db, drafts);
  return 'posted';
}

// ---------------------------------------------------------------------------
// Payout eligibility & settlement allocation
// ---------------------------------------------------------------------------

/**
 * One publisher's eligible earnings slice: approved conversions that are
 * past the programme's returns window, minus reversal adjustments, grouped
 * by (publisher, programme, currency). Unattributable conversions are
 * excluded (unknown attribution stays unknown).
 */
export interface EligibleEarning {
  publisher_id: string;
  programme_id: string;
  currency: string;
  eligible_minor: number;
}

/**
 * Computes eligible earnings per (publisher, programme, currency).
 *
 * Per conversion: publisher share = floor(commission × bps / 10000) using
 * the contract snapshotted on the conversion (contract_version_id), falling
 * back to the latest approved contract for the attributed publisher, then
 * to 100% of commission. Reversal adjustments reduce the same conversion's
 * share using the ORIGINAL bps. Only conversions with
 * occurred_at <= now() − programme.returns_window_days count.
 */
export async function computeEligibleEarnings(
  db: DbClient,
  orgId: string,
  currency?: string,
): Promise<EligibleEarning[]> {
  const convParams: unknown[] = [orgId];
  let currencyFilter = '';
  if (currency) {
    convParams.push(currency.toUpperCase());
    currencyFilter = `and c.currency = $${convParams.length}`;
  }
  const convs = await db.query<{
    id: string;
    programme_id: string;
    currency: string;
    commission_minor: string;
    contract_version_id: string | null;
    click_id: string | null;
    placement_id: string | null;
    /** timestamptz: pg returns string, pg-mem returns Date — both Date-parseable. */
    occurred_at: string | Date;
    returns_window_days: number;
  }>(
    `select c.id, c.programme_id, c.currency,
            c.commission_minor::text as commission_minor,
            c.contract_version_id, c.click_id, c.placement_id,
            c.occurred_at,
            p.returns_window_days as returns_window_days
       from conversions c
       join programmes p on p.id = c.programme_id and p.org_id = $1
      where c.org_id = $1 and c.status = 'approved' ${currencyFilter}`,
    convParams,
  );

  const now = Date.now();
  const mature = convs.rows.filter(
    (c) => new Date(c.occurred_at).getTime() <= now - c.returns_window_days * 86_400_000,
  );
  if (mature.length === 0) return [];

  // Contract splits: snapshotted first, latest-approved as fallback.
  const snapshotIds = [...new Set(mature.map((c) => c.contract_version_id).filter((v): v is string => v !== null))];
  const snapshotBy = new Map<string, { publisher_id: string; publisher_share_bps: number }>();
  if (snapshotIds.length > 0) {
    const snap = await db.query<{ id: string; publisher_id: string; publisher_share_bps: number }>(
      `select id, publisher_id, publisher_share_bps
         from contracts where org_id = $1 and id in ${inPlaceholders(snapshotIds.length, 2)}`,
      [orgId, ...snapshotIds],
    );
    for (const r of snap.rows) {
      snapshotBy.set(r.id, { publisher_id: r.publisher_id, publisher_share_bps: r.publisher_share_bps });
    }
  }

  // Attribution fallback for conversions posted before contract_version_id
  // existed (or posted while unattributed): walk the click chain.
  const chainBy = new Map<string, string>(); // click pk → publisher_id
  const needChain = mature.filter((c) => !c.contract_version_id && c.click_id);
  if (needChain.length > 0) {
    const clickIds = needChain.map((c) => c.click_id as string);
    const chain = await db.query<{ click_pk: string; publisher_id: string }>(
      `select cl.id as click_pk, ca.publisher_id as publisher_id
         from clicks cl
         join links l        on l.id = cl.link_id       and l.org_id = $1
         join placements pl on pl.id = l.placement_id  and pl.org_id = $1
         join campaigns ca  on ca.id = pl.campaign_id  and ca.org_id = $1
        where cl.org_id = $1 and cl.id in ${inPlaceholders(clickIds.length, 2)}`,
      [orgId, ...clickIds],
    );
    for (const r of chain.rows) chainBy.set(r.click_pk, r.publisher_id);
  }
  // Same fallback for conversions attributed through a tracking-ID mapping.
  const placementBy = new Map<string, string>(); // placement pk → publisher_id
  const needPlacement = mature.filter((c) => !c.contract_version_id && !c.click_id && c.placement_id);
  if (needPlacement.length > 0) {
    const placementIds = [...new Set(needPlacement.map((c) => c.placement_id as string))];
    const viaPlacement = await db.query<{ placement_pk: string; publisher_id: string }>(
      `select pl.id as placement_pk, ca.publisher_id as publisher_id
         from placements pl
         join campaigns ca on ca.id = pl.campaign_id and ca.org_id = $1
        where pl.org_id = $1 and pl.id in ${inPlaceholders(placementIds.length, 2)}`,
      [orgId, ...placementIds],
    );
    for (const r of viaPlacement.rows) placementBy.set(r.placement_pk, r.publisher_id);
  }
  const fallbackPublisher = (c: { click_id: string | null; placement_id: string | null }): string | undefined =>
    c.click_id ? chainBy.get(c.click_id) : c.placement_id ? placementBy.get(c.placement_id) : undefined;
  const latestBy = new Map<string, { publisher_id: string; publisher_share_bps: number }>();
  {
    // One query per (publisher, programme) pair — portable across Postgres
    // and pg-mem (avoids multi-argument unnest); the pair count is bounded
    // by the unattributed-conversion count.
    const pairs = [...needChain, ...needPlacement]
      .map((c) => [fallbackPublisher(c), c.programme_id] as const)
      .filter((p): p is readonly [string, string] => typeof p[0] === 'string');
    const uniq = [...new Map(pairs.map((p) => [`${p[0]}|${p[1]}`, p] as const)).values()];
    for (const [publisherId, programmeId] of uniq) {
      const latest = await db.query<{ publisher_share_bps: number }>(
        `select publisher_share_bps
           from contracts
          where org_id = $1 and publisher_id = $2 and programme_id = $3
            and status = 'approved'
          order by version desc
          limit 1`,
        [orgId, publisherId, programmeId],
      );
      const bps = latest.rows[0]?.publisher_share_bps;
      if (bps !== undefined) {
        latestBy.set(`${publisherId}|${programmeId}`, {
          publisher_id: publisherId,
          publisher_share_bps: bps,
        });
      }
    }
  }

  // Reversed amounts per conversion.
  const reversedBy = new Map<string, number>();
  {
    const conversionIds = mature.map((c) => c.id);
    const rev = await db.query<{ conversion_id: string; reversed_minor: string }>(
      `select conversion_id, sum(commission_delta_minor)::text as reversed_minor
         from adjustments
        where org_id = $1 and kind = 'reversal'
          and conversion_id in ${inPlaceholders(conversionIds.length, 2)}
        group by conversion_id`,
      [orgId, ...conversionIds],
    );
    for (const r of rev.rows) reversedBy.set(r.conversion_id, Number(r.reversed_minor));
  }

  const out = new Map<string, EligibleEarning>();
  const add = (publisher_id: string, programme_id: string, cur: string, minor: number) => {
    const key = `${publisher_id}|${programme_id}|${cur}`;
    const e = out.get(key) ?? { publisher_id, programme_id, currency: cur, eligible_minor: 0 };
    e.eligible_minor += minor;
    out.set(key, e);
  };

  for (const c of mature) {
    let publisherId: string | null = null;
    let bps = 10000;
    const snap = c.contract_version_id ? snapshotBy.get(c.contract_version_id) : undefined;
    if (snap) {
      publisherId = snap.publisher_id;
      bps = snap.publisher_share_bps;
    } else if (c.click_id || c.placement_id) {
      const viaChain = fallbackPublisher(c);
      if (viaChain) {
        publisherId = viaChain;
        const latest = latestBy.get(`${viaChain}|${c.programme_id}`);
        if (latest) bps = latest.publisher_share_bps;
      }
    }
    if (!publisherId) continue; // unattributable — earns nothing for any publisher

    const commission = toMinorUnits(c.commission_minor);
    const reversed = reversedBy.get(c.id) ?? 0;
    const share = Math.floor((commission * bps) / 10000);
    const reversedShare = Math.floor((reversed * bps) / 10000);
    const eligible = Math.max(share - reversedShare, 0);
    if (eligible > 0) add(publisherId, c.programme_id, c.currency, eligible);
  }
  return [...out.values()];
}

/**
 * Collected-cash allocation (documented pro-rata policy).
 *
 * Per (programme, currency) the collected pool is
 * sum(merchant_settlements.amount_minor). Each publisher's allocation is
 *
 *   floor(pool × publisher_eligible / total_eligible)
 *
 * over that (programme, currency) slice, where eligible shares come from
 * computeEligibleEarnings (i.e. mature approved shares minus reversals).
 * Flooring keeps the sum within the pool; dust stays unallocated until the
 * next batch. Publishers with no eligible earnings get nothing — the
 * platform never pays out of thin air.
 *
 * Returns a map keyed `${publisher_id}|${currency}` → allocated minor units.
 */
export async function computeCollectedAllocation(
  db: DbClient,
  orgId: string,
  currency?: string,
): Promise<Map<string, number>> {
  const eligible = await computeEligibleEarnings(db, orgId, currency);

  const poolParams: unknown[] = [orgId];
  let poolFilter = '';
  if (currency) {
    poolParams.push(currency.toUpperCase());
    poolFilter = `and currency = $${poolParams.length}`;
  }
  const pools = await db.query<{ programme_id: string; currency: string; pool_minor: string }>(
    `select programme_id, currency, sum(amount_minor)::text as pool_minor
       from merchant_settlements
      where org_id = $1 ${poolFilter}
      group by programme_id, currency`,
    poolParams,
  );
  const poolBy = new Map(pools.rows.map((r) => [`${r.programme_id}|${r.currency}`, Number(r.pool_minor)]));

  const totalBy = new Map<string, number>();
  for (const e of eligible) {
    const key = `${e.programme_id}|${e.currency}`;
    totalBy.set(key, (totalBy.get(key) ?? 0) + e.eligible_minor);
  }

  const out = new Map<string, number>();
  for (const e of eligible) {
    const slice = `${e.programme_id}|${e.currency}`;
    const pool = poolBy.get(slice) ?? 0;
    const total = totalBy.get(slice) ?? 0;
    if (pool <= 0 || total <= 0 || e.eligible_minor <= 0) continue;
    // Cap the pool at total eligible earnings: a merchant can remit more
    // than the currently-eligible slice (e.g. advance/overpayment), but
    // `collected` must never exceed what publishers have actually earned.
    const effectivePool = Math.min(pool, total);
    const alloc = Math.floor((effectivePool * e.eligible_minor) / total);
    if (alloc > 0) {
      const key = `${e.publisher_id}|${e.currency}`;
      out.set(key, (out.get(key) ?? 0) + alloc);
    }
  }
  return out;
}

export interface PayoutBatchInput {
  orgId: string;
  batchId: string;
}

/**
 * Posts the completion entries for a fully-paid payout batch:
 * per payout item, Dr publisher_liability / Cr payout_clearing.
 * Posting key: 'payout:<batch_id>:<publisher_id>'.
 * payout_clearing is a clearing account relieved by bank reconciliation
 * (out of scope) — see API ASSUMPTIONS.md.
 */
export async function postPayoutEntriesForBatch(
  db: DbClient,
  input: PayoutBatchInput,
): Promise<'posted' | 'skipped'> {
  const items = await db.query<{
    publisher_id: string;
    amount_minor: string;
    currency: string;
  }>(
    `select pi.publisher_id as publisher_id,
            pi.amount_minor::text as amount_minor,
            pi.currency as currency
       from payout_items pi
       join payout_batches pb on pb.id = pi.payout_batch_id and pb.org_id = $1
      where pi.payout_batch_id = $2`,
    [input.orgId, input.batchId],
  );
  if (items.rows.length === 0) return 'skipped';

  for (const item of items.rows) {
    const amount = toMinorUnits(item.amount_minor);
    const key = `payout:${input.batchId}:${item.publisher_id}`;
    const drafts: DraftInput[] = [
      {
        org_id: input.orgId,
        currency: item.currency,
        account: 'publisher_liability',
        debit_minor: amount,
        credit_minor: 0,
        publisher_id: item.publisher_id,
        idempotency_key: key,
        memo: `payout batch ${input.batchId}`,
      },
      {
        org_id: input.orgId,
        currency: item.currency,
        account: 'payout_clearing',
        debit_minor: 0,
        credit_minor: amount,
        publisher_id: item.publisher_id,
        idempotency_key: key,
        memo: `payout batch ${input.batchId}`,
      },
    ];
    await insertLedgerDrafts(db, drafts);
  }
  return 'posted';
}

/**
 * Payout-release gate: the books must balance per (org, currency) before
 * any payout batch for that currency can be prepared.
 */
export async function assertBooksBalancedOrThrow(
  db: DbClient,
  orgId: string,
  currency: string,
): Promise<void> {
  const report = await checkBooksBalanced(
    async (sql, params) => {
      const r = await db.query(sql, params as unknown[]);
      return { rows: r.rows as Array<{ currency: string; debit: string; credit: string }> };
    },
    orgId,
  );
  const bad = report.imbalances.find((i) => i.currency === currency);
  if (bad) {
    throw new AppError(
      'LEDGER_IMBALANCE',
      `Books do not balance for currency ${currency} (debit ${bad.debit} != credit ${bad.credit}); payouts blocked`,
      409,
    );
  }
}

export type { QueryResult, QueryResultRow };
