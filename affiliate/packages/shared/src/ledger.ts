import type { MinorUnits } from './domain.js';

/**
 * Double-entry ledger math. Every movement posts balanced drafts
 * (Σdebit = Σcredit per idempotency key); `assertEntriesBalanced` enforces it
 * before anything is written, and `checkBooksBalanced` verifies the stored
 * books afterwards.
 */

export type LedgerAccount =
  | 'merchant_receivable'
  | 'publisher_liability'
  | 'platform_commission'
  /** Clearing account relieved by bank reconciliation when a payout batch completes. */
  | 'payout_clearing';

/** A ledger row not yet persisted. Writers add `id` / `created_at` on insert. */
export interface LedgerEntryDraft {
  org_id: string;
  currency: string;
  account: LedgerAccount;
  debit_minor: MinorUnits;
  credit_minor: MinorUnits;
  conversion_id?: string;
  adjustment_id?: string;
  contract_version_id: string;
  /** Publisher the liability/commission row belongs to (mirrors ledger_entries.publisher_id). */
  publisher_id?: string;
  idempotency_key: string;
  memo?: string;
}

export class LedgerImbalanceError extends Error {
  readonly code = 'LEDGER_IMBALANCE' as const;
  readonly debit: number;
  readonly credit: number;

  constructor(debit: number, credit: number) {
    super(`Ledger entries do not balance: debit ${debit} != credit ${credit}`);
    this.name = 'LedgerImbalanceError';
    this.debit = debit;
    this.credit = credit;
  }
}

export function assertEntriesBalanced(
  entries: ReadonlyArray<{ debit_minor: MinorUnits; credit_minor: MinorUnits }>,
): void {
  let debit = 0;
  let credit = 0;
  for (const e of entries) {
    debit += e.debit_minor;
    credit += e.credit_minor;
  }
  if (debit !== credit) {
    throw new LedgerImbalanceError(debit, credit);
  }
}

export interface BuildConversionEntriesParams {
  org_id: string;
  currency: string;
  conversion_id: string;
  contract_version_id: string;
  commission_minor: MinorUnits;
  /** Publisher share in basis points (0..10000). */
  publisher_share_bps: number;
  /** Set on every draft; mirrors ledger_entries.publisher_id for per-publisher accounting. */
  publisher_id?: string;
  memo?: string;
}

/**
 * Approved conversion → platform recognises commission receivable from the
 * merchant and the publisher's earned share as a liability.
 * Balanced by construction: publisher gets floor(commission*bps/10000),
 * the platform keeps the remainder.
 */
export function buildConversionEntries(params: BuildConversionEntriesParams): LedgerEntryDraft[] {
  const publisherShare = Math.floor((params.commission_minor * params.publisher_share_bps) / 10000);
  const platformShare = params.commission_minor - publisherShare;
  const key = `conv:${params.conversion_id}`;
  return [
    {
      org_id: params.org_id,
      currency: params.currency,
      account: 'merchant_receivable',
      debit_minor: params.commission_minor,
      credit_minor: 0,
      conversion_id: params.conversion_id,
      contract_version_id: params.contract_version_id,
      publisher_id: params.publisher_id,
      idempotency_key: key,
      memo: params.memo ?? 'commission recognised on approved conversion',
    },
    {
      org_id: params.org_id,
      currency: params.currency,
      account: 'publisher_liability',
      debit_minor: 0,
      credit_minor: publisherShare,
      conversion_id: params.conversion_id,
      contract_version_id: params.contract_version_id,
      publisher_id: params.publisher_id,
      idempotency_key: key,
      memo: params.memo ?? 'publisher share of commission',
    },
    {
      org_id: params.org_id,
      currency: params.currency,
      account: 'platform_commission',
      debit_minor: 0,
      credit_minor: platformShare,
      conversion_id: params.conversion_id,
      contract_version_id: params.contract_version_id,
      publisher_id: params.publisher_id,
      idempotency_key: key,
      memo: params.memo ?? 'platform share of commission',
    },
  ];
}

export interface BuildAdjustmentEntriesParams {
  org_id: string;
  currency: string;
  adjustment_id: string;
  contract_version_id: string;
  /** Positive commission amount being reversed. */
  reversal_commission_minor: MinorUnits;
  /** Publisher share in basis points (0..10000) at the original contract. */
  publisher_share_bps: number;
  publisher_id?: string;
  memo?: string;
}

/**
 * Reversal / correction → exact mirror image of the conversion entries.
 * No negative amounts anywhere: the original debit becomes a credit and
 * the original credits become debits.
 */
export function buildAdjustmentEntries(params: BuildAdjustmentEntriesParams): LedgerEntryDraft[] {
  const publisherShare = Math.floor((params.reversal_commission_minor * params.publisher_share_bps) / 10000);
  const platformShare = params.reversal_commission_minor - publisherShare;
  const key = `adj:${params.adjustment_id}`;
  return [
    {
      org_id: params.org_id,
      currency: params.currency,
      account: 'merchant_receivable',
      debit_minor: 0,
      credit_minor: params.reversal_commission_minor,
      adjustment_id: params.adjustment_id,
      contract_version_id: params.contract_version_id,
      publisher_id: params.publisher_id,
      idempotency_key: key,
      memo: params.memo ?? 'commission reversed',
    },
    {
      org_id: params.org_id,
      currency: params.currency,
      account: 'publisher_liability',
      debit_minor: publisherShare,
      credit_minor: 0,
      adjustment_id: params.adjustment_id,
      contract_version_id: params.contract_version_id,
      publisher_id: params.publisher_id,
      idempotency_key: key,
      memo: params.memo ?? 'publisher share reversed',
    },
    {
      org_id: params.org_id,
      currency: params.currency,
      account: 'platform_commission',
      debit_minor: platformShare,
      credit_minor: 0,
      adjustment_id: params.adjustment_id,
      contract_version_id: params.contract_version_id,
      publisher_id: params.publisher_id,
      idempotency_key: key,
      memo: params.memo ?? 'platform share reversed',
    },
  ];
}

export interface CurrencyBalance {
  currency: string;
  /** Raw summed strings as returned by the driver (pg returns bigint as text). */
  debit: string;
  credit: string;
}

export interface BooksBalanceReport {
  balanced: boolean;
  imbalances: CurrencyBalance[];
}

/**
 * Verifies the stored books balance per currency for an org.
 *
 * `query` is injected (rather than importing `pg` here) so this package keeps
 * zero runtime dependencies — see packages/shared/ASSUMPTIONS.md.
 */
export async function checkBooksBalanced(
  query: (sql: string, params: unknown[]) => Promise<{ rows: CurrencyBalance[] }>,
  org_id: string,
): Promise<BooksBalanceReport> {
  const { rows } = await query(
    'select currency, sum(debit_minor) as debit, sum(credit_minor) as credit from ledger_entries where org_id=$1 group by currency',
    [org_id],
  );
  const imbalances = rows.filter((r) => BigInt(r.debit) !== BigInt(r.credit));
  return { balanced: imbalances.length === 0, imbalances };
}
