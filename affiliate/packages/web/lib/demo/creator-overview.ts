/**
 * TEST DEMO DATA — NOT REAL. Extra screen data for the creator Overview (1c /
 * 1e) and Reports (3d) that the handover does not draw: the 7-day and 90-day
 * datasets, the July–August earnings, and the weights the Reports filters use
 * to split the designed totals by offer and platform. Every page that renders
 * any of it shows <DemoBadge />.
 *
 * Rules (platform invariant 11, as in lib/demo/afflino.ts): every proper noun
 * is "Demo …" (the offers and links come from lib/demo/afflino.ts); the
 * designed 30-day figures are used exactly as drawn and are the anchor the
 * other ranges are built around. Everything else here is invented, labelled
 * as such, and only ever shown with the demo badge.
 *
 * Money is integer rupees in the weight tables below (the design prints whole
 * rupees); the models convert to minor units (paise) before formatting.
 * Dates are calendar dates, YYYY-MM-DD, India time; the demo "today" is the
 * end of September 2026, as in the handover.
 */

import {
  DEMO_CREATOR_SUMMARY,
  DEMO_DAILY_EARNINGS_PCT,
  DEMO_EARNINGS_BY_PLATFORM,
  DEMO_TOP_LINKS,
  type DemoTopLink,
  type Platform,
} from './afflino';

/** Last day of every demo range (the handover's "30 Sep"). */
export const DEMO_PERIOD_END = '2026-09-30';

/**
 * Daily earnings, 90 days (3 Jul – 30 Sep 2026), as three 30-day periods:
 * a total in whole rupees split across the days in proportion to the
 * weights (largest remainder, so the days add up to the total exactly).
 *
 * - September is the designed chart: its weights ARE the 1c bar heights
 *   (DEMO_DAILY_EARNINGS_PCT) and its total is the designed ₹1,84,320.
 * - 2–31 Aug is the designed "+22% vs prior": ₹1,51,082 × 1.22 = ₹1,84,320
 *   (to the rupee, 21.9999%). Its weights are invented.
 * - 3 Jul – 1 Aug is invented (it only feeds the 90-day view).
 */
export const DEMO_EARNINGS_PERIODS: ReadonlyArray<{
  start: string;
  totalRupees: number;
  weights: ReadonlyArray<number>;
}> = [
  {
    start: '2026-07-03',
    totalRupees: 132_640,
    weights: [
      38, 44, 35, 49, 55, 51, 42, 60, 57, 47, 41, 66, 62, 55, 50, 53, 70, 64, 56, 47, 43, 61, 68, 63, 54, 50, 58, 72,
      66, 60,
    ],
  },
  {
    start: '2026-08-02',
    totalRupees: 151_082,
    weights: [
      48, 55, 41, 60, 66, 52, 49, 71, 63, 58, 45, 70, 74, 62, 57, 61, 80, 72, 60, 55, 50, 68, 77, 70, 64, 59, 66, 82,
      75, 69,
    ],
  },
  {
    start: '2026-09-01',
    totalRupees: DEMO_CREATOR_SUMMARY.earnings30dMinor / 100,
    weights: DEMO_DAILY_EARNINGS_PCT,
  },
];

/** Earnings in the 90 days before the 90-day view (5 Apr – 2 Jul), for its "vs prior" delta. Invented. */
export const DEMO_PRIOR_90D_EARNINGS_RUPEES = 352_110;

export type DemoRangeId = '7d' | '30d' | '90d';

/**
 * Clicks, conversions and the platform split per range. 30d is the design
 * (312,880 clicks, 4,106 conversions, Meta 61% · YT 29% · Snap 10%); 7d and
 * 90d are invented. The split is used for the Clicks meta line and to split
 * the range's earnings in "By platform".
 */
export const DEMO_RANGE_TRAFFIC: Readonly<
  Record<DemoRangeId, { clicks: number; conversions: number; splitPct: { meta: number; youtube: number; snapchat: number } }>
> = {
  '7d': { clicks: 82_640, conversions: 1_093, splitPct: { meta: 60, youtube: 30, snapchat: 10 } },
  '30d': {
    clicks: DEMO_CREATOR_SUMMARY.clicks30d,
    conversions: DEMO_CREATOR_SUMMARY.conversions30d,
    splitPct: DEMO_CREATOR_SUMMARY.clicksSplitPct,
  },
  '90d': { clicks: 806_450, conversions: 10_322, splitPct: { meta: 63, youtube: 28, snapchat: 9 } },
};

