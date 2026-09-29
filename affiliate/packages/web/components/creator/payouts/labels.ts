/*
 * Display helpers shared by the payouts sub-pages (disputes, statements).
 * Pure (unit-tested in test/payouts.test.ts).
 */

import { formatDayMonth } from '../../../lib/format';
import type { TagVariant } from '../../ui/Tag';

/** "2026-09-19" or an ISO timestamp → "19 Sep 2026" (timestamps read in India time). */
export function formatLongDate(value: string): string {
  const dayMonth = formatDayMonth(value);
  if (dayMonth === '—') return dayMonth;
  const plain = /^(\d{4})-\d{2}-\d{2}$/.exec(value);
  const year = plain
    ? plain[1]
    : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date(value));
  return `${dayMonth} ${year}`;
}

/** "under_review" → "Under review". */
export function humanise(code: string): string {
  const text = code.replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : text;
}

/** Dispute status → tag: open / under review wait on the network team (outline), resolved (accent), rejected (neutral). */
export function disputeStatusTag(status: string): TagVariant {
  switch (status) {
    case 'open':
    case 'under_review':
      return 'outline';
    case 'resolved':
      return 'accent';
    default:
      return 'neutral';
  }
}

/** A live dispute id is a uuid: show its first 8 characters ("#3f2a9c1b"); demo ids ("d-14") as they are. */
export function shortTicketId(id: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? `#${id.slice(0, 8)}` : id;
}
