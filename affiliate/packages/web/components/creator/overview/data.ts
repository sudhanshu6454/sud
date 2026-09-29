/*
 * Creator Overview loader: the one live call (GET /v1/publisher/earnings)
 * plus the TEST demo dataset for the selected range.
 */

import { apiFetch, getPublisherId, withDemoFallback, type EarningsResponse } from '@/lib/api';
import { DEMO_EARNINGS } from '@/lib/portal-demo';
import { buildOverviewDataset, mapEarningsResponse, type LiveEarnings, type OverviewDataset, type OverviewRange } from './metrics';

export interface OverviewLoad {
  dataset: OverviewDataset;
  /** The mapped live balances, or null when the call fell back to demo data. */
  live: LiveEarnings | null;
  /** The earnings call failed (or answered for another publisher): render <DemoBadge variant="fallback" />. */
  fallback: boolean;
  /** The API answered for a different publisher id than the one asked for. */
  mismatch: boolean;
}

/**
 * Loads one range. The earnings route takes no date range, so the same
 * balances come back for 7d / 30d / 90d; clicks, conversions, the chart,
 * "By platform" and "Top links" have no v1 endpoint and are always demo.
 *
 * DEMO_EARNINGS stays the fallback value of the call (the contract the old
 * /portal dashboard used), but a fallback page prints the designed demo
 * figures for the range instead of mapping it: its buckets (₹41,090 unpaid)
 * would contradict the rest of the demo page (the "By platform" rows add up
 * to ₹1,84,320).
 */
export async function loadOverview(range: OverviewRange): Promise<OverviewLoad> {
  const publisherId = getPublisherId();
  const { value, demo } = await withDemoFallback(
    () => apiFetch<EarningsResponse>(`/v1/publisher/earnings?publisher_id=${encodeURIComponent(publisherId)}`),
    DEMO_EARNINGS,
  );
  const mismatch = !demo && value.publisher_id !== publisherId;
  const live = demo || mismatch ? null : mapEarningsResponse(value);
  return { dataset: buildOverviewDataset(range), live, fallback: live === null, mismatch };
}
