/**
 * TEST DEMO DATA — NOT REAL. The admin console (2e) and the admin pages the
 * handover lists but does not draw (brands, creators, offers, fraud,
 * settlements). No v1 endpoint serves any of it, so every page that renders
 * it shows <DemoBadge variant="mock" />.
 *
 * Platform invariant 11 (affiliate project notes): every proper noun is
 * "Demo …", handles are demo-*, domains are example.* — the same one-for-one
 * mapping as lib/demo/afflino.ts, whose 2e figures (GMV ₹4.8Cr, network fee
 * ₹52.6L, 128 live offers, 18,406 creators, 1,284 flagged conversions, the
 * queue counts 212 / 14 / 76 / 122) are kept exactly as designed. The
 * undrawn pages' figures are made up to agree with those totals: the four
 * fraud signals add up to 1,284 flagged conversions and 122 open cases, the
 * creators' KYC split adds up to 18,406, the September settlement fees add
 * up to the ₹52.6L network fee. Money is integer minor units (paise), INR.
 *
 * Link subjects use the design's readable format (afflino.com/r/demo-…);
 * the platform only mints /r/{32-hex token} and sets no cookies.
 *
 * The fraud signals, their thresholds and the KYC name check are the
 * design's examples. None of them is implemented in the platform: no fraud
 * detection, KYC or PAN verification exists in this build.
 */

import { VALIDATION_WINDOW_DAYS } from '../site-copy';
import {
  DEMO_REVIEW_COUNTS,
  DEMO_REVIEW_QUEUE,
  demoLinkUrl,
  type DemoReviewItem,
  type Platform,
  type ReviewType,
} from './afflino';

/* ---------- 2e KPI strip ---------- */

export const DEMO_ADMIN_PERIOD = { month: 'September', monthShort: 'Sep' } as const;

/** 2e KPIs: GMV · Sep ₹4.8Cr, Network fee ₹52.6L, Live offers 128, Creators 18,406, Flagged conversions 1,284. */
export const DEMO_ADMIN_KPIS = {
  gmvMinor: 4_800_000_000, // ₹4.8Cr
  networkFeeMinor: 526_000_000, // ₹52.6L
  liveOffers: 128,
  creators: 18_406,
  flaggedConversions: 1_284,
} as const;

/* ---------- review queue (2e, /admin/offers, /admin/fraud, /admin/creators) ---------- */

export type FraudSignalId = 'device-cluster' | 'fast-conversion' | 'asn-concentration' | 'install-velocity';

export interface AdminReviewItem extends DemoReviewItem {
  /** Facts shown in the review panel, in order. */
  details: ReadonlyArray<{ label: string; value: string }>;
  /** Fraud items: the signal that raised the case. */
  signal?: FraudSignalId;
}

