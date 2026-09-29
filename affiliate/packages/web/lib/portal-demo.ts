/**
 * Demo data for the publisher portal.
 *
 * FALLBACK / MOCK DATA ONLY. Nothing here is fetched from the API.
 * Pages must render <DemoBadge /> whenever these values are shown because
 * the real endpoint was unreachable or does not exist yet:
 * - GET /v1/publisher/earnings            -> DEMO_EARNINGS
 * - clicks / matched transactions / paid  -> no API endpoint yet (DEMO_STATS)
 * - recent conversions                    -> no API endpoint yet (DEMO_CONVERSIONS)
 * - property/programme/offer/placement lists -> no API endpoint yet (DEMO_*)
 * - statement ledger + disputes           -> no API endpoint yet (DEMO_LEDGER, DEMO_DISPUTES)
 * - operator console suspense queue       -> DEMO_SUSPENSE_ITEMS (fallback when API unreachable)
 *
 * All amounts are in paise (INR minor units). Every proper noun is
 * "Demo …" (platform invariant 11): the HEAD copy of this file named real
 * merchants as programmes; they were renamed when the pages came back
 * (2026-09-29).
 */
import type { EarningsResponse } from './api';
import { DEMO_PUBLISHER_ID } from './api';

export const DEMO_EARNINGS: EarningsResponse = {
  publisher_id: DEMO_PUBLISHER_ID,
  balances: {
    INR: { pending: 1845000, approved: 2264000, collected: 0, payable: 960000 },
  },
};

export interface PortalStats {
  clicks: number;
  matchedTransactions: number;
  paid_minor: number;
}

export const DEMO_STATS: PortalStats = {
  clicks: 12480,
  matchedTransactions: 312,
  paid_minor: 5432000,
};

export interface DemoConversion {
  id: string;
  date: string; // ISO date
  placement: string;
  product: string;
  order_minor: number;
  commission_minor: number;
  status: 'pending' | 'approved' | 'reversed';
}

export const DEMO_CONVERSIONS: DemoConversion[] = [
  {
    id: 'c-1042',
    date: '2026-09-21',
    placement: 'Demo Candid Frames / Instagram',
    product: 'Demo Aurelia Court Classic White Sneakers',
    order_minor: 499900,
    commission_minor: 34993,
    status: 'pending',
  },
  {
    id: 'c-1039',
    date: '2026-09-20',
    placement: 'Demo Candid Frames / Instagram',
    product: 'Demo Kaya Oversized Wool-Blend Blazer',
    order_minor: 899900,
    commission_minor: 62993,
    status: 'approved',
  },
  {
    id: 'c-1036',
    date: '2026-09-19',
    placement: 'Demo Star Sightings / YouTube',
    product: 'Demo Isha Champagne Silk Slip Dress',
    order_minor: 659900,
    commission_minor: 46193,
    status: 'approved',
  },
  {
    id: 'c-1031',
    date: '2026-09-18',
    placement: 'Demo Candid Frames / Instagram',
    product: 'Demo Zaveri 18K Gold-Plated Hoop Earrings',
    order_minor: 129900,
    commission_minor: 9093,
    status: 'reversed',
  },
  {
    id: 'c-1027',
    date: '2026-09-17',
    placement: 'Demo Style Diaries / Website',
    product: 'Demo Verde Milano Suede Loafers',
    order_minor: 349900,
    commission_minor: 24493,
    status: 'approved',
  },
];

export interface DemoOption {
  id: string; // uuid-shaped so it can be POSTed to /v1/links when live
  label: string;
  programme: string;
  property: string;
  placement: string;
}

export const DEMO_PROPERTIES: DemoOption[] = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Demo Candid Frames', programme: '', property: 'Demo Candid Frames', placement: '' },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Demo Star Sightings', programme: '', property: 'Demo Star Sightings', placement: '' },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', label: 'Demo Style Diaries', programme: '', property: 'Demo Style Diaries', placement: '' },
];

