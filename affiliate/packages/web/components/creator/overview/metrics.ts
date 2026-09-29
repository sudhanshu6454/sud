/*
 * Creator Overview (1c / 1e) — range datasets and KPI maths. Pure functions
 * over the TEST demo data (lib/demo/afflino.ts, lib/demo/creator-overview.ts)
 * and the live GET /v1/publisher/earnings response. No React, no fetch; the
 * relative imports keep it loadable by the root vitest run (no '@/' alias).
 */

import type { EarningsResponse } from '../../../lib/api';
import { earningsBalances } from '../../../lib/earnings';
import {
  DEMO_CREATOR_SUMMARY,
  PLATFORM_NAME,
  PLATFORM_SHORT,
  type DemoTopLink,
  type Platform,
} from '../../../lib/demo/afflino';
import {
  DEMO_EARNINGS_BY_PLATFORM_30D,
  DEMO_EARNINGS_PERIODS,
  DEMO_OVERVIEW_TOP_LINKS,
  DEMO_PERIOD_END,
  DEMO_PRIOR_90D_EARNINGS_RUPEES,
  DEMO_RANGE_TRAFFIC,
  type DemoRangeId,
} from '../../../lib/demo/creator-overview';
import { formatDayMonth, formatINRFromMinor, formatPct, formatRate } from '../../../lib/format';

export type OverviewRange = DemoRangeId;

export const OVERVIEW_RANGES: ReadonlyArray<{ id: OverviewRange; label: string; days: number; title: string }> = [
  { id: '7d', label: '7d', days: 7, title: 'Last 7 days' },
  { id: '30d', label: '30d', days: 30, title: 'Last 30 days' },
  { id: '90d', label: '90d', days: 90, title: 'Last 90 days' },
];

export const DEFAULT_OVERVIEW_RANGE: OverviewRange = '30d';

export function rangeInfo(range: OverviewRange) {
  const info = OVERVIEW_RANGES.find((r) => r.id === range);
  if (!info) throw new RangeError(`Unknown range ${String(range)}`);
  return info;
}

/* ---------- small maths ---------- */

export function sum(values: ReadonlyArray<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Split a non-negative integer total into integers proportional to the
 * weights (largest-remainder method): the parts always add up to the total
 * exactly, ties go to the earlier index. All-zero weights split evenly.
 */
export function allocateByWeights(total: number, weights: ReadonlyArray<number>): number[] {
  if (!Number.isInteger(total) || total < 0) throw new RangeError(`total must be a non-negative integer, got ${total}`);
  if (weights.length === 0) {
    if (total !== 0) throw new RangeError('cannot allocate a non-zero total over no weights');
    return [];
  }
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) throw new RangeError('weights must be finite and >= 0');
  const weightSum = sum(weights);
  if (weightSum === 0) return allocateByWeights(total, weights.map(() => 1));
  const raw = weights.map((w) => (total * w) / weightSum);
  const parts = raw.map((r) => Math.floor(r));
  let remainder = total - sum(parts);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) parts[order[k]!.i]! += 1;
  return parts;
}

/** Percentage change, current vs prior; null when there is no prior to compare with. */
export function deltaPct(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}

