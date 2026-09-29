import { describe, expect, it } from 'vitest';
import { mapEarningsToBalances } from '../components/creator/payouts/model';
import {
  addDays,
  allocateByWeights,
  bucketFromEnd,
  buildOverviewDataset,
  clicksSplitLine,
  daysBetween,
  deltaPct,
  demoSeries,
  formatRangeLabel,
  formatShortRange,
  mapEarningsResponse,
  overviewKpis,
  rangeDays,
  sharePct,
  sum,
  weekdayShort,
} from '../components/creator/overview/metrics';
import { DEMO_DAILY_EARNINGS_PCT, DEMO_TOP_LINKS } from '../lib/demo/afflino';
import { DEMO_RANGE_TRAFFIC } from '../lib/demo/creator-overview';
import { formatCount, formatCountCompact, formatINRFromMinor } from '../lib/format';
import { DEMO_EARNINGS } from '../lib/portal-demo';

describe('allocateByWeights', () => {
  it('splits a total into integers that add up exactly, in proportion', () => {
    expect(allocateByWeights(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateByWeights(100, [61, 29, 10])).toEqual([61, 29, 10]);
    expect(allocateByWeights(7, [0.5, 0.25, 0.25])).toEqual([3, 2, 2]);
    const parts = allocateByWeights(184_320, DEMO_DAILY_EARNINGS_PCT);
    expect(sum(parts)).toBe(184_320);
    parts.forEach((p, i) => expect(Math.abs(p - (184_320 * DEMO_DAILY_EARNINGS_PCT[i]!) / 2180)).toBeLessThan(1));
  });

  it('gives remainders to the largest fractions, ties to the earlier index', () => {
    expect(allocateByWeights(1, [1, 1])).toEqual([1, 0]);
    expect(allocateByWeights(5, [1, 2])).toEqual([2, 3]);
  });

  it('handles zero weights and zero totals, rejects bad input', () => {
    expect(allocateByWeights(0, [3, 4])).toEqual([0, 0]);
    expect(allocateByWeights(3, [0, 0, 0])).toEqual([1, 1, 1]);
    expect(allocateByWeights(0, [])).toEqual([]);
    expect(() => allocateByWeights(1.5, [1])).toThrow(RangeError);
    expect(() => allocateByWeights(-1, [1])).toThrow(RangeError);
    expect(() => allocateByWeights(1, [-1, 2])).toThrow(RangeError);
    expect(() => allocateByWeights(1, [])).toThrow(RangeError);
  });
});

describe('range maths', () => {
  it('computes deltas and shares', () => {
    expect(deltaPct(184_320, 151_082)).toBeCloseTo(22, 3);
    expect(deltaPct(90, 100)).toBeCloseTo(-10, 9);
    expect(deltaPct(5, 0)).toBeNull();
    expect(sharePct(112_400, 184_320)).toBe(61);
    expect(sharePct(1, 0)).toBe(0);
  });

  it('does calendar arithmetic and labels', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-07-03', 89)).toBe('2026-09-30');
    expect(daysBetween('2026-07-03', '2026-09-30')).toBe(89);
    expect(formatRangeLabel('2026-09-01', '2026-09-30')).toBe('1–30 Sep 2026');
    expect(formatRangeLabel('2026-07-03', '2026-09-30')).toBe('3 Jul–30 Sep 2026');
    expect(formatRangeLabel('2025-12-28', '2026-01-03')).toBe('28 Dec 2025–3 Jan 2026');
    expect(formatRangeLabel('2026-09-30', '2026-09-30')).toBe('30 Sep 2026');
    expect(formatShortRange('2026-09-24', '2026-09-30')).toBe('24–30 Sep');
    expect(formatShortRange('2026-08-27', '2026-09-02')).toBe('27 Aug–2 Sep');
    expect(weekdayShort('2026-10-03')).toBe('Sat');
  });

  it('buckets from the end so the newest bucket is whole', () => {
    expect(bucketFromEnd([1, 2, 3, 4, 5, 6, 7, 8, 9], 4)).toEqual([[1], [2, 3, 4, 5], [6, 7, 8, 9]]);
    expect(bucketFromEnd([], 7)).toEqual([]);
  });
});