const DETAILS: Record<string, ReadonlyArray<{ label: string; value: string }>> = {
  'rq-demo-1': [
    { label: 'Signal', value: 'Device-ID clustering' },
    { label: 'Creator', value: 'Demo Deals Channel · Telegram' },
    { label: 'Offer', value: 'Demo Ludo Arena · CPI ₹22 / install' },
    { label: 'Installs in window', value: '2,140 in 2h' },
    { label: 'Distinct device IDs', value: '3' },
    { label: 'Payout held', value: '₹47,080' },
  ],
  'rq-demo-2': [
    { label: 'Brand', value: 'Demo CardMint · new brand · Starter plan' },
    { label: 'Offer', value: 'Credit card · CPA ₹900 / approved card' },
    { label: 'Platforms', value: 'Meta · YT' },
    { label: 'Validation window', value: `${VALIDATION_WINDOW_DAYS} days` },
    { label: 'Why in review', value: 'First offer from a new brand: documents, landing page and brief to check' },
  ],
  'rq-demo-3': [
    { label: 'Creator', value: 'Demo Meera Tech · YouTube · 420K' },
    { label: 'Name on the account', value: 'Demo Meera Tech' },
    { label: 'Name on the PAN record', value: 'DEMO MEERA T' },
    { label: 'Payouts', value: 'On hold until resolved · ₹38,200 earned in Sep' },
  ],
  'rq-demo-4': [
    { label: 'Signal', value: 'Click-to-conversion under 4s' },
    { label: 'Creator', value: 'Demo Kanika Daily · Snapchat' },
    { label: 'Offer', value: 'Demo Eats Gold · CPA ₹40 / purchase' },
    { label: 'Conversions flagged', value: '186 in 24h' },
    { label: 'Median click to conversion', value: '2.6s' },
    { label: 'Payout held', value: '₹7,440' },
  ],
  'rq-demo-5': [
    { label: 'Brand', value: 'Demo Style Festive · Network plan' },
    { label: 'Change', value: 'CPS 12% → 10% of order value' },
    { label: 'Live links on the offer', value: '1,140' },
    { label: 'Why in review', value: 'Payout lowered while the campaign is live' },
  ],
  'rq-demo-6': [
    { label: 'Brand', value: 'Demo Rail Trips · Starter plan' },
    { label: 'Offer', value: 'Winter sale · CPS 5% / booking' },
    { label: 'Landing page', value: 'winter-sale.example.net' },
    { label: 'Allowed domain', value: 'shop.example.com' },
  ],
  'rq-demo-7': [
    { label: 'Brand', value: 'Demo Learn Plus · Starter plan' },
    { label: 'Offer', value: 'CPL ₹150 / qualified lead' },
    { label: 'Change', value: 'Brief rewritten: new outcome claims for creators to repeat' },
  ],
  'rq-demo-8': [
    { label: 'Brand', value: 'Demo Eats Gold · Network plan' },
    { label: 'Offer', value: 'Gold membership · CPA ₹40 / purchase' },
    { label: 'Change', value: 'Snapchat added to Meta' },
  ],
  'rq-demo-9': [
    { label: 'Signal', value: 'IP / ASN concentration' },
    { label: 'Creator', value: 'Demo Arjun Reels · Instagram' },
    { label: 'Offer', value: 'Demo PayUPI · CPA ₹180 / sign-up' },
    { label: 'Clicks from one ASN', value: '41% of 6,020 in 1h' },
    { label: 'Payout held', value: '₹13,500' },
  ],
  'rq-demo-10': [
    { label: 'Signal', value: 'Install velocity' },
    { label: 'Creator', value: 'Demo Vikram Vlogs · Instagram' },
    { label: 'Offer', value: 'Demo Ludo Arena · CPI ₹22 / install' },
    { label: 'Installs per hour', value: '14× the 7-day hourly baseline' },
    { label: 'Payout held', value: '₹9,680' },
  ],
};

const SIGNAL_BY_ITEM: Record<string, FraudSignalId> = {
  'rq-demo-1': 'device-cluster',
  'rq-demo-4': 'fast-conversion',
  'rq-demo-9': 'asn-concentration',
  'rq-demo-10': 'install-velocity',
};

/** Queue items beyond the five 2e draws: more in-review offers and fraud cases for the undrawn pages. */
const EXTRA_ITEMS: ReadonlyArray<DemoReviewItem> = [
  { id: 'rq-demo-6', type: 'Offer', subject: 'Demo Rail Trips · Winter sale CPS 5%', reason: 'Landing page not on the allowed domain', age: '2d' },
  { id: 'rq-demo-7', type: 'Offer', subject: 'Demo Learn Plus · brief update', reason: 'New claims in the creator brief', age: '3d' },
  { id: 'rq-demo-8', type: 'Offer', subject: 'Demo Eats Gold · Snapchat added', reason: 'Platform added mid-campaign', age: '4d' },
  { id: 'rq-demo-9', type: 'Fraud', subject: demoLinkUrl('demo-payupi', undefined, 'demo-arjun'), reason: '41% of clicks from one ASN in 1h', age: '7h' },
  { id: 'rq-demo-10', type: 'Fraud', subject: demoLinkUrl('demo-ludo', undefined, 'demo-vikram'), reason: 'Installs at 14× the 7-day hourly baseline', age: '9h' },
];

function withDetails(item: DemoReviewItem): AdminReviewItem {
  const signal = SIGNAL_BY_ITEM[item.id];
  return { ...item, details: DETAILS[item.id] ?? [], ...(signal ? { signal } : {}) };
}

/** Every demo queue item (the 2e five first, as drawn). */
export const ADMIN_REVIEW_ITEMS: ReadonlyArray<AdminReviewItem> = [...DEMO_REVIEW_QUEUE, ...EXTRA_ITEMS].map(withDetails);

/** The five rows 2e draws on the queue's first page. */
export const ADMIN_QUEUE_PAGE: ReadonlyArray<AdminReviewItem> = ADMIN_REVIEW_ITEMS.filter((i) =>
  DEMO_REVIEW_QUEUE.some((d) => d.id === i.id),
);

/** Queue totals per type, as 2e prints them (All · 212 = Offers 14 + KYC 76 + Fraud 122). */
export const ADMIN_QUEUE_TOTALS: Readonly<Record<'all' | ReviewType, number>> = {
  all: DEMO_REVIEW_COUNTS.all,
  Offer: DEMO_REVIEW_COUNTS.offers,
  KYC: DEMO_REVIEW_COUNTS.kyc,
  Fraud: DEMO_REVIEW_COUNTS.fraud,
};

