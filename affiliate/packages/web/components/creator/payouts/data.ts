/*
 * Payouts (2c) loader: the one live call, GET /v1/publisher/earnings
 * (lib/earnings.ts loadLiveEarnings), for the two balance cells. Payout
 * history, conversions and clicks have no v1 endpoint (payout batches are
 * finance-only routes), so those tables are always TEST demo data.
 */

import type { FallbackNotice } from '@/lib/api';
import { DEMO_CREATOR_SUMMARY } from '@/lib/demo/afflino';
import { earningsBalances, loadLiveEarnings } from '@/lib/earnings';
import { mapEarningsToBalances, type PayoutBalances } from './model';

/** The balances 2c draws (₹42,900 available, ₹1,12,480 pending). */
export const DEMO_BALANCES: PayoutBalances = {
  availableMinor: DEMO_CREATOR_SUMMARY.availableMinor,
  pendingMinor: DEMO_CREATOR_SUMMARY.pendingMinor,
};

export interface BalancesLoad {
  balances: PayoutBalances;
  /** The balances are the API's. */
  live: boolean;
  /**
   * Live only: approved earnings not in either cell — approved − available
   * (not yet collected from the brand, still inside the returns window, or
   * already in a batch that is not paid). 0 otherwise.
   */
  approvedNotAvailableMinor: number;
  /** The earnings call never reached the API: <DemoBadge variant="fallback" />. */
  unreachable: boolean;
  /** Why there are no live balances, for a top Banner. */
  notice: FallbackNotice | null;
}

export async function loadBalances(): Promise<BalancesLoad> {
  const call = await loadLiveEarnings();
  if (!call.response) {
    return { balances: DEMO_BALANCES, live: false, approvedNotAvailableMinor: 0, unreachable: call.unreachable, notice: call.notice };
  }
  const balances = mapEarningsToBalances(call.response);
  const { approvedMinor } = earningsBalances(call.response);
  return {
    balances,
    live: true,
    approvedNotAvailableMinor: Math.max(approvedMinor - balances.availableMinor, 0),
    unreachable: false,
    notice: null,
  };
}