describe('the 90-day demo series', () => {
  it('runs 3 Jul – 30 Sep 2026 and meets every range total exactly', () => {
    const series = demoSeries();
    expect(series).toHaveLength(90);
    expect(series[0]!.date).toBe('2026-07-03');
    expect(series[89]!.date).toBe('2026-09-30');
    for (const range of ['7d', '30d', '90d'] as const) {
      const days = rangeDays(range);
      expect(sum(days.map((d) => d.clicks))).toBe(DEMO_RANGE_TRAFFIC[range].clicks);
      expect(sum(days.map((d) => d.conversions))).toBe(DEMO_RANGE_TRAFFIC[range].conversions);
    }
    expect(sum(rangeDays('30d').map((d) => d.earnedMinor))).toBe(18_432_000);
    expect(series.every((d) => d.earnedMinor % 100 === 0)).toBe(true);
  });
});

describe('Overview datasets', () => {
  it('30d reproduces the 1c artboard', () => {
    const d = buildOverviewDataset('30d');
    const k = overviewKpis(d, null);
    expect(d.title).toBe('Last 30 days');
    expect(formatINRFromMinor(k.earnings.valueMinor)).toBe('₹1,84,320');
    expect(k.earnings.meta).toBe('+22% vs prior');
    expect(k.earnings.positive).toBe(true);
    expect(formatCount(k.clicks.value)).toBe('312,880');
    expect(k.clicks.meta).toBe('Meta 61% · YT 29% · Snap 10%');
    expect(formatCount(k.conversions.value)).toBe('4,106');
    expect(k.conversions.meta).toBe('1.31% CR');
    expect(formatINRFromMinor(k.nextPayout.valueMinor)).toBe('₹42,900');
    // The design prints "Fri 3 Oct"; 3 Oct 2026 is a Saturday (lib/demo/afflino.ts).
    expect(k.nextPayout.meta).toBe('Sat 3 Oct · UPI');

    expect(d.chart.title).toBe('Daily earnings');
    expect(d.chart.valuesMinor).toHaveLength(30);
    expect(d.chart.highlightLast).toBe(3);
    expect(d.chart.axisLabels).toEqual(['1 Sep', '15 Sep', '30 Sep']);
    d.chart.valuesMinor.forEach((v, i) =>
      expect(Math.abs((v / d.chart.maxMinor) * 100 - DEMO_DAILY_EARNINGS_PCT[i]!)).toBeLessThan(0.05),
    );

    expect(d.byPlatform.map((p) => [p.label, formatINRFromMinor(p.earnedMinor), p.sharePct, p.tone])).toEqual([
      ['Meta', '₹1,12,400', 61, 'accent'],
      ['YouTube', '₹53,500', 29, 'ink'],
      ['Snapchat', '₹18,420', 10, 'muted'],
    ]);
    expect(d.topLinks).toEqual(DEMO_TOP_LINKS);
  });

  it('30d on the phone is the 1e hero and mini KPI row', () => {
    const k = overviewKpis(buildOverviewDataset('30d'), null);
    expect(k.phoneEyebrow).toBe('Earnings · 30d');
    expect(k.phoneLine).toBe('+22% · payout Sat ₹42,900');
    expect(formatCountCompact(k.clicks.value)).toBe('312.8K');
    expect(k.conversionRate).toBe('1.31%');
  });

  it('7d is the last seven days of the series, compared with the seven before', () => {
    const d = buildOverviewDataset('7d');
    const series = demoSeries();
    expect(d.title).toBe('Last 7 days');
    expect([d.start, d.end]).toEqual(['2026-09-24', '2026-09-30']);
    expect(d.earningsMinor).toBe(sum(series.slice(83).map((x) => x.earnedMinor)));
    expect(d.priorEarningsMinor).toBe(sum(series.slice(76, 83).map((x) => x.earnedMinor)));
    expect(d.chart.valuesMinor).toHaveLength(7);
    expect(d.chart.axisLabels).toEqual(['24 Sep', '27 Sep', '30 Sep']);
    expect(sum(d.byPlatform.map((p) => p.earnedMinor))).toBe(d.earningsMinor);
    expect(overviewKpis(d, null).earnings.meta).toBe('+4% vs prior');
  });

  it('90d draws weekly bars that add up to the range', () => {
    const d = buildOverviewDataset('90d');
    expect(d.title).toBe('Last 90 days');
    expect(d.chart.title).toBe('Weekly earnings');
    expect(d.chart.valuesMinor).toHaveLength(13);
    expect(d.chart.highlightLast).toBe(1);
    expect(sum(d.chart.valuesMinor)).toBe(d.earningsMinor);
    expect(d.chart.valuesMinor[12]).toBe(buildOverviewDataset('7d').earningsMinor);
    expect(d.chart.axisLabels).toEqual(['3 Jul', '16 Aug', '30 Sep']);
    expect(d.chart.barLabels[0]).toMatch(/^3–8 Jul · ₹/);
    expect(Math.max(...d.chart.valuesMinor) / d.chart.maxMinor).toBeCloseTo(0.97, 9);
    expect(sum(d.byPlatform.map((p) => p.earnedMinor))).toBe(d.earningsMinor);
    expect(overviewKpis(d, null).clicks.meta).toBe('Meta 63% · YT 28% · Snap 9%');
  });

  it('prints the platform split in the drawn order', () => {
    expect(clicksSplitLine({ meta: 60, youtube: 30, snapchat: 10 })).toBe('Meta 60% · YT 30% · Snap 10%');
  });
});

