/*
 * Creator Overview loader: the one live call (GET /v1/publisher/earnings,
 * lib/earnings.ts loadLiveEarnings) plus the TEST demo dataset for the
 * selected range.
 */

import type { FallbackNotice } from '@/lib/api';
import { loadLiveEarnings } from '@/lib/earnings';
import { buildOverviewDataset, mapEarningsResponse, type LiveEarnings, type OverviewDataset, type OverviewRange } from './metrics';

export interface OverviewLoad {
  dataset: OverviewDataset;
  /** The mapped live balances, or null when the page shows the designed demo figures. */
  live: LiveEarnings | null;
  /** The earnings call never reached the API: <DemoBadge variant="fallback" /> ("API unreachable"). */
  unreachable: boolean;
  /** Why there are no live figures (the API answered with an error, no publisher id, another publisher): a top Banner. */
  notice: FallbackNotice | null;
}

/**
 * Loads one range. The earnings route takes no date range, so the same
 * balances come back for 7d / 30d / 90d; clicks, conversions, the chart,
 * "By platform" and "Top links" have no v1 endpoint and are always demo.
 *
 * Without live balances the page prints the designed demo figures for the
 * range (not DEMO_EARNINGS mapped: its buckets, ₹41,090 unpaid, would
 * contradict the "By platform" rows, which add up to ₹1,84,320).
 */
export async function loadOverview(range: OverviewRange): Promise<OverviewLoad> {
  const call = await loadLiveEarnings();
  return {
    dataset: buildOverviewDataset(range),
    live: call.response ? mapEarningsResponse(call.response) : null,
    unreachable: call.unreachable,
    notice: call.notice,
  };
}
