/*
 * CSV export for Reports (3d): RFC 4180 fields (CRLF rows; a field with a
 * comma, quote, CR or LF — or leading / trailing space — is quoted, quotes
 * doubled), numbers unformatted so a spreadsheet reads them as numbers,
 * money as rupees with two decimals computed from integer paise, and text
 * that a spreadsheet would run as a formula (=, +, -, @, tab, CR first) is
 * prefixed with an apostrophe (a plain number such as "-500.00" is left
 * alone). Pure; the page wraps the text in a Blob. The field, row and money
 * rules are lib/csv.ts (shared with Payouts and the brand's Conversions).
 */

import { csvField, csvRow, minorToRupees, ratePct, toCsv, type CsvCell } from '../../../lib/csv';
import type { Report } from './model';

export { csvField, csvRow, minorToRupees, ratePct, toCsv, type CsvCell };

/** afflino-demo-report-2026-09-01-to-2026-09-30.csv */
export function reportFilename(report: Pick<Report, 'start' | 'end'>): string {
  return `afflino-demo-report-${report.start}-to-${report.end}.csv`;
}

/**
 * The report as one CSV: a header block (what the export is and its
 * filters), then the funnel, the cities, the sub-IDs and the grouped
 * periods, each with its own header row, separated by blank lines.
 */
export function buildReportCsv(report: Report): string {
  const rows: CsvCell[][] = [
    ['Afflino report', 'TEST demo data, not real figures'],
    ['Date range', report.labels.range],
    ['From', report.start],
    ['To', report.end],
    ['Offer', report.labels.offer],
    ['Platform', report.labels.platform],
    ['Group by', report.labels.groupBy],
    [],
    ['Funnel'],
    ['Step', 'Count'],
    ...report.funnel.map((s) => [s.label, s.value]),
    [],
    ['Conversions by city'],
    ['City', 'Conversions'],
    ...report.cities.map((c) => [c.name, c.conversions]),
    [],
    ['By sub-ID'],
    ['Sub-ID', 'Clicks', 'CR (%)', 'Earned (INR)'],
    ...report.subIds.map((s) => [s.subId, s.clicks, s.crPct, minorToRupees(s.earnedMinor)]),
    [],
    [`By ${report.labels.groupBy.toLowerCase()}`],
    ['From', 'To', 'Clicks', 'Conversions', 'CR (%)', 'Earned (INR)'],
    ...report.periods.map((p) => [
      p.start,
      p.end,
      p.clicks,
      p.conversions,
      ratePct(p.conversions, p.clicks),
      minorToRupees(p.earnedMinor),
    ]),
  ];
  return toCsv(rows);
}
