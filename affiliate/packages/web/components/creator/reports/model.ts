/*
 * Creator Reports (3d) — the filter model. Pure functions over the TEST demo
 * data: the designed 30-day, all-offers, all-platforms report
 * (lib/demo/afflino.ts DEMO_FUNNEL / DEMO_CITIES / DEMO_SUB_IDS) split by
 * offer × platform with the weights in lib/demo/creator-overview.ts, and
 * scaled to 7 / 90 days with the Overview's range totals. No v1 endpoint
 * serves any of this. Relative imports keep it loadable by vitest.
 */

import {
  DEMO_CITIES,
  DEMO_FUNNEL,
  DEMO_MY_LINKS,
  DEMO_OFFERS,
  DEMO_SUB_IDS,
  PLATFORM_NAME,
} from '../../../lib/demo/afflino';
import {
  DEMO_RANGE_TRAFFIC,
  DEMO_REPORT_CLICK_SHARE,
  DEMO_REPORT_OFFER_RATES,
  DEMO_REPORT_OTHER_CITY_CONVERSIONS,
  DEMO_REPORT_PLATFORM_RATES,
} from '../../../lib/demo/creator-overview';
import { formatDayMonth } from '../../../lib/format';
import {
  OVERVIEW_RANGES,
  allocateByWeights,
  bucketFromEnd,
  formatRangeLabel,
  formatShortRange,
  rangeDays,
  sum,
  type DemoDay,
  type OverviewRange,
} from '../overview/metrics';

export type ReportPlatform = 'meta' | 'youtube' | 'snapchat';
export type GroupBy = 'day' | 'week' | 'month';

export interface ReportFilters {
  range: OverviewRange;
  /** An offer id from DEMO_OFFERS, or 'all'. */
  offerId: string;
  platform: ReportPlatform | 'all';
  groupBy: GroupBy;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = { range: '30d', offerId: 'all', platform: 'all', groupBy: 'day' };

export interface ReportOption<T extends string = string> {
  value: T;
  label: string;
}

/** "24–30 Sep 2026", "1–30 Sep 2026", "3 Jul–30 Sep 2026". */
export function rangeLabel(range: OverviewRange): string {
  const days = rangeDays(range);
  return formatRangeLabel(days[0]!.date, days[days.length - 1]!.date);
}

export const REPORT_RANGE_OPTIONS: ReadonlyArray<ReportOption<OverviewRange>> = OVERVIEW_RANGES.map((r) => ({
  value: r.id,
  label: rangeLabel(r.id),
}));

export const REPORT_OFFER_OPTIONS: ReadonlyArray<ReportOption> = [
  { value: 'all', label: 'All offers' },
  ...DEMO_OFFERS.map((o) => ({ value: o.id, label: o.name })),
];

export const REPORT_PLATFORMS: ReadonlyArray<ReportPlatform> = ['meta', 'youtube', 'snapchat'];

export const REPORT_PLATFORM_OPTIONS: ReadonlyArray<ReportOption<ReportPlatform | 'all'>> = [
  { value: 'all', label: 'All platforms' },
  ...REPORT_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_NAME[p] })),
];

export const GROUP_BY_OPTIONS: ReadonlyArray<ReportOption<GroupBy>> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

export function optionLabel<T extends string>(options: ReadonlyArray<ReportOption<T>>, value: T): string {
  return options.find((o) => o.value === value)?.label ?? String(value);
}

/* ---------- offer × platform segments (30 days) ---------- */

type FunnelKey = 'impressions' | 'clicks' | 'landed' | 'conversions' | 'approved';

export const FUNNEL_KEYS: ReadonlyArray<FunnelKey> = ['impressions', 'clicks', 'landed', 'conversions', 'approved'];

const FUNNEL_BY_KEY: Record<FunnelKey, { label: string; value: number; widthPct: number }> = (() => {
  const byLabel = new Map(DEMO_FUNNEL.map((s) => [s.label.toLowerCase(), s]));
  const out = {} as Record<FunnelKey, { label: string; value: number; widthPct: number }>;
  for (const key of FUNNEL_KEYS) {
    const step = byLabel.get(key);
    if (!step) throw new Error(`DEMO_FUNNEL has no ${key} step`);
    out[key] = step;
  }
  return out;
})();

/** The 30-day earnings the segments share (₹1,84,320, the designed Overview figure), in rupees. */
function earnings30dRupees(): number {
  return sum(rangeDays('30d').map((d) => d.earnedMinor)) / 100;
}

export interface Segment {
  offerId: string;
  platform: ReportPlatform;
  impressions: number;
  clicks: number;
  landed: number;
  conversions: number;
  approved: number;
  earnedRupees: number;
}

/**
 * The designed 30-day totals split across offer × platform: every metric is
 * allocated over the segments by its weight (largest remainder), so the
 * segments add up to the designed figures exactly.
 */
