/**
 * Brand billing — pure helpers (relative imports only; tested). No payments
 * provider exists: the top-up flow validates the amount and then says that
 * nothing was charged.
 */

import { parseRupeesToMinor } from './offerModel';

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