/** The designed 30-day "By platform" rows (₹1,12,400 / ₹53,500 / ₹18,420); other ranges split by DEMO_RANGE_TRAFFIC. */
export const DEMO_EARNINGS_BY_PLATFORM_30D = DEMO_EARNINGS_BY_PLATFORM;

/**
 * "Top links" is the same list for every range: its figures are per link,
 * all time (the designed Demo PayUPI row alone, ₹2,52,360, is more than the
 * 30-day earnings), so a range switch does not change it.
 */
export const DEMO_OVERVIEW_TOP_LINKS: ReadonlyArray<DemoTopLink> = DEMO_TOP_LINKS;

/* ---------- Reports (3d) ---------- */

/*
 * The designed 3d funnel (values and the stylised bar widths), cities and
 * sub-IDs are DEMO_FUNNEL, DEMO_CITIES and DEMO_SUB_IDS in lib/demo/afflino.ts;
 * the weights below only split them by offer and platform.
 */

/**
 * How the 30-day clicks split across offer × platform, in percent of all
 * clicks. Invented, but the platform columns add up to the designed
 * Meta 61 / YouTube 29 / Snapchat 10, so the Reports platform filter agrees
 * with the Overview. Demo Rail Trips has a Meta row because the designed
 * "story-12" link (lib/demo/afflino.ts DEMO_MY_LINKS) runs on Meta.
 */
export const DEMO_REPORT_CLICK_SHARE: ReadonlyArray<{ offerId: string; platform: Platform; pct: number }> = [
  { offerId: 'demo-payupi', platform: 'meta', pct: 18 },
  { offerId: 'demo-payupi', platform: 'youtube', pct: 6 },
  { offerId: 'demo-payupi', platform: 'snapchat', pct: 3 },
  { offerId: 'demo-style', platform: 'meta', pct: 14 },
  { offerId: 'demo-style', platform: 'youtube', pct: 6 },
  { offerId: 'demo-learn', platform: 'youtube', pct: 7 },
  { offerId: 'demo-eats', platform: 'meta', pct: 4 },
  { offerId: 'demo-eats', platform: 'snapchat', pct: 2 },
  { offerId: 'demo-ludo', platform: 'meta', pct: 21 },
  { offerId: 'demo-ludo', platform: 'youtube', pct: 3 },
  { offerId: 'demo-ludo', platform: 'snapchat', pct: 2 },
  { offerId: 'demo-rail', platform: 'meta', pct: 4 },
  { offerId: 'demo-rail', platform: 'youtube', pct: 7 },
  { offerId: 'demo-rail', platform: 'snapchat', pct: 3 },
];

/** Invented per-platform rates relative to clicks: impressions per click (index) and the share of clicks that land. */
export const DEMO_REPORT_PLATFORM_RATES: Readonly<Record<'meta' | 'youtube' | 'snapchat', { impressions: number; landed: number }>> = {
  meta: { impressions: 1.15, landed: 0.85 },
  youtube: { impressions: 0.75, landed: 0.9 },
  snapchat: { impressions: 0.95, landed: 0.88 },
};

/**
 * Invented per-offer rates: conversion index (relative), the share of
 * conversions the brand approves, and the average earning per conversion in
 * rupees (the flat payouts of lib/demo/afflino.ts; ₹60 and ₹120 average
 * commissions for the two percentage offers).
 */
export const DEMO_REPORT_OFFER_RATES: Readonly<
  Record<string, { conversion: number; approval: number; earnedPerConversionRupees: number }>
> = {
  'demo-payupi': { conversion: 1.25, approval: 0.95, earnedPerConversionRupees: 180 },
  'demo-style': { conversion: 1.1, approval: 0.88, earnedPerConversionRupees: 60 },
  'demo-learn': { conversion: 1.0, approval: 0.9, earnedPerConversionRupees: 150 },
  'demo-eats': { conversion: 2.4, approval: 0.97, earnedPerConversionRupees: 40 },
  'demo-ludo': { conversion: 0.8, approval: 0.92, earnedPerConversionRupees: 22 },
  'demo-rail': { conversion: 0.3, approval: 0.85, earnedPerConversionRupees: 120 },
};

/**
 * Conversions outside the six designed cities (4,106 − 3,110), so a filter
 * splits its conversions across cities in the designed shape.
 */
export const DEMO_REPORT_OTHER_CITY_CONVERSIONS = 996;
