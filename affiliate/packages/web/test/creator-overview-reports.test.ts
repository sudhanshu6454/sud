import { describe, expect, it } from 'vitest';
import { sum } from '../components/creator/overview/metrics';
import {
  buildReportCsv,
  csvField,
  csvRow,
  minorToRupees,
  ratePct,
  reportFilename,
  toCsv,
} from '../components/creator/reports/csv';
import {
  DEFAULT_REPORT_FILTERS,
  REPORT_OFFER_OPTIONS,
  REPORT_RANGE_OPTIONS,
  buildReport,
  buildSegments,
  reportTotals,
  type ReportFilters,
} from '../components/creator/reports/model';
import { DEMO_CITIES, DEMO_FUNNEL, DEMO_SUB_IDS } from '../lib/demo/afflino';
import { DEMO_RANGE_TRAFFIC } from '../lib/demo/creator-overview';
import { formatCount, formatCountCompact, formatINRFromMinor, formatPct } from '../lib/format';

const f = (patch: Partial<ReportFilters>): ReportFilters => ({ ...DEFAULT_REPORT_FILTERS, ...patch });

describe('Reports — the default report is the 3d artboard', () => {
  const report = buildReport(DEFAULT_REPORT_FILTERS);

  it('labels the filter tags as drawn', () => {
    expect(report.labels).toEqual({ range: '1–30 Sep 2026', offer: 'All offers', platform: 'All platforms', groupBy: 'Day' });
    expect(REPORT_RANGE_OPTIONS.map((o) => o.label)).toEqual(['24–30 Sep 2026', '1–30 Sep 2026', '3 Jul–30 Sep 2026']);
    expect(REPORT_OFFER_OPTIONS[0]).toEqual({ value: 'all', label: 'All offers' });
    expect(REPORT_OFFER_OPTIONS.slice(1).every((o) => o.label.startsWith('Demo '))).toBe(true);
  });

  it('funnel: 9.8M / 312,880 / 271,040 / 4,106 / 3,812 with bars 100 / 64 / 52 / 18 / 16', () => {
    expect(report.funnel.map((s, i) => (i === 0 ? formatCountCompact(s.value) : formatCount(s.value)))).toEqual([
      '9.8M',
      '312,880',
      '271,040',
      '4,106',
      '3,812',
    ]);
    report.funnel.forEach((s, i) => expect(s.widthPct).toBeCloseTo(DEMO_FUNNEL[i]!.widthPct, 9));
  });

  it('cities: the drawn values and widths', () => {
    expect(report.cities).toEqual(DEMO_CITIES.map((c) => ({ name: c.name, conversions: c.conversions, widthPct: c.widthPct })));
  });

  it('sub-IDs: the drawn rows', () => {
    expect(report.subIds.map((s) => [s.subId, formatCount(s.clicks), formatPct(s.crPct, { decimals: 1 }), formatINRFromMinor(s.earnedMinor)])).toEqual(
      DEMO_SUB_IDS.map((s) => [s.subId, formatCount(s.clicks), formatPct(s.crPct, { decimals: 1 }), formatINRFromMinor(s.earnedMinor)]),
    );
  });

  it('by day: 30 rows adding up to the Overview figures', () => {
    expect(report.periods).toHaveLength(30);
    expect(report.periods[0]!.label).toBe('1 Sep');
    expect(sum(report.periods.map((p) => p.clicks))).toBe(312_880);
    expect(sum(report.periods.map((p) => p.conversions))).toBe(4_106);
    expect(sum(report.periods.map((p) => p.earnedMinor))).toBe(18_432_000);
    expect(report.empty).toBe(false);
  });
});