export function buildSegments(): Segment[] {
  const weights = DEMO_REPORT_CLICK_SHARE.map((row) => {
    const platform = DEMO_REPORT_PLATFORM_RATES[row.platform as ReportPlatform];
    const offer = DEMO_REPORT_OFFER_RATES[row.offerId];
    if (!platform || !offer) throw new Error(`no demo rates for ${row.offerId} on ${row.platform}`);
    const clicks = row.pct;
    const landed = clicks * platform.landed;
    const conversions = landed * offer.conversion;
    return {
      impressions: clicks * platform.impressions,
      clicks,
      landed,
      conversions,
      approved: conversions * offer.approval,
      earnedRupees: conversions * offer.earnedPerConversionRupees,
    };
  });
  const split = (key: keyof (typeof weights)[number], total: number) =>
    allocateByWeights(
      total,
      weights.map((w) => w[key]),
    );
  const columns = {
    impressions: split('impressions', FUNNEL_BY_KEY.impressions.value),
    clicks: split('clicks', FUNNEL_BY_KEY.clicks.value),
    landed: split('landed', FUNNEL_BY_KEY.landed.value),
    conversions: split('conversions', FUNNEL_BY_KEY.conversions.value),
    approved: split('approved', FUNNEL_BY_KEY.approved.value),
    earnedRupees: split('earnedRupees', earnings30dRupees()),
  };
  return DEMO_REPORT_CLICK_SHARE.map((row, i) => ({
    offerId: row.offerId,
    platform: row.platform as ReportPlatform,
    impressions: columns.impressions[i]!,
    clicks: columns.clicks[i]!,
    landed: columns.landed[i]!,
    conversions: columns.conversions[i]!,
    approved: columns.approved[i]!,
    earnedRupees: columns.earnedRupees[i]!,
  }));
}

let cachedSegments: Segment[] | null = null;

function segments(): ReadonlyArray<Segment> {
  cachedSegments ??= buildSegments();
  return cachedSegments;
}

function matches(filters: Pick<ReportFilters, 'offerId' | 'platform'>, offerId: string, platform: string | undefined) {
  return (
    (filters.offerId === 'all' || filters.offerId === offerId) &&
    (filters.platform === 'all' || filters.platform === platform)
  );
}

/**
 * 7 / 90 days relative to 30: traffic steps (impressions, clicks, landed)
 * scale with clicks, conversion steps with conversions, earnings with the
 * Overview's range earnings.
 */
export function rangeFactors(range: OverviewRange): { traffic: number; conversion: number; earned: number } {
  const base = DEMO_RANGE_TRAFFIC['30d'];
  const traffic = DEMO_RANGE_TRAFFIC[range];
  const earned = sum(rangeDays(range).map((d) => d.earnedMinor)) / 100;
  return {
    traffic: traffic.clicks / base.clicks,
    conversion: traffic.conversions / base.conversions,
    earned: earned / earnings30dRupees(),
  };
}

export interface ReportTotals {
  impressions: number;
  clicks: number;
  landed: number;
  conversions: number;
  approved: number;
  earnedRupees: number;
}

export function reportTotals(filters: ReportFilters): ReportTotals {
  const picked = segments().filter((s) => matches(filters, s.offerId, s.platform));
  const f = rangeFactors(filters.range);
  const total = (key: keyof ReportTotals, factor: number) => Math.round(sum(picked.map((s) => s[key])) * factor);
  return {
    impressions: total('impressions', f.traffic),
    clicks: total('clicks', f.traffic),
    landed: total('landed', f.traffic),
    conversions: total('conversions', f.conversion),
    approved: total('approved', f.conversion),
    earnedRupees: total('earnedRupees', f.earned),
  };
}

/* ---------- funnel strip ---------- */

export interface FunnelStep {
  key: FunnelKey;
  label: string;
  value: number;
  /** Bar width, 0–100. */
  widthPct: number;
}

/**
 * The five funnel cells. Bar widths keep the designed stylised scale: at the
 * default report they are exactly the drawn 100 / 64 / 52 / 18 / 16; a filter
 * moves each bar by how its step's rate (value ÷ impressions) changes against
 * the default report's rate.
 */
export function reportFunnel(filters: ReportFilters): FunnelStep[] {
  const totals = reportTotals(filters);
  const baseImpressions = FUNNEL_BY_KEY.impressions.value;
  return FUNNEL_KEYS.map((key) => {
    const design = FUNNEL_BY_KEY[key];
    const value = totals[key];
    let widthPct: number;
    if (totals.impressions <= 0) widthPct = 0;
    else if (key === 'impressions') widthPct = design.widthPct;
    else {
      const rate = value / totals.impressions;
      const baseRate = design.value / baseImpressions;
      widthPct = Math.max(0, Math.min(100, design.widthPct * (rate / baseRate)));
    }
    return { key, label: design.label, value, widthPct };
  });
}

/* ---------- conversions by city ---------- */

export interface CityRow {
  name: string;
  conversions: number;
  /** Relative to the top city, rounded to a whole percent (as drawn: 100 / 92 / 78 / 50 / 39 / 25). */
  widthPct: number;
}

