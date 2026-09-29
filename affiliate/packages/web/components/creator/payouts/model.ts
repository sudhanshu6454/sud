/*
 * Creator Payouts (2c) — the pure rules: TDS and net on a withdrawal, the
 * minimum-withdrawal rule, the withdrawal amount check and the mapping of
 * GET /v1/publisher/earnings onto the two balance cells. No React, no
 * browser APIs (unit-tested in test/payouts.test.ts).
 *
 * Money is integer minor units (paise). The TDS rate, the section and the
 * minimum withdrawal are the owner-confirmed figures in lib/site-copy.ts.
 */

import type { EarningsResponse } from '../../../lib/api';
import { earningsBalances } from '../../../lib/earnings';
import { formatINRExact, formatINRFromMinor } from '../../../lib/format';
import { MIN_WITHDRAWAL_RUPEES, TDS } from '../../../lib/site-copy';

const PAISE_PER_RUPEE = 100;

function assertMinor(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative integer number of paise, got ${value}`);
  }
}

/** A percentage rate as integer basis points (1 → 100, 0.1 → 10). */
export function rateToBps(ratePct: number): number {
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
    throw new RangeError(`rate must be a percentage between 0 and 100, got ${ratePct}`);
  }
  return Math.round(ratePct * 100);
}

/**
 * TDS on a gross payout, rounded to the whole rupee, half up — the rule the
 * design's rows follow (₹51,250 → ₹513, ₹38,400 → ₹384). Integer maths
 * only: gross × bps / 10,000 is the tax in paise, and the + 5,00,000 before
 * the division by 10,00,000 rounds it to the nearest rupee.
 * The rounding rule is part of the TDS placeholder (lib/site-copy.ts).
 */
export function computeTdsMinor(grossMinor: number, ratePct: number = TDS.ratePct): number {
  assertMinor(grossMinor, 'gross');
  const bps = rateToBps(ratePct);
  const rupees = Math.floor((grossMinor * bps + 500_000) / 1_000_000);
  return rupees * PAISE_PER_RUPEE;
}

export interface WithdrawalBreakdown {
  grossMinor: number;
  tdsMinor: number;
  netMinor: number;
  ratePct: number;
  section: string;
}

/** Amount, TDS and what reaches the creator. */
export function withdrawalBreakdown(grossMinor: number, ratePct: number = TDS.ratePct): WithdrawalBreakdown {
  const tdsMinor = computeTdsMinor(grossMinor, ratePct);
  return { grossMinor, tdsMinor, netMinor: grossMinor - tdsMinor, ratePct, section: TDS.section };
}

/** "TDS 1% (194-O)". */
export function tdsLabel(ratePct: number = TDS.ratePct, section: string = TDS.section): string {
  return `TDS ${ratePct}% (${section})`;
}

/** The minimum withdrawal in paise (₹500 → 50,000). */
export function minWithdrawalMinor(minRupees: number = MIN_WITHDRAWAL_RUPEES): number {
  return Math.round(minRupees * PAISE_PER_RUPEE);
}

export interface WithdrawEligibility {
  ok: boolean;
  /** Why the Withdraw button is disabled ('' when ok). Shown under the button. */
  reason: string;
}

/**
 * The Withdraw button is enabled from the minimum up (₹500 exactly is
 * allowed) and disabled below it, with the reason shown. A live balance is
 * printed exactly (₹499.60, never rounded up to the minimum).
 */
export function withdrawEligibility(availableMinor: number, minRupees: number = MIN_WITHDRAWAL_RUPEES): WithdrawEligibility {
  assertMinor(availableMinor, 'available balance');
  const min = minWithdrawalMinor(minRupees);
  if (availableMinor >= min) return { ok: true, reason: '' };
  const minLabel = formatINRFromMinor(min);
  return {
    ok: false,
    reason:
      availableMinor === 0
        ? `Nothing to withdraw yet. The minimum withdrawal is ${minLabel}.`
        : `The minimum withdrawal is ${minLabel}; ${formatINRExact(availableMinor)} is available.`,
  };
}

export interface AmountCheck {
  ok: boolean;
  message: string;
  /** The amount in paise when ok. */
  grossMinor?: number;
}

/**
 * The amount typed in the withdraw dialog: whole rupees ("42900",
 * "42,900", "₹42,900"), at least the minimum, at most what is available.
 */
export function validateWithdrawAmount(
  input: string,
  availableMinor: number,
  minRupees: number = MIN_WITHDRAWAL_RUPEES,
): AmountCheck {
  assertMinor(availableMinor, 'available balance');
  const raw = input.replace(/[₹,\s]/g, '');
  if (raw === '') return { ok: false, message: 'Enter an amount.' };
  if (!/^\d+$/.test(raw)) return { ok: false, message: 'Enter a whole rupee amount, e.g. 5000.' };
  const rupees = Number(raw);
  if (!Number.isSafeInteger(rupees * PAISE_PER_RUPEE)) return { ok: false, message: 'That amount is too large.' };
  const grossMinor = rupees * PAISE_PER_RUPEE;
  const min = minWithdrawalMinor(minRupees);
  if (grossMinor < min) return { ok: false, message: `The minimum withdrawal is ${formatINRFromMinor(min)}.` };
  if (grossMinor > availableMinor) {
    return { ok: false, message: `You can withdraw up to ${formatINRExact(availableMinor)}.` };
  }
  return { ok: true, message: '', grossMinor };
}

/* ---------- GET /v1/publisher/earnings → the two balance cells ---------- */

export interface PayoutBalances {
  /** Available to withdraw: collected cash for eligible earnings not yet in a payout batch. */
  availableMinor: number;
  /** Pending approval: the publisher's share of conversions the brand has not approved yet. */
  pendingMinor: number;
}

/**
 * Map the earnings response (packages/api/src/routes/earnings.ts) onto 2c:
 *
 * - Pending approval ← `pending`: the publisher share of conversions still
 *   awaiting provider approval — exactly what the cell says, and what the
 *   brand's validation window clears.
 * - Available to withdraw ← max(`collected` − `payable`, 0). `collected` is
 *   the merchant cash allocated to the publisher's eligible (approved, past
 *   the returns window, net of reversals) earnings; `payable` is everything
 *   already in a payout batch that has not failed or been cancelled (paid
 *   batches included), both running totals. Their difference is what the
 *   next batch can still draw — the same formula POST /v1/payout-batches
 *   uses (max(min(eligible, collected) − batched, 0), and collected never
 *   exceeds eligible). `approved` (the net publisher_liability) is not
 *   used: it includes earnings the merchant has not paid for yet and
 *   earnings still inside the returns window, which cannot be withdrawn.
 *   Not reflected: the contract's payout threshold (not in the response).
 *
 * The mapping is lib/earnings.ts, shared with the overview's Next payout (1c).
 * A currency with no activity has no bucket and reads as zero.
 */
export function mapEarningsToBalances(response: EarningsResponse, currency = 'INR'): PayoutBalances {
  const balances = earningsBalances(response, currency);
  return {
    availableMinor: balances.nextBatchMinor,
    pendingMinor: Math.max(balances.pendingMinor, 0),
  };
}
