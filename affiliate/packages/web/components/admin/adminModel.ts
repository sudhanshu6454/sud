/*
 * Status helpers for the undrawn admin pages: a brand's or a creator's
 * status follows its review-queue decision (this browser's demo decisions),
 * and the page's filter counts follow the statuses. Pure; relative imports
 * only (tests import it without the '@/' alias).
 */

import type { AdminBrand, AdminCreator, SettlementBatch } from '../../lib/demo/admin';
import { formatCount, formatDayMonth } from '../../lib/format';
import type { Decisions } from './queueModel';

/* ---------- brands ---------- */

export type BrandStatusShown = AdminBrand['status'] | 'Rejected';
export type BrandFilter = 'all' | 'Active' | 'In review' | 'Paused';

export const BRAND_FILTERS: ReadonlyArray<{ value: BrandFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'Active', label: 'Active' },
  { value: 'In review', label: 'In review' },
  { value: 'Paused', label: 'Paused' },
];

/** A brand in review becomes Active when its first offer is approved, Rejected when it is rejected. */
export function brandStatus(brand: AdminBrand, decisions: Decisions): BrandStatusShown {
  const record = brand.reviewItemId ? decisions[brand.reviewItemId] : undefined;
  if (brand.status !== 'In review' || !record) return brand.status;
  if (record.decision === 'approved') return 'Active';
  if (record.decision === 'rejected') return 'Rejected';
  return 'In review';
}

export function brandInFilter(status: BrandStatusShown, filter: BrandFilter): boolean {
  return filter === 'all' || status === filter;
}

/** The network's brand counts, moved by the sample brands' decisions. */
export function brandCounts(
  base: Readonly<Record<BrandFilter, number>>,
  brands: ReadonlyArray<AdminBrand>,
  decisions: Decisions,
): Record<BrandFilter, number> {
  const out = { ...base };
  for (const b of brands) {
    const shown = brandStatus(b, decisions);
    if (shown === b.status) continue;
    out[b.status as BrandFilter] = Math.max(0, out[b.status as BrandFilter] - 1);
    if (shown !== 'Rejected') out[shown] += 1;
  }
  return out;
}

/* ---------- creators ---------- */

export type KycShown = AdminCreator['kyc'] | 'Info requested' | 'Rejected';
export type CreatorFilter = 'all' | 'Verified' | 'In review' | 'Not verified';

export const CREATOR_FILTERS: ReadonlyArray<{ value: CreatorFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'Verified', label: 'Verified' },
  { value: 'In review', label: 'In review' },
  { value: 'Not verified', label: 'Not verified' },
];

/** KYC in review follows its queue decision: Verified, Rejected or Info requested (still in review). */
export function creatorKyc(creator: AdminCreator, decisions: Decisions): KycShown {
  const record = creator.reviewItemId ? decisions[creator.reviewItemId] : undefined;
  if (creator.kyc !== 'In review' || !record) return creator.kyc;
  if (record.decision === 'approved') return 'Verified';
  if (record.decision === 'rejected') return 'Rejected';
  return 'Info requested';
}

export function kycBucket(kyc: KycShown): Exclude<CreatorFilter, 'all'> {
  if (kyc === 'Verified') return 'Verified';
  if (kyc === 'In review' || kyc === 'Info requested') return 'In review';
  return 'Not verified';
}

export function creatorCounts(
  base: Readonly<Record<CreatorFilter, number>>,
  creators: ReadonlyArray<AdminCreator>,
  decisions: Decisions,
): Record<CreatorFilter, number> {
  const out = { ...base };
  for (const c of creators) {
    const from = kycBucket(c.kyc);
    const to = kycBucket(creatorKyc(c, decisions));
    if (from === to) continue;
    out[from] = Math.max(0, out[from] - 1);
    out[to] += 1;
  }
  return out;
}

/* ---------- settlements ---------- */

/** "1–7 Sep", "29 Sep – 5 Oct". */
export function periodLabel(batch: Pick<SettlementBatch, 'from' | 'to'>): string {
  const from = formatDayMonth(batch.from);
  const to = formatDayMonth(batch.to);
  const [fromDay, fromMonth] = from.split(' ');
  const [toDay, toMonth] = to.split(' ');
  return fromMonth === toMonth ? `${fromDay}–${toDay} ${toMonth}` : `${from} – ${to}`;
}

/** "1 live offer" / "3 live offers" (the phone rows' meta line). */
export function liveOffersLabel(n: number): string {
  return `${formatCount(n)} live offer${n === 1 ? '' : 's'}`;
}
