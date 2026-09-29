/*
 * Payouts (2c) loader: the one live call, GET /v1/publisher/earnings, for
 * the two balance cells. Payout history, conversions and clicks have no v1
 * endpoint (payout batches are finance-only routes), so those tables are
 * always TEST demo data.
 */

import { apiFetch, getPublisherId, withDemoFallback, type EarningsResponse } from '@/lib/api';
import { DEMO_CREATOR_SUMMARY } from '@/lib/demo/afflino';
import { mapEarningsToBalances, type PayoutBalances } from './model';

/** The balances 2c draws (₹42,900 available, ₹1,12,480 pending). */
export const DEMO_BALANCES: PayoutBalances = {
  availableMinor: DEMO_CREATOR_SUMMARY.availableMinor,
  pendingMinor: DEMO_CREATOR_SUMMARY.pendingMinor,
};

export interface BalancesLoad {
  balances: PayoutBalances;
  /** The balances are the API's (false: the call failed, or answered for another publisher). */
  live: boolean;
  /** The API answered for a different publisher id than the one asked for. */
  mismatch: boolean;
}

export async function loadBalances(): Promise<BalancesLoad> {
  const publisherId = getPublisherId();
  const { value, demo } = await withDemoFallback<EarningsResponse | null>(
    () => apiFetch<EarningsResponse>(`/v1/publisher/earnings?publisher_id=${encodeURIComponent(publisherId)}`),
    null,
  );
  if (demo || !value) return { balances: DEMO_BALANCES, live: false, mismatch: false };
  if (value.publisher_id !== publisherId) return { balances: DEMO_BALANCES, live: false, mismatch: true };
  return { balances: mapEarningsToBalances(value), live: true, mismatch: false };
}
