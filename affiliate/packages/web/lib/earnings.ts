/*
 * GET /v1/publisher/earnings → the balances the creator screens print.
 * One mapping for the overview (1c "Next payout") and payouts (2c
 * "Available to withdraw"), so the two never disagree about the same money.
 * The buckets (packages/api/src/routes/earnings.ts), per currency:
 *
 * - pending:   the publisher's share of conversions still awaiting approval.
 * - approved:  the net publisher_liability ledger balance (a paid batch
 *              debits it) — approved and not yet paid, including earnings
 *              the merchant has not paid for and earnings still inside the
 *              returns window.
 * - collected: merchant cash allocated to the publisher's eligible (approved,
 *              past the returns window, unreversed) earnings — a running
 *              total, capped at eligible.
 * - payable:   everything already in a payout batch that has not failed or
 *              been cancelled, paid batches included — a running total.
 *
 * nextBatch = max(collected − payable, 0) is what the next payout batch can
 * still draw: the formula POST /v1/payout-batches sizes a batch with
 * (max(min(eligible, collected) − batched, 0)). Not reflected: the
 * contract's payout threshold, which the response does not carry.
 *
 * A currency with no activity has no bucket and reads as zero. Relative
 * imports only (tested).
 */

import type { EarningsResponse } from './api';

export interface EarningsBalances {
  pendingMinor: number;
  approvedMinor: number;
  collectedMinor: number;
  payableMinor: number;
  /** max(collected − payable, 0): what the next payout batch can draw. */
  nextBatchMinor: number;
}

function bucketValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function earningsBalances(response: EarningsResponse, currency = 'INR'): EarningsBalances {
  const bucket = response.balances?.[currency];
  const collectedMinor = bucketValue(bucket?.collected);
  const payableMinor = bucketValue(bucket?.payable);
  return {
    pendingMinor: bucketValue(bucket?.pending),
    approvedMinor: bucketValue(bucket?.approved),
    collectedMinor,
    payableMinor,
    nextBatchMinor: Math.max(collectedMinor - payableMinor, 0),
  };
}
