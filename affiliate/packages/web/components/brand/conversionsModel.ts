/**
 * Brand conversions — pure helpers (relative imports only; tested): the
 * brand's own approve / reject decisions over the TEST rows, the month
 * counts they move, the validate-by date and the CSV export.
 *
 * CSV rules are lib/csv.ts, shared with the creator's Reports and Payouts
 * exports (RFC 4180, CRLF, quoted fields, formula-looking text prefixed with
 * an apostrophe, money as rupees with two decimals from integer paise, a
 * first row saying the file is TEST demo data).
 */

import { DEMO_CSV_LABEL, csvField, minorToRupees, toDemoCsv } from '../../lib/csv';
import { PLATFORM_NAME } from '../../lib/demo/afflino';
import {
  DEMO_BRAND_OFFERS,
  type ConversionStatus,
  type DemoConversion,
} from '../../lib/demo/brand';
import { VALIDATION_WINDOW_DAYS } from '../../lib/site-copy';

export type ConversionDecision = { status: 'Approved' } | { status: 'Rejected'; reason: string };

/** The brand may decide pending conversions only; flagged ones are held by the network's fraud review. */
export function canDecide(row: Pick<DemoConversion, 'status'>): boolean {
  return row.status === 'Pending';
}

export function applyDecisions(
  rows: ReadonlyArray<DemoConversion>,
  decisions: Readonly<Record<string, ConversionDecision>>,
): DemoConversion[] {
  return rows.map((r) => {
    const d = decisions[r.id];
    if (!d || !canDecide(r)) return r;
    return d.status === 'Rejected' ? { ...r, status: 'Rejected', reason: d.reason } : { ...r, status: 'Approved' };
  });
}

/** Month totals after this browser's decisions (each decided pending row moves one count). */
export function adjustCounts(
  counts: Readonly<Record<ConversionStatus, number>>,
  rows: ReadonlyArray<DemoConversion>,
  decisions: Readonly<Record<string, ConversionDecision>>,
): Record<ConversionStatus, number> {
  const next = { ...counts };
  for (const r of rows) {
    const d = decisions[r.id];
    if (!d || !canDecide(r)) continue;
    next.Pending -= 1;
    next[d.status] += 1;
  }
  return next;
}

/** Validation window of the conversion's offer (by name), else the default. */
export function windowDays(offerName: string): number {
  return DEMO_BRAND_OFFERS.find((o) => o.name === offerName)?.validationDays ?? VALIDATION_WINDOW_DAYS;
}

/** YYYY-MM-DD, India time, `days` after the conversion. */
export function validateBy(atIso: string, days: number): string {
  const at = new Date(atIso);
  const end = new Date(at.getTime() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(end);
}

/** "14:02" in India time. */
export function timeOfDay(atIso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(
    new Date(atIso),
  );
}

export const REJECT_REASONS: ReadonlyArray<string> = [
  'Duplicate account',
  'Event not completed',
  'Order cancelled or returned',
  'Outside the offer rules',
  'Other',
];

/** A rejection needs a reason; "Other" needs a note. */
export function validateRejection(reason: string, note: string): string | null {
  if (!REJECT_REASONS.includes(reason)) return 'Choose why you are rejecting it.';
  if (reason === 'Other' && note.trim().length < 5) return 'Add a short note (at least 5 characters).';
  if (note.trim().length > 200) return 'Keep the note to 200 characters.';
  return null;
}

export function rejectionText(reason: string, note: string): string {
  const n = note.trim();
  return reason === 'Other' ? n : n ? `${reason}: ${n}` : reason;
}

/* ---------- CSV ---------- */

export { DEMO_CSV_LABEL, csvField, minorToRupees };

export function buildConversionsCsv(rows: ReadonlyArray<DemoConversion>): string {
  return toDemoCsv([
    ['time_ist', 'conversion_id', 'creator', 'platform', 'offer', 'sub_id', 'payout_inr', 'status', 'reason'],
    ...rows.map((r) => [
      r.at,
      r.id,
      r.creator,
      PLATFORM_NAME[r.platform],
      r.offer,
      r.subId,
      minorToRupees(r.payoutMinor),
      r.status.toLowerCase(),
      r.reason ?? '',
    ]),
  ]);
}
