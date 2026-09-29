/**
 * Brand billing — pure helpers (relative imports only; tested). No payments
 * provider exists: the top-up flow validates the amount and then says that
 * nothing was charged.
 */

import { DEMO_BRAND_OFFERS, DEMO_CONVERSION_COUNTS } from '../../lib/demo/brand';
import { feeMinor, parseRupeesToMinor } from './offerModel';

/**
 * The creator payout each demo conversion is billed at: the Live "UPI
 * sign-up" offer's ₹180 (every row on /brand/conversions is that offer).
 */
export const DEMO_BILLED_PAYOUT_MINOR: number =
  DEMO_BRAND_OFFERS.find((o) => o.id === 'demo-offer-upi-signup')?.payoutValue ?? 18_000;

/**
 * Approved conversions × the offer's payout: what the brand is billed for
 * (/brand/conversions: only Approved is "Billed", Pending waits for
 * approval, Rejected is "Not billed", Flagged is held). 8,934 × ₹180 =
 * ₹16,08,120. The drawn ₹18.4L spend is all 10,212 sign-ups.
 */
export function approvedPayoutsMinor(counts: Readonly<Record<'Approved', number>> = DEMO_CONVERSION_COUNTS): number {
  return counts.Approved * DEMO_BILLED_PAYOUT_MINOR;
}

/** The network fee due: the plan's rate on approved conversions (8% of ₹16,08,120 = ₹1,28,649.60). */
export function networkFeeDueMinor(feePct: number, counts?: Readonly<Record<'Approved', number>>): number {
  return feeMinor(approvedPayoutsMinor(counts), feePct);
}

export type TopUpMethod = 'upi' | 'netbanking' | 'bank';

export const TOP_UP_METHODS: ReadonlyArray<{ value: TopUpMethod; label: string }> = [
  { value: 'upi', label: 'UPI' },
  { value: 'netbanking', label: 'Net banking' },
  { value: 'bank', label: 'Bank transfer' },
];

export type TopUpCheck = { ok: true; minor: number } | { ok: false; message: string };

/** A top-up amount in rupees ("₹5,00,000", "500000"): more than ₹0, at most two decimals. */
export function validateTopUp(input: string): TopUpCheck {
  if (input.trim() === '') return { ok: false, message: 'Enter an amount to add.' };
  const p = parseRupeesToMinor(input);
  if (!p.ok) return { ok: false, message: 'Enter an amount in rupees, e.g. ₹5,00,000.' };
  if (p.value <= 0) return { ok: false, message: 'The amount must be more than ₹0.' };
  return { ok: true, minor: p.value };
}
