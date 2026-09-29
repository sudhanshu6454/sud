/*
 * Suspense queue (/admin/suspense) — the pure parts: the GET /v1/suspense
 * query and the display labels. Relative imports only (tested in
 * test/admin-queue.test.ts).
 */

import type { SuspenseReasonCode } from '../../lib/api';

export interface SuspenseFilters {
  connector: string;
  programmeId: string;
  /** YYYY-MM-DD from a date input, read as an India (Asia/Kolkata) calendar day. */
  from: string;
  to: string;
  reviewed: '' | 'true' | 'false';
}

export const EMPTY_SUSPENSE_FILTERS: SuspenseFilters = { connector: '', programmeId: '', from: '', to: '', reviewed: '' };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query for GET /v1/suspense. The Received column prints India time, so the
 * date filters are India calendar days: "from" is 00:00 IST that day and "to"
 * is the last millisecond of that day (the API's bounds are inclusive), so
 * from = to = one day returns that whole day.
 */
export function suspenseQuery(f: SuspenseFilters, limit = 100): string {
  const params = new URLSearchParams();
  if (f.connector.trim()) params.set('connector', f.connector.trim());
  if (f.programmeId.trim()) params.set('programme_id', f.programmeId.trim());
  if (DAY.test(f.from)) params.set('received_from', `${f.from}T00:00:00.000+05:30`);
  if (DAY.test(f.to)) params.set('received_to', `${f.to}T23:59:59.999+05:30`);
  if (f.reviewed) params.set('reviewed', f.reviewed);
  params.set('limit', String(limit));
  return `/v1/suspense?${params.toString()}`;
}

/** Sentence-case labels for the API's reason codes. */
export const SUSPENSE_REASON_LABELS: Record<SuspenseReasonCode, string> = {
  CLICK_REF_UNMATCHED: 'Click ref unmatched',
  NO_CLICK_REF: 'No click ref',
  TRACKING_ID_UNMAPPED: 'Tracking ID not mapped',
  TRACKING_ID_IS_STORE_DEFAULT: 'Store ID, no page',
  TRACKING_ID_MAPPED_AFTER_SALE: 'Tracking ID mapped after the sale',
  ATTRIBUTION_CONFLICT: 'Click and tracking ID disagree',
};

export function suspenseReasonLabel(code: string): string {
  const known = SUSPENSE_REASON_LABELS[code as SuspenseReasonCode];
  if (known) return known;
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words ? words[0]!.toUpperCase() + words.slice(1) : code;
}

/**
 * Why "Retry attribution" cannot run on a row ('' when it can): the API
 * retries against a click reference or a reported tracking ID (Amazon), and
 * refuses a row with neither (422).
 */
export function retryBlockedReason(returnedClickRef: string | null, returnedTrackingRef: string | null = null): string {
  if (returnedClickRef || returnedTrackingRef) return '';
  return 'No click reference or tracking ID on this row, so there is nothing to retry against.';
}

/** The row's reference as shown: the click ref, else the tracking ID (Amazon), else none. */
export function suspenseRefLabel(item: { returned_click_ref: string | null; returned_tracking_ref?: string | null }): {
  kind: 'ref' | 'tracking ID';
  value: string | null;
} {
  if (item.returned_click_ref) return { kind: 'ref', value: item.returned_click_ref };
  if (item.returned_tracking_ref) return { kind: 'tracking ID', value: item.returned_tracking_ref };
  return { kind: 'ref', value: null };
}