describe('Reports — segments and filters', () => {
  it('the offer × platform segments add up to the designed totals', () => {
    const segs = buildSegments();
    const [impressions, clicks, landed, conversions, approved] = DEMO_FUNNEL.map((s) => s.value);
    expect(sum(segs.map((s) => s.impressions))).toBe(impressions);
    expect(sum(segs.map((s) => s.clicks))).toBe(clicks);
    expect(sum(segs.map((s) => s.landed))).toBe(landed);
    expect(sum(segs.map((s) => s.conversions))).toBe(conversions);
    expect(sum(segs.map((s) => s.approved))).toBe(approved);
    expect(sum(segs.map((s) => s.earnedRupees))).toBe(184_320);
  });

  it('the platform filter agrees with the Overview split (Meta 61 / YT 29 / Snap 10)', () => {
    const total = reportTotals(DEFAULT_REPORT_FILTERS).clicks;
    expect(reportTotals(f({ platform: 'meta' })).clicks / total).toBeCloseTo(0.61, 3);
    expect(reportTotals(f({ platform: 'youtube' })).clicks / total).toBeCloseTo(0.29, 3);
    expect(reportTotals(f({ platform: 'snapchat' })).clicks / total).toBeCloseTo(0.1, 3);
  });

  it('per-offer totals add back up to all offers', () => {
    const offers = REPORT_OFFER_OPTIONS.slice(1).map((o) => reportTotals(f({ offerId: o.value })));
    expect(sum(offers.map((t) => t.clicks))).toBe(312_880);
    expect(sum(offers.map((t) => t.conversions))).toBe(4_106);
  });

  it('an offer on a platform it does not run on is empty', () => {
    const report = buildReport(f({ offerId: 'demo-learn', platform: 'meta' }));
    expect(report.empty).toBe(true);
    expect(report.funnel.every((s) => s.value === 0 && s.widthPct === 0)).toBe(true);
    expect(report.subIds).toEqual([]);
    expect(report.cities.every((c) => c.conversions === 0 && c.widthPct === 0)).toBe(true);
  });

  it('sub-IDs follow their link\'s offer and platform', () => {
    expect(buildReport(f({ offerId: 'demo-payupi' })).subIds.map((s) => s.subId)).toEqual(['reel-oct-01']);
    expect(buildReport(f({ platform: 'youtube' })).subIds.map((s) => s.subId)).toEqual(['short-diwali-02', 'yt-long']);
    expect(buildReport(f({ offerId: 'demo-ludo' })).subIds).toEqual([]);
  });

  it('a filter moves the funnel bars with its rates, and cities keep the drawn shape', () => {
    const eats = buildReport(f({ offerId: 'demo-eats' }));
    const conv = eats.funnel.find((s) => s.key === 'conversions')!;
    expect(conv.widthPct).toBeGreaterThan(18); // Demo Eats Gold converts better than the average
    expect(eats.funnel[0]!.widthPct).toBe(100);
    expect(sum(eats.cities.map((c) => c.conversions))).toBeLessThanOrEqual(conv.value);
    expect(eats.cities[0]!.widthPct).toBe(100);
  });

  it('date ranges scale to the Overview range totals', () => {
    for (const range of ['7d', '90d'] as const) {
      const report = buildReport(f({ range }));
      expect(report.funnel.find((s) => s.key === 'clicks')!.value).toBe(DEMO_RANGE_TRAFFIC[range].clicks);
      expect(report.funnel.find((s) => s.key === 'conversions')!.value).toBe(DEMO_RANGE_TRAFFIC[range].conversions);
      expect(sum(report.periods.map((p) => p.clicks))).toBe(DEMO_RANGE_TRAFFIC[range].clicks);
    }
    expect(buildReport(f({ range: '7d' })).labels.range).toBe('24–30 Sep 2026');
  });

  it('groups by week (ending on the last day) and by calendar month', () => {
    const weeks = buildReport(f({ groupBy: 'week' })).periods;
    expect(weeks.map((w) => w.label)).toEqual(['1–2 Sep', '3–9 Sep', '10–16 Sep', '17–23 Sep', '24–30 Sep']);
    expect(sum(weeks.map((w) => w.clicks))).toBe(312_880);
    const months = buildReport(f({ range: '90d', groupBy: 'month' })).periods;
    expect(months.map((m) => [m.start, m.end])).toEqual([
      ['2026-07-03', '2026-07-31'],
      ['2026-08-01', '2026-08-31'],
      ['2026-09-01', '2026-09-30'],
    ]);
    expect(months[2]!.earnedMinor).toBe(18_432_000);
    const filtered = buildReport(f({ platform: 'meta', groupBy: 'week' }));
    expect(sum(filtered.periods.map((p) => p.clicks))).toBe(reportTotals(f({ platform: 'meta' })).clicks);
  });
});

describe('CSV builder', () => {
  it('escapes fields per RFC 4180', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('cr\rlf')).toBe('"cr\rlf"');
    expect(csvField(' padded ')).toBe('" padded "');
    expect(csvField('1–30 Sep 2026')).toBe('1–30 Sep 2026');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('writes numbers unformatted and never NaN', () => {
    expect(csvField(312880)).toBe('312880');
    expect(csvField(1.9)).toBe('1.9');
    expect(csvField(0)).toBe('0');
    expect(csvField(Number.NaN)).toBe('');
    expect(csvField(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('defuses text a spreadsheet would run as a formula', () => {
    expect(csvField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvField('+91 00000')).toBe("'+91 00000");
    expect(csvField('-cmd|calc')).toBe("'-cmd|calc");
    expect(csvField('@import')).toBe("'@import");
    expect(csvField('\tx')).toBe("'\tx");
    expect(csvField('=1,2')).toBe('"\'=1,2"');
    expect(csvField('-500.00')).toBe('-500.00');
  });

  it('joins rows with CRLF and ends with one', () => {
    expect(csvRow(['a', 1, null, 'b,c'])).toBe('a,1,,"b,c"');
    expect(toCsv([['h1', 'h2'], [], [1, 2]])).toBe('h1,h2\r\n\r\n1,2\r\n');
  });

  it('formats money from integer paise and rates', () => {
    expect(minorToRupees(14_094_000)).toBe('140940.00');
    expect(minorToRupees(610)).toBe('6.10');
    expect(minorToRupees(5)).toBe('0.05');
    expect(minorToRupees(-50_000)).toBe('-500.00');
    expect(() => minorToRupees(1.5)).toThrow(RangeError);
    expect(ratePct(4_106, 312_880)).toBe(1.31);
    expect(ratePct(1, 0)).toBeNull();
  });

  it('exports what the page shows, labelled as TEST demo data', () => {
    const report = buildReport(f({ groupBy: 'week' }));
    const csv = buildReportCsv(report);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Afflino report,"TEST demo data, not real figures"');
    expect(lines).toContain('Date range,1–30 Sep 2026');
    expect(lines).toContain('Group by,Week');
    expect(lines).toContain('Impressions,9800000');
    expect(lines).toContain('Approved,3812');
    expect(lines).toContain('Mumbai,812');
    expect(lines).toContain('Jaipur,204');
    expect(lines).toContain('Sub-ID,Clicks,CR (%),Earned (INR)');
    expect(lines).toContain('reel-oct-01,41200,1.9,140940.00');
    expect(lines).toContain('snap-01,19400,3.6,28080.00');
    expect(lines).toContain('By week');
    expect(lines).toContain('From,To,Clicks,Conversions,CR (%),Earned (INR)');
    expect(lines.filter((l) => /^2026-\d\d-\d\d,2026-/.test(l))).toHaveLength(5);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(reportFilename(report)).toBe('afflino-demo-report-2026-09-01-to-2026-09-30.csv');
  });
});