describe('live earnings mapping (GET /v1/publisher/earnings)', () => {
  it('Unpaid earnings = pending + approved, Next payout = max(collected − payable, 0)', () => {
    const live = mapEarningsResponse(DEMO_EARNINGS);
    expect(live).toEqual({ pendingMinor: 1_845_000, approvedMinor: 2_264_000, unpaidMinor: 4_109_000, nextBatchMinor: 0 });
    const k = overviewKpis(buildOverviewDataset('30d'), live);
    // Not "to date": approved is the net liability, which a paid batch debits.
    expect(k.earnings.label).toBe('Unpaid earnings');
    expect(formatINRFromMinor(k.earnings.valueMinor)).toBe('₹41,090');
    expect(k.earnings.meta).toBe('₹18,450 pending · ₹22,640 approved');
    expect(k.earnings.positive).toBe(false);
    // DEMO_EARNINGS: collected 0, payable ₹9,600 → nothing left for the next batch.
    expect(formatINRFromMinor(k.nextPayout.valueMinor)).toBe('₹0');
    expect(k.nextPayout.meta).toBe('Collected, not yet in a batch');
    expect(k.phoneEyebrow).toBe('Unpaid earnings');
    expect(k.phoneLine).toBe('payout ₹0 · ₹18,450 pending');
    for (const text of [k.earnings.label, k.earnings.meta, k.phoneEyebrow, k.phoneLine]) expect(text).not.toMatch(/to date/i);
  });

  it('prints live paise exactly and names a clawback instead of summing below pending', () => {
    const live = mapEarningsResponse({
      publisher_id: 'x',
      balances: { INR: { pending: 1_234_550, approved: -20_000, collected: 4_290_050, payable: 0 } },
    });
    const k = overviewKpis(buildOverviewDataset('30d'), live);
    expect(k.earnings.meta).toBe('₹12,345.50 pending · ₹200 reversed after payout');
    expect(k.phoneLine).toBe('payout ₹42,900.50 · ₹12,345.50 pending');
  });

  it('Next payout is the same figure as the Payouts screen\'s "Available to withdraw"', () => {
    const response = {
      publisher_id: 'x',
      balances: { INR: { pending: 0, approved: 500, collected: 999_999, payable: 888_888 } },
    };
    const live = mapEarningsResponse(response);
    expect(live).toEqual({ pendingMinor: 0, approvedMinor: 500, unpaidMinor: 500, nextBatchMinor: 111_111 });
    expect(live.nextBatchMinor).toBe(mapEarningsToBalances(response).availableMinor);
    expect(mapEarningsResponse({ publisher_id: 'x', balances: {} })).toEqual({
      pendingMinor: 0,
      approvedMinor: 0,
      unpaidMinor: 0,
      nextBatchMinor: 0,
    });
  });
});