export const DEMO_PROGRAMMES: DemoOption[] = [
  { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', label: 'Demo Fashion Fest', programme: 'Demo Fashion Fest', property: '', placement: '' },
  { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', label: 'Demo End-of-Season Sale', programme: 'Demo End-of-Season Sale', property: '', placement: '' },
  { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', label: 'Demo Luxe Edit', programme: 'Demo Luxe Edit', property: '', placement: '' },
];

export const DEMO_OFFERS: DemoOption[] = [
  { id: '11111111-2222-4333-8444-555555555555', label: 'Demo offer: flat 7% on footwear', programme: '', property: '', placement: '' },
  { id: '66666666-7777-4888-8999-000000000000', label: 'Demo offer: up to 40% off ethnic wear', programme: '', property: '', placement: '' },
];

export const DEMO_PLACEMENTS: DemoOption[] = [
  { id: '22222222-3333-4444-8555-666666666666', label: 'Instagram bio link', programme: '', property: '', placement: 'Instagram bio link' },
  { id: '77777777-8888-4999-8aaa-bbbbbbbbbbbb', label: 'YouTube description', programme: '', property: '', placement: 'YouTube description' },
  { id: 'cccccccc-dddd-4eee-8fff-000000000000', label: 'Website sidebar', programme: '', property: '', placement: 'Website sidebar' },
];

export interface DemoLedgerEntry {
  id: string;
  date: string;
  kind: 'conversion' | 'adjustment';
  programme: string;
  property: string;
  placement: string;
  label: string;
  currency: string;
  amount_minor: number; // signed: conversions positive, reversals negative
}

export const DEMO_LEDGER: DemoLedgerEntry[] = [
  {
    id: 'L-2081', date: '2026-09-21', kind: 'conversion',
    programme: 'Demo Fashion Fest', property: 'Demo Candid Frames', placement: 'Instagram bio link',
    label: 'c-1042 · Demo Aurelia sneakers', currency: 'INR', amount_minor: 34993,
  },
  {
    id: 'L-2079', date: '2026-09-20', kind: 'conversion',
    programme: 'Demo Luxe Edit', property: 'Demo Candid Frames', placement: 'Instagram bio link',
    label: 'c-1039 · Demo Kaya blazer', currency: 'INR', amount_minor: 62993,
  },
  {
    id: 'L-2076', date: '2026-09-19', kind: 'conversion',
    programme: 'Demo End-of-Season Sale', property: 'Demo Star Sightings', placement: 'YouTube description',
    label: 'c-1036 · Demo Isha slip dress', currency: 'INR', amount_minor: 46193,
  },
  {
    id: 'L-2075', date: '2026-09-18', kind: 'adjustment',
    programme: 'Demo End-of-Season Sale', property: 'Demo Candid Frames', placement: 'Instagram bio link',
    label: 'Reversal · c-1031 returned by customer', currency: 'INR', amount_minor: -9093,
  },
  {
    id: 'L-2072', date: '2026-09-17', kind: 'conversion',
    programme: 'Demo Fashion Fest', property: 'Demo Style Diaries', placement: 'Website sidebar',
    label: 'c-1027 · Demo Verde loafers', currency: 'INR', amount_minor: 24493,
  },
];

export interface DemoDispute {
  id: string;
  conversion: string;
  reason: string;
  filed: string;
  status: 'open' | 'resolved' | 'rejected';
}

export const DEMO_DISPUTES: DemoDispute[] = [
  {
    id: 'd-14',
    conversion: 'c-1027',
    reason: 'Commission rate applied at 7% instead of the 8% contracted for Sept.',
    filed: '2026-09-19',
    status: 'open',
  },
  {
    id: 'd-09',
    conversion: 'c-0988',
    reason: 'Conversion attributed to a different placement than the click log shows.',
    filed: '2026-09-11',
    status: 'rejected',
  },
];

/**
 * Demo fallback for the operator console suspense queue
 * (GET /v1/suspense). Shown only when the API is unreachable, with
 * <DemoBadge /> rendered — same pattern as the portal pages above.
 */
import type { SuspenseItem } from './api';

export const DEMO_SUSPENSE_ITEMS: SuspenseItem[] = [
  {
    id: 'demo-sus-1',
    programme_id: 'demo-prog-1',
    programme_name: 'Demo Footwear Programme',
    provider_account_id: 'acct-demo',
    source_transaction_id: 'DEMO-TXN-101',
    returned_click_ref: 'demo-click-9f3a',
    currency: 'INR',
    eligible_value_minor: 249900,
    commission_minor: 17493,
    provider_status: 'approved',
    status: 'received',
    received_at: '2026-09-21T09:12:00.000Z',
    raw: { provider_txn: 'DEMO-TXN-101', click_ref: 'demo-click-9f3a', gross: 249900 },
    reason_code: 'CLICK_REF_UNMATCHED',
    reviewed_at: null,
    reviewed_by: null,
    review_note: null,
  },
  {
    id: 'demo-sus-2',
    programme_id: 'demo-prog-1',
    programme_name: 'Demo Footwear Programme',
    provider_account_id: 'acct-demo',
    source_transaction_id: 'DEMO-TXN-102',
    returned_click_ref: null,
    currency: 'INR',
    eligible_value_minor: 99900,
    commission_minor: 6993,
    provider_status: 'pending',
    status: 'received',
    received_at: '2026-09-20T15:40:00.000Z',
    raw: { provider_txn: 'DEMO-TXN-102', gross: 99900 },
    reason_code: 'NO_CLICK_REF',
    reviewed_at: '2026-09-21T10:00:00.000Z',
    reviewed_by: 'demo-operator',
    review_note: 'Provider feed carries no click ref; stays unknown per policy.',
  },
];