export function adminReviewItem(id: string): AdminReviewItem | undefined {
  return ADMIN_REVIEW_ITEMS.find((i) => i.id === id);
}

/* ---------- /admin/brands ---------- */

export type BrandPlan = 'Starter' | 'Network';
export type BrandStatus = 'Active' | 'In review' | 'Paused';

export interface AdminBrand {
  id: string;
  name: string;
  category: string;
  plan: BrandPlan;
  walletMinor: number;
  spendMinor: number;
  liveOffers: number;
  status: BrandStatus;
  /** A brand whose status waits on a queue decision (the new brand's first offer). */
  reviewItemId?: string;
}

export const DEMO_ADMIN_BRAND_COUNTS = { all: 46, Active: 41, 'In review': 3, Paused: 2, network: 12 } as const;

/** Wallet balances held for all 46 brands. */
export const DEMO_ADMIN_WALLETS_MINOR = 1_900_000_000; // ₹1.9Cr

/** Sample rows. Demo PayUPI's wallet and plan are the 2b shell's; the three agency clients' spend is 3e's. */
export const DEMO_ADMIN_BRANDS: ReadonlyArray<AdminBrand> = [
  { id: 'demo-payupi', name: 'Demo PayUPI', category: 'Fintech', plan: 'Network', walletMinor: 62_000_000, spendMinor: 184_000_000, liveOffers: 3, status: 'Active' },
  { id: 'demo-style', name: 'Demo Style Festive', category: 'D2C fashion', plan: 'Network', walletMinor: 38_000_000, spendMinor: 92_000_000, liveOffers: 2, status: 'Active' },
  { id: 'demo-eats', name: 'Demo Eats Gold', category: 'Food delivery', plan: 'Network', walletMinor: 44_000_000, spendMinor: 69_000_000, liveOffers: 2, status: 'Active' },
  { id: 'demo-ludo', name: 'Demo Ludo Arena', category: 'Gaming', plan: 'Starter', walletMinor: 12_000_000, spendMinor: 41_000_000, liveOffers: 1, status: 'Active' },
  { id: 'demo-learn', name: 'Demo Learn Plus', category: 'Edtech', plan: 'Starter', walletMinor: 8_540_000, spendMinor: 26_000_000, liveOffers: 1, status: 'Active' },
  { id: 'demo-rail', name: 'Demo Rail Trips', category: 'Travel', plan: 'Starter', walletMinor: 1_230_000, spendMinor: 11_000_000, liveOffers: 0, status: 'Paused' },
  { id: 'demo-cardmint', name: 'Demo CardMint', category: 'Fintech', plan: 'Starter', walletMinor: 0, spendMinor: 0, liveOffers: 0, status: 'In review', reviewItemId: 'rq-demo-2' },
];

/* ---------- /admin/creators ---------- */

export type KycStatus = 'Verified' | 'In review' | 'Not started';

export interface AdminCreator {
  name: string;
  platforms: ReadonlyArray<Platform>;
  reach: number;
  liveOffers: number;
  kyc: KycStatus;
  /** Shown under the KYC tag ("PAN name mismatch"). */
  kycNote?: string;
  reviewItemId?: string;
}

/** 18,406 creators (2e) = 16,812 verified + 76 in review (the KYC queue) + 1,518 not verified (not started or refused). */
export const DEMO_ADMIN_CREATOR_COUNTS = { all: 18_406, Verified: 16_812, 'In review': 76, 'Not verified': 1_518 } as const;

/** Creators with a live offer this month. */
export const DEMO_ADMIN_ACTIVE_CREATORS = 6_904;

/** Sample rows; reach and platforms agree with 2b / 3e (the roster, the creator requests). */
export const DEMO_ADMIN_CREATORS: ReadonlyArray<AdminCreator> = [
  { name: 'Demo Priya Nair', platforms: ['instagram', 'youtube'], reach: 1_500_000, liveOffers: 6, kyc: 'Verified' },
  { name: 'Demo Rahul Finance', platforms: ['youtube'], reach: 980_000, liveOffers: 5, kyc: 'Verified' },
  { name: 'Demo Kanika Daily', platforms: ['snapchat'], reach: 880_000, liveOffers: 4, kyc: 'Verified' },
  { name: 'Demo Arjun Reels', platforms: ['instagram'], reach: 640_000, liveOffers: 5, kyc: 'Verified' },
  { name: 'Demo PaisaWise', platforms: ['youtube'], reach: 540_000, liveOffers: 3, kyc: 'Verified' },
  { name: 'Demo Meera Tech', platforms: ['youtube'], reach: 420_000, liveOffers: 2, kyc: 'In review', kycNote: 'PAN name mismatch', reviewItemId: 'rq-demo-3' },
  { name: 'Demo Deals Channel', platforms: ['telegram'], reach: 1_100_000, liveOffers: 0, kyc: 'Not started' },
  { name: 'Demo Vikram Vlogs', platforms: ['instagram'], reach: 260_000, liveOffers: 0, kyc: 'Not started' },
];

