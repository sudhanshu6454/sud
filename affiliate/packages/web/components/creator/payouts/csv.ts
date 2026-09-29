/*
 * "Export CSV" on Payouts (2c): the table on screen (Payouts, Conversions or
 * Clicks) as an RFC 4180 file. CRLF rows; a field with a comma, quote, CR or
 * LF (or leading / trailing space) is quoted with quotes doubled; numbers
 * unformatted; money as rupees with two decimals computed from integer
 * paise; dates as YYYY-MM-DD; text a spreadsheet would run as a formula
 * (=, +, -, @, tab, CR first) gets a leading apostrophe. The first row says
 * the file is TEST demo data (no v1 endpoint serves these tables), then a
 * blank row, then the table. Pure; the page wraps the text in a Blob.
 *
 * The field, row and money rules are lib/csv.ts (shared with Reports and
 * the brand's Conversions export).
 */

import { DEMO_CSV_LABEL, csvField, minorToRupees, ratePct, toCsv, toDemoCsv, type CsvCell } from '../../../lib/csv';
import type { DemoPayout } from '../../../lib/demo/afflino';
import { PLATFORM_NAME } from '../../../lib/demo/afflino';
import type { DemoClickRow, DemoConversionRow } from '../../../lib/demo/payouts';

export { DEMO_CSV_LABEL, csvField, minorToRupees, toCsv, type CsvCell };

/** Conversions ÷ clicks as a percentage with two decimals; empty when there are no clicks. */
export function conversionRatePct(conversions: number, clicks: number): number | null {
  return ratePct(conversions, clicks);
}

export type PayoutTable = 'payouts' | 'conversions' | 'clicks';

export function buildPayoutsCsv(rows: ReadonlyArray<DemoPayout>): string {
  return toDemoCsv([
    ['Date', 'Reference', 'Method', 'Gross (INR)', 'TDS (INR)', 'Net (INR)', 'Status'],
    ...rows.map((r) => [
      r.date,
      r.reference,
      r.method,
      minorToRupees(r.grossMinor),
      minorToRupees(r.tdsMinor),
      minorToRupees(r.netMinor),
      r.status,
    ]),
  ]);
}

export function buildConversionsCsv(rows: ReadonlyArray<DemoConversionRow>): string {
  return toDemoCsv([
    ['Date', 'Offer', 'Sub-ID', 'Platform', 'Event', 'Commission (INR)', 'Status'],
    ...rows.map((r) => [r.date, r.offer, r.subId, PLATFORM_NAME[r.platform], r.event, minorToRupees(r.commissionMinor), r.status]),
  ]);
}

export function buildClicksCsv(rows: ReadonlyArray<DemoClickRow>): string {
  return toDemoCsv([
    ['Date', 'Offer', 'Sub-ID', 'Platform', 'Clicks', 'Conversions', 'CR (%)'],
    ...rows.map((r) => [
      r.date,
      r.offer,
      r.subId,
      PLATFORM_NAME[r.platform],
      r.clicks,
      r.conversions,
      conversionRatePct(r.conversions, r.clicks),
    ]),
  ]);
}

/** afflino-demo-payouts-2026-09.csv */
export function payoutsCsvFilename(table: PayoutTable, periodKey: string): string {
  return `afflino-demo-${table}-${periodKey}.csv`;
}