/** part / whole as a whole percentage (0 when the whole is 0). */
export function sharePct(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/* ---------- calendar dates (YYYY-MM-DD) ---------- */

function parseIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDays(iso: string, days: number): string {
  return new Date(parseIso(iso) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseIso(b) - parseIso(a)) / 86_400_000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

/** "1–30 Sep 2026", "3 Jul–30 Sep 2026", "28 Dec 2025–3 Jan 2026"; a single day is "30 Sep 2026". */
export function formatRangeLabel(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  const tail = `${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (start === end) return tail;
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}–${tail}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]}–${tail}`;
  return `${a.d}–${tail}`;
}

/** formatRangeLabel without the year: "24–30 Sep", "27 Aug–2 Sep", "30 Sep". */
export function formatShortRange(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${b.d} ${MONTHS[b.m - 1]}`;
  if (a.m !== b.m || a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]}–${b.d} ${MONTHS[b.m - 1]}`;
  return `${a.d}–${b.d} ${MONTHS[b.m - 1]}`;
}

/** "Sat" for 2026-10-03. */
export function weekdayShort(iso: string): string {
  return formatDayMonth(iso, { weekday: true }).split(' ')[0] ?? '';
}

/* ---------- the 90-day demo series ---------- */

export interface DemoDay {
  date: string;
  earnedMinor: number;
  clicks: number;
  conversions: number;
}

export const DEMO_SERIES_DAYS = 90;

/**
 * The 90 demo days (3 Jul – 30 Sep 2026), oldest first. Earnings come from
 * DEMO_EARNINGS_PERIODS; clicks and conversions are split so that the last
 * 7 / 30 / 90 days add up exactly to DEMO_RANGE_TRAFFIC's totals (clicks
 * follow a flattened earnings curve, conversions follow it as drawn).
 */
export function buildDemoSeries(): DemoDay[] {
  const periods = DEMO_EARNINGS_PERIODS;
  const first = periods[0]!.start;
  periods.forEach((p, i) => {
    if (daysBetween(first, p.start) !== i * 30 || p.weights.length !== 30) {
      throw new Error('DEMO_EARNINGS_PERIODS must be three contiguous 30-day periods');
    }
  });
  if (addDays(first, DEMO_SERIES_DAYS - 1) !== DEMO_PERIOD_END) throw new Error('demo series must end on DEMO_PERIOD_END');

  const earnedRupees = periods.flatMap((p) => allocateByWeights(p.totalRupees, p.weights));
  const earningWeights = periods.flatMap((p) => [...p.weights]);
  const mean = sum(earningWeights) / earningWeights.length;
  const clickWeights = earningWeights.map((w) => 0.6 * w + 0.4 * mean);

  const t7 = DEMO_RANGE_TRAFFIC['7d'];
  const t30 = DEMO_RANGE_TRAFFIC['30d'];
  const t90 = DEMO_RANGE_TRAFFIC['90d'];
  const split = (weights: number[], total7: number, total30: number, total90: number) => [
    ...allocateByWeights(total90 - total30, weights.slice(0, 60)),
    ...allocateByWeights(total30 - total7, weights.slice(60, 83)),
    ...allocateByWeights(total7, weights.slice(83)),
  ];
  const clicks = split(clickWeights, t7.clicks, t30.clicks, t90.clicks);
  const conversions = split(earningWeights, t7.conversions, t30.conversions, t90.conversions);

  return earnedRupees.map((rupees, i) => ({
    date: addDays(first, i),
    earnedMinor: rupees * 100,
    clicks: clicks[i]!,
    conversions: conversions[i]!,
  }));
}

let cachedSeries: DemoDay[] | null = null;

export function demoSeries(): ReadonlyArray<DemoDay> {
  cachedSeries ??= buildDemoSeries();
  return cachedSeries;
}

/** The days of a range, oldest first (the last 7 / 30 / 90 demo days). */
export function rangeDays(range: OverviewRange): ReadonlyArray<DemoDay> {
  const series = demoSeries();
  return series.slice(series.length - rangeInfo(range).days);
}

/**
 * Split days into buckets of `size` ending on the last day (so the newest
 * bucket is always a full week); the oldest bucket takes the remainder.
 */
export function bucketFromEnd<T>(items: ReadonlyArray<T>, size: number): T[][] {
  const buckets: T[][] = [];
  for (let end = items.length; end > 0; end -= size) buckets.unshift(items.slice(Math.max(0, end - size), end));
  return buckets;
}

/* ---------- the Overview dataset ---------- */

export interface OverviewChart {
  title: string;
  valuesMinor: number[];
  /** Value that fills the chart's full height. */
  maxMinor: number;
  highlightLast: number;
  axisLabels: [string, string, string];
  barLabels: string[];
  summary: string;
}

export interface PlatformEarning {
  platform: Platform;
  label: string;
  earnedMinor: number;
  sharePct: number;
  tone: 'accent' | 'ink' | 'muted';
}

export interface OverviewDataset {
  range: OverviewRange;
  title: string;
  shortLabel: string;
  start: string;
  end: string;
  earningsMinor: number;
  priorEarningsMinor: number;
  earningsDeltaPct: number | null;
  clicks: number;
  conversions: number;
  clicksSplitPct: { meta: number; youtube: number; snapchat: number };
  chart: OverviewChart;
  byPlatform: PlatformEarning[];
  topLinks: ReadonlyArray<DemoTopLink>;
  nextPayout: { amountMinor: number; date: string; method: string };
}

/** 7d / 30d draw one bar per day; 90d one per week (90 daily bars would not fit the 2fr column). */
export function chartTitle(range: OverviewRange): string {
  return range === '90d' ? 'Weekly earnings' : 'Daily earnings';
}

/** The design's tallest bar (97% of the chart); weekly bars get the same headroom. */
const CHART_HEADROOM = 0.97;

const PLATFORM_ORDER = ['meta', 'youtube', 'snapchat'] as const;
const PLATFORM_TONES = ['accent', 'ink', 'muted'] as const;

function buildChart(range: OverviewRange, days: ReadonlyArray<DemoDay>): OverviewChart {
  const start = days[0]!.date;
  const end = days[days.length - 1]!.date;
  const axisLabels: [string, string, string] = [
    formatDayMonth(start),
    formatDayMonth(addDays(start, Math.floor((days.length - 1) / 2))),
    formatDayMonth(end),
  ];
  const total = sum(days.map((d) => d.earnedMinor));

  if (range === '90d') {
    const weeks = bucketFromEnd(days, 7);
    const values = weeks.map((w) => sum(w.map((d) => d.earnedMinor)));
    const labels = weeks.map((w) => formatShortRange(w[0]!.date, w[w.length - 1]!.date));
    const top = Math.max(...values);
    const topIndex = values.indexOf(top);
    return {
      title: chartTitle(range),
      valuesMinor: values,
      maxMinor: top / CHART_HEADROOM,
      highlightLast: 1,
      axisLabels,
      barLabels: labels.map((l, i) => `${l} · ${formatINRFromMinor(values[i]!)}`),
      summary: `Weekly earnings, ${formatRangeLabel(start, end)}: ${formatINRFromMinor(total)} in total, highest ${formatINRFromMinor(top)} in ${labels[topIndex]}.`,
    };
  }

  // Daily bars share September's scale, so the 30-day chart draws the
  // designed heights (each day's weight is its bar height in percent).
  const september = DEMO_EARNINGS_PERIODS[DEMO_EARNINGS_PERIODS.length - 1]!;
  const maxMinor = (september.totalRupees * 100 * 100) / sum(september.weights);
  const values = days.map((d) => d.earnedMinor);
  const top = Math.max(...values);
  const topDay = days[values.indexOf(top)]!.date;
  return {
    title: chartTitle(range),
    valuesMinor: values,
    maxMinor,
    highlightLast: 3,
    axisLabels,
    barLabels: days.map((d) => `${formatDayMonth(d.date)} · ${formatINRFromMinor(d.earnedMinor)}`),
    summary: `Daily earnings, ${formatRangeLabel(start, end)}: ${formatINRFromMinor(total)} in total, highest ${formatINRFromMinor(top)} on ${formatDayMonth(topDay)}.`,
  };
}

function buildByPlatform(range: OverviewRange, earningsMinor: number): PlatformEarning[] {
  const rows =
    range === '30d'
      ? DEMO_EARNINGS_BY_PLATFORM_30D.map((r) => ({ platform: r.platform, earnedMinor: r.earnedMinor }))
      : (() => {
          const split = DEMO_RANGE_TRAFFIC[range].splitPct;
          const rupees = allocateByWeights(
            Math.round(earningsMinor / 100),
            PLATFORM_ORDER.map((p) => split[p]),
          );
          return PLATFORM_ORDER.map((platform, i) => ({ platform: platform as Platform, earnedMinor: rupees[i]! * 100 }));
        })();
  const total = sum(rows.map((r) => r.earnedMinor));
  return rows.map((r, i) => ({
    ...r,
    label: PLATFORM_NAME[r.platform],
    sharePct: sharePct(r.earnedMinor, total),
    tone: PLATFORM_TONES[i] ?? 'muted',
  }));
}

/** The demo dataset for one range. 30d reproduces the 1c artboard exactly. */
export function buildOverviewDataset(range: OverviewRange): OverviewDataset {
  const info = rangeInfo(range);
  const series = demoSeries();
  const days = rangeDays(range);
  const earningsMinor = sum(days.map((d) => d.earnedMinor));
  const priorDays = series.slice(series.length - 2 * info.days, series.length - info.days);
  const priorEarningsMinor =
    priorDays.length === info.days ? sum(priorDays.map((d) => d.earnedMinor)) : DEMO_PRIOR_90D_EARNINGS_RUPEES * 100;
  const traffic = DEMO_RANGE_TRAFFIC[range];
  return {
    range,
    title: info.title,
    shortLabel: info.label,
    start: days[0]!.date,
    end: days[days.length - 1]!.date,
    earningsMinor,
    priorEarningsMinor,
    earningsDeltaPct: deltaPct(earningsMinor, priorEarningsMinor),
    clicks: traffic.clicks,
    conversions: traffic.conversions,
    clicksSplitPct: traffic.splitPct,
    chart: buildChart(range, days),
    byPlatform: buildByPlatform(range, earningsMinor),
    topLinks: DEMO_OVERVIEW_TOP_LINKS,
    nextPayout: {
      amountMinor: DEMO_CREATOR_SUMMARY.nextPayoutMinor,
      date: DEMO_CREATOR_SUMMARY.nextPayoutDate,
      method: DEMO_CREATOR_SUMMARY.nextPayoutMethod,
    },
  };
}

/* ---------- live earnings (GET /v1/publisher/earnings) ---------- */

export interface LiveEarnings {
  /** Publisher share of conversions still awaiting brand / provider approval. */
  pendingMinor: number;
  /** Approved and not yet paid: the net publisher_liability ledger balance. */
  approvedMinor: number;
  /** pending + approved: everything earned that has not been paid out. */
  unpaidMinor: number;
  /** max(collected − payable, 0): what the next payout batch can draw (the Payouts screen's "Available to withdraw"). */
  nextBatchMinor: number;
}

/**
 * Map the earnings response onto the two KPIs it can honestly fill (the
 * buckets are explained in lib/earnings.ts, shared with Payouts 2c):
 *
 * - pending + approved is everything earned and not yet paid out
 *   → Earnings (to date: the route takes no date range).
 * - max(collected − payable, 0) is what the next payout batch can draw —
 *   the same figure Payouts prints as "Available to withdraw", as the design
 *   draws one amount (₹42,900) for both → Next payout. `approved` alone is
 *   not used there: it includes earnings the merchant has not paid for and
 *   earnings still inside the returns window.
 *
 * A currency with no activity has no bucket: that reads as zero.
 */
export function mapEarningsResponse(response: EarningsResponse, currency = 'INR'): LiveEarnings {
  const b = earningsBalances(response, currency);
  return {
    pendingMinor: b.pendingMinor,
    approvedMinor: b.approvedMinor,
    unpaidMinor: b.pendingMinor + b.approvedMinor,
    nextBatchMinor: b.nextBatchMinor,
  };
}

/* ---------- KPI view model ---------- */

export interface OverviewKpis {
  earnings: { label: string; valueMinor: number; meta: string; positive: boolean };
  clicks: { value: number; meta: string };
  conversions: { value: number; meta: string };
  conversionRate: string;
  nextPayout: { valueMinor: number; meta: string };
  /** Phone hero (1e): "Earnings · 30d" and "+22% · payout Sat ₹42,900". */
  phoneEyebrow: string;
  phoneLine: string;
  phonePositive: boolean;
}

/** "Meta 61% · YT 29% · Snap 10%" */
export function clicksSplitLine(split: { meta: number; youtube: number; snapchat: number }): string {
  return PLATFORM_ORDER.map((p) => `${PLATFORM_SHORT[p]} ${formatPct(split[p])}`).join(' · ');
}

export function overviewKpis(dataset: OverviewDataset, live: LiveEarnings | null): OverviewKpis {
  const delta = dataset.earningsDeltaPct;
  const deltaText = delta === null ? null : formatPct(delta, { signed: true });
  const payout = dataset.nextPayout;
  const conversionRate = formatRate(dataset.conversions, dataset.clicks, 2);
  const shared = {
    clicks: { value: dataset.clicks, meta: clicksSplitLine(dataset.clicksSplitPct) },
    conversions: { value: dataset.conversions, meta: `${conversionRate} CR` },
    conversionRate,
  };

  if (live) {
    const pending = formatINRFromMinor(live.pendingMinor);
    return {
      ...shared,
      earnings: { label: 'Earnings to date', valueMinor: live.unpaidMinor, meta: `Incl. ${pending} pending`, positive: false },
      nextPayout: { valueMinor: live.nextBatchMinor, meta: 'Collected, not yet in a batch' },
      phoneEyebrow: 'Earnings · to date',
      phoneLine: `payout ${formatINRFromMinor(live.nextBatchMinor)} · ${pending} pending`,
      phonePositive: false,
    };
  }

  return {
    ...shared,
    earnings: {
      label: 'Earnings',
      valueMinor: dataset.earningsMinor,
      meta: deltaText === null ? 'No prior period' : `${deltaText} vs prior`,
      positive: delta !== null && delta > 0,
    },
    nextPayout: {
      valueMinor: payout.amountMinor,
      meta: `${formatDayMonth(payout.date, { weekday: true })} · ${payout.method}`,
    },
    phoneEyebrow: `Earnings · ${dataset.shortLabel}`,
    phoneLine: `${deltaText === null ? '' : `${deltaText} · `}payout ${weekdayShort(payout.date)} ${formatINRFromMinor(payout.amountMinor)}`,
    phonePositive: delta !== null && delta > 0,
  };
}