/* ---------- /admin/offers ---------- */

/** Offers paused by their brand or by ops this month; rejected this month. */
export const DEMO_ADMIN_OFFER_COUNTS = { live: 128, inReview: DEMO_REVIEW_COUNTS.offers, paused: 9, rejected: 4 } as const;

/* ---------- /admin/fraud ---------- */

export interface FraudSignal {
  id: FraudSignalId;
  name: string;
  /** What trips it (the design's example signal, with a demo threshold). */
  rule: string;
  flaggedConversions: number;
  openCases: number;
}

/** The design's four signals. 512 + 366 + 248 + 158 = 1,284 flagged; 44 + 38 + 25 + 15 = 122 cases. */
export const DEMO_FRAUD_SIGNALS: ReadonlyArray<FraudSignal> = [
  {
    id: 'device-cluster',
    name: 'Device-ID clustering',
    rule: 'Many conversions from a handful of device IDs: 50 or more from 5 or fewer IDs within 2 hours.',
    flaggedConversions: 512,
    openCases: 44,
  },
  {
    id: 'fast-conversion',
    name: 'Click-to-conversion under 4s',
    rule: 'The conversion lands less than 4 seconds after the click — faster than a person can sign up or pay.',
    flaggedConversions: 366,
    openCases: 38,
  },
  {
    id: 'asn-concentration',
    name: 'IP / ASN concentration',
    rule: 'More than 30% of a link’s clicks in an hour come from one network (ASN) or IP range.',
    flaggedConversions: 248,
    openCases: 25,
  },
  {
    id: 'install-velocity',
    name: 'Install velocity',
    rule: 'App installs on a link run at more than 10× its 7-day hourly baseline.',
    flaggedConversions: 158,
    openCases: 15,
  },
];

/** Payout held on flagged conversions. */
export const DEMO_FRAUD_HELD_MINOR = 39_218_000; // ₹3.9L

/* ---------- /admin/settlements ---------- */

export type SettlementStatus = 'Paid' | 'Awaiting approval' | 'Open';

export interface SettlementBatch {
  id: string;
  /** First and last day, YYYY-MM-DD. */
  from: string;
  to: string;
  conversions: number;
  /** Brand payouts approved in the period. */
  grossMinor: number;
  /** Afflino's network fee. */
  feeMinor: number;
  /** gross − fee, owed to creators before TDS. */
  netMinor: number;
  status: SettlementStatus;
  /** Paid date, or when the open batch closes. */
  date: string;
}

/** Weekly batches, newest first. September's four closed weeks' fees add up to the ₹52.6L network fee. */
export const DEMO_SETTLEMENT_BATCHES: ReadonlyArray<SettlementBatch> = [
  { id: 'ST-DEMO-2609-5', from: '2026-09-29', to: '2026-10-05', conversions: 8_940, grossMinor: 341_000_000, feeMinor: 37_510_000, netMinor: 303_490_000, status: 'Open', date: '2026-10-05' },
  { id: 'ST-DEMO-2609-4', from: '2026-09-22', to: '2026-09-28', conversions: 31_240, grossMinor: 1_216_400_000, feeMinor: 134_600_000, netMinor: 1_081_800_000, status: 'Awaiting approval', date: '2026-09-29' },
  { id: 'ST-DEMO-2609-3', from: '2026-09-15', to: '2026-09-21', conversions: 29_870, grossMinor: 1_177_800_000, feeMinor: 129_550_000, netMinor: 1_048_250_000, status: 'Paid', date: '2026-09-26' },
  { id: 'ST-DEMO-2609-2', from: '2026-09-08', to: '2026-09-14', conversions: 32_410, grossMinor: 1_256_460_000, feeMinor: 138_210_000, netMinor: 1_118_250_000, status: 'Paid', date: '2026-09-19' },
  { id: 'ST-DEMO-2609-1', from: '2026-09-01', to: '2026-09-07', conversions: 28_050, grossMinor: 1_124_000_000, feeMinor: 123_640_000, netMinor: 1_000_360_000, status: 'Paid', date: '2026-09-12' },
];