export function reportCities(filters: ReportFilters): CityRow[] {
  const { conversions } = reportTotals(filters);
  const parts = allocateByWeights(conversions, [
    ...DEMO_CITIES.map((c) => c.conversions),
    DEMO_REPORT_OTHER_CITY_CONVERSIONS,
  ]);
  const shown = DEMO_CITIES.map((c, i) => ({ name: c.name, conversions: parts[i]! }));
  const top = Math.max(0, ...shown.map((c) => c.conversions));
  return shown.map((c) => ({ ...c, widthPct: top > 0 ? Math.round((c.conversions / top) * 100) : 0 }));
}

/* ---------- by sub-ID ---------- */

export interface SubIdRow {
  subId: string;
  offerId: string | null;
  platform: ReportPlatform | null;
  clicks: number;
  crPct: number;
  earnedMinor: number;
}

/**
 * The designed sub-ID rows, each tied to its link's offer and platform
 * (DEMO_MY_LINKS); a 7 / 90-day range scales clicks and earnings, the
 * conversion rate stays as drawn.
 */
export function reportSubIds(filters: ReportFilters): SubIdRow[] {
  const f = rangeFactors(filters.range);
  return DEMO_SUB_IDS.map((row) => {
    const link = DEMO_MY_LINKS.find((l) => l.subId === row.subId);
    const platform = link && (REPORT_PLATFORMS as ReadonlyArray<string>).includes(link.platform)
      ? (link.platform as ReportPlatform)
      : null;
    return {
      subId: row.subId,
      offerId: link?.offerId ?? null,
      platform,
      clicks: Math.round(row.clicks * f.traffic),
      crPct: row.crPct,
      earnedMinor: Math.round((row.earnedMinor / 100) * f.earned) * 100,
    };
  }).filter((row) =>
    filters.offerId === 'all' && filters.platform === 'all'
      ? true
      : row.offerId !== null && matches(filters, row.offerId, row.platform ?? undefined),
  );
}

/* ---------- by day / week / month ---------- */

export interface PeriodRow {
  start: string;
  end: string;
  label: string;
  clicks: number;
  conversions: number;
  earnedMinor: number;
}

function monthBuckets(days: ReadonlyArray<DemoDay>): DemoDay[][] {
  const buckets: DemoDay[][] = [];
  for (const day of days) {
    const last = buckets[buckets.length - 1];
    if (last && last[0]!.date.slice(0, 7) === day.date.slice(0, 7)) last.push(day);
    else buckets.push([day]);
  }
  return buckets;
}

/**
 * The report's totals over time, oldest first: the filtered totals split
 * across the range's days in the shape of the unfiltered demo days, then
 * summed per day, per week (7-day buckets ending on the last day, so the
 * newest week is whole) or per calendar month.
 */
export function reportPeriods(filters: ReportFilters): PeriodRow[] {
  const days = rangeDays(filters.range);
  const totals = reportTotals(filters);
  const clicks = allocateByWeights(totals.clicks, days.map((d) => d.clicks));
  const conversions = allocateByWeights(totals.conversions, days.map((d) => d.conversions));
  const earnedRupees = allocateByWeights(totals.earnedRupees, days.map((d) => d.earnedMinor));
  const filtered: DemoDay[] = days.map((d, i) => ({
    date: d.date,
    clicks: clicks[i]!,
    conversions: conversions[i]!,
    earnedMinor: earnedRupees[i]! * 100,
  }));

  const buckets =
    filters.groupBy === 'day'
      ? filtered.map((d) => [d])
      : filters.groupBy === 'week'
        ? bucketFromEnd(filtered, 7)
        : monthBuckets(filtered);

  return buckets.map((bucket) => {
    const start = bucket[0]!.date;
    const end = bucket[bucket.length - 1]!.date;
    return {
      start,
      end,
      label: filters.groupBy === 'day' ? formatDayMonth(start) : formatShortRange(start, end),
      clicks: sum(bucket.map((d) => d.clicks)),
      conversions: sum(bucket.map((d) => d.conversions)),
      earnedMinor: sum(bucket.map((d) => d.earnedMinor)),
    };
  });
}

/* ---------- the whole report ---------- */

export interface Report {
  filters: ReportFilters;
  labels: { range: string; offer: string; platform: string; groupBy: string };
  start: string;
  end: string;
  funnel: FunnelStep[];
  cities: CityRow[];
  subIds: SubIdRow[];
  periods: PeriodRow[];
  /** Nothing at all matches the filters (e.g. an offer on a platform it does not run on). */
  empty: boolean;
}

export function buildReport(filters: ReportFilters): Report {
  const days = rangeDays(filters.range);
  const funnel = reportFunnel(filters);
  return {
    filters,
    labels: {
      range: rangeLabel(filters.range),
      offer: optionLabel(REPORT_OFFER_OPTIONS, filters.offerId),
      platform: optionLabel(REPORT_PLATFORM_OPTIONS, filters.platform),
      groupBy: optionLabel(GROUP_BY_OPTIONS, filters.groupBy),
    },
    start: days[0]!.date,
    end: days[days.length - 1]!.date,
    funnel,
    cities: reportCities(filters),
    subIds: reportSubIds(filters),
    periods: reportPeriods(filters),
    empty: funnel.every((s) => s.value === 0),
  };
}
