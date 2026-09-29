/**
 * Ledger posting mirror of packages/api/src/finance.ts.
 *
 * DUPLICATED DELIBERATELY: packages/workers must not depend on
 * packages/api (dependency direction is api/workers → shared only), so the
 * provider-events worker carries its own copy of the conversion/reversal
 * posting logic. The two implementations are kept in sync by the money-loop
 * workstream — see packages/workers/ASSUMPTIONS.md. The shared builders
 * (buildConversionEntries / buildAdjustmentEntries) are the single source
 * of truth for the double-entry math; only the SQL orchestration is copied.
 *
 * Idempotency-key convention (see db/migrations/0002_money_loop.sql): every
 * posting writes several rows sharing one posting key ('conv:<id>' /
 * 'adj:<id>'); the dedupe unit is (idempotency_key, account).
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  AppError,
  assertEntriesBalanced,
  assertMinorUnits,
  buildAdjustmentEntries,
  buildConversionEntries,
  type LedgerEntryDraft,
} from '@paparazzi/shared';


interface DbClient {
  query: Pool['query'];
}

export interface MirrorConversionRow {
  id: string;
  org_id: string;
  programme_id: string;
  click_id: string | null;
  currency: string;
  /** bigint from pg arrives as a string. */
  commission_minor: string;
}

function toMinorUnits(value: string | number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  assertMinorUnits(n);
  return n;
}

/** Deterministic uuid for auto-reversal adjustments (retries stay idempotent). */
export function deterministicUuid(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

async function insertLedgerDrafts(db: DbClient, drafts: LedgerEntryDraft[]): Promise<void> {
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
 * Mirror of the API's postLedgerForConversion: posts the three balanced
 * rows for an approved conversion and snapshots conversions.contract_version_id.
 * 'skipped' when unattributable or when no approved contract exists — the
 * caller logs it; attribution is never guessed.
 */
export async function postLedgerForConversionMirror(
  db: DbClient,
  conversion: MirrorConversionRow,
): Promise<'posted' | 'skipped'> {
  if (!conversion.click_id) return 'skipped';

  const chain = await db.query<{ publisher_id: string; programme_id: string }>(
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
  const hop = chain.rows[0];
  if (!hop) return 'skipped';

  const contracts = await db.query<{ id: string; publisher_share_bps: number }>(
    `select id, publisher_share_bps
       from contracts
      where org_id = $1 and publisher_id = $2 and programme_id = $3
        and status = 'approved'
      order by version desc
      limit 1`,
    [conversion.org_id, hop.publisher_id, hop.programme_id],
  );
  const contract = contracts.rows[0];
  if (!contract) return 'skipped';

  await insertLedgerDrafts(
    db,
    buildConversionEntries({
      org_id: conversion.org_id,
      currency: conversion.currency,
      conversion_id: conversion.id,
      publisher_id: hop.publisher_id,
      contract_version_id: contract.id,
      commission_minor: toMinorUnits(conversion.commission_minor),
      publisher_share_bps: contract.publisher_share_bps,
      memo: `conversion ${conversion.id}`,
    }),
  );
  await db.query(`update conversions set contract_version_id = $2 where id = $3 and org_id = $1`, [
    conversion.org_id,
    contract.id,
    conversion.id,
  ]);
  return 'posted';
}

/**
 * Mirror of the API's postAdjustmentForReversal: posts the mirror-image
 * entries for a reversal adjustment using the ORIGINAL contract split
 * (conversions.contract_version_id). 'skipped' when the original conversion
 * was never posted.
 */
export async function postAdjustmentForReversalMirror(
  db: DbClient,
  input: { adjustmentId: string; conversionId: string },
): Promise<'posted' | 'skipped'> {
  const adjustments = await db.query<{ org_id: string; commission_delta_minor: string }>(
    `select org_id, commission_delta_minor::text as commission_delta_minor
       from adjustments where id = $1`,
    [input.adjustmentId],
  );
  const adjustment = adjustments.rows[0];
  if (!adjustment) {
    throw new AppError('NOT_FOUND', `Adjustment ${input.adjustmentId} not found`, 404);
  }
  const orgId = adjustment.org_id;

  const conversions = await db.query<{ currency: string; contract_version_id: string | null }>(
    `select currency, contract_version_id from conversions where id = $1 and org_id = $2`,
    [input.conversionId, orgId],
  );
  const conversion = conversions.rows[0];
  if (!conversion) {
    throw new AppError('NOT_FOUND', `Conversion ${input.conversionId} not found`, 404);
  }
  if (!conversion.contract_version_id) return 'skipped';

  const contracts = await db.query<{ publisher_id: string; publisher_share_bps: number }>(
    `select publisher_id, publisher_share_bps from contracts where id = $1 and org_id = $2`,
    [conversion.contract_version_id, orgId],
  );
  const contract = contracts.rows[0];
  if (!contract) return 'skipped';

  const credited = await db.query<{ publisher_id: string | null }>(
    `select publisher_id from ledger_entries
      where org_id = $1 and conversion_id = $2
        and account = 'publisher_liability' and publisher_id is not null
      limit 1`,
    [orgId, input.conversionId],
  );

  await insertLedgerDrafts(
    db,
    buildAdjustmentEntries({
      org_id: orgId,
      currency: conversion.currency,
      adjustment_id: input.adjustmentId,
      contract_version_id: conversion.contract_version_id,
      reversal_commission_minor: toMinorUnits(adjustment.commission_delta_minor),
      publisher_share_bps: contract.publisher_share_bps,
      publisher_id: credited.rows[0]?.publisher_id ?? contract.publisher_id,
      memo: `reversal of conversion ${input.conversionId}`,
    }),
  );
  return 'posted';
}
