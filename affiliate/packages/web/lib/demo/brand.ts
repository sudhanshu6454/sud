/**
 * TEST DEMO DATA — NOT REAL. Brand / advertiser workspace data (2b, 3b, 3f and
 * the undrawn brand screens: offers, creators, conversions, billing,
 * settings). No v1 endpoint serves any of it, so every page that renders it
 * shows <DemoBadge variant="mock" />.
 *
 * Platform invariant 11: demo data is TEST-labelled and never names a real
 * merchant, creator or channel. Brand, creator and channel names come from
 * lib/demo/afflino.ts ("Demo …"); references are DEMO-/txn-demo-* and the
 * landing domain is shop.example.com. Numbers drawn in the handover are kept
 * exactly (₹18.4L of ₹25L, 10,212 sign-ups, +31% vs Aug, 642 active
 * creators, 38 pending, 412 sign-ups / ₹74,160 today, 38–52M reach). The
 * rows for the undrawn screens are invented for the demo and consistent with
 * those figures (the conversion status split sums to 10,212).
 *
 * Money is integer minor units (paise), INR. Plan price and fee come from
 * lib/site-copy.ts (placeholders pending business confirmation).
 */

import { PRICING } from '../site-copy';
import type { OfferModel, Platform } from './afflino';

/** Reporting period of the drawn dashboard ("Demo PayUPI · September", "+31% vs Aug"). */
export const DEMO_BRAND_PERIOD = { month: 'September', previousMonthShort: 'Aug' } as const;

/** 2b KPI strip and 3f "Today". */
export const DEMO_BRAND_SUMMARY = {
  spendMinor: 184_000_000, // ₹18.4L
  budgetMinor: 250_000_000, // ₹25L
  signUps: 10_212,
  signUpsDeltaPct: 31,
  /** Meta line under "Cost / sign-up". */
  pricingNote: 'Fixed CPA',
  activeCreators: 642,
  pendingRequests: 38,
  today: { signUps: 412, spendMinor: 7_416_000 }, // 412 × ₹180 = ₹74,160
} as const;

/** The 3b artboard's filled form (the builder's demo starting point). */
export const DEMO_OFFER_DRAFT = {
  name: 'Diwali UPI cashback',
  model: 'CPA' as OfferModel,
  payout: '₹180',
  unit: 'sign-up',
  event: 'Sign-up + first UPI transaction ≥ ₹100',
  budget: '₹25,00,000',
  platforms: ['meta', 'youtube', 'snapchat'] as Platform[],
  validationDays: 7,
  brief: 'Show the ₹50 cashback on first UPI payment. Mention "new users only". No comparison with other UPI apps.',
  landingPage: 'https://shop.example.com/diwali-sale',
} as const;

/**
 * Demo reach model for the builder's "Estimated reach" line: matched-creator
 * audience per allowed platform, in millions [low, high]. Meta + YouTube +
 * Snapchat gives the drawn 38–52M. Invented for the demo; not a forecast.
 */
export const DEMO_REACH_MILLIONS: Readonly<Partial<Record<Platform, readonly [number, number]>>> = {
  meta: [22, 30],
  youtube: [10, 14],
  snapchat: [6, 8],
  telegram: [2, 3],
};

/** Allowed landing domain when the brand has not saved a website in Settings. */
export const DEMO_BRAND_DOMAIN = 'shop.example.com';

/** Settings starting values (2d pattern). GSTIN is left empty: no demo GSTIN is printed. */
export const DEMO_BRAND_PROFILE = {
  legalName: 'Demo PayUPI Private Limited',
  displayName: 'Demo PayUPI',
  gstin: '',
  website: 'https://shop.example.com',
  category: 'Fintech',
  billingEmail: 'billing@example.com',
} as const;

export type BrandOfferStatus = 'Draft' | 'In review' | 'Live' | 'Paused' | 'Ended' | 'Rejected';

/** A brand offer as the offers list shows it. Payout: flat minor units, or basis points for CPS. */
export interface DemoBrandOffer {
  id: string;
  name: string;
  model: OfferModel;
  payoutType: 'flat' | 'percent';
  /** Flat payout in paise, or the CPS rate in basis points (12% → 1200). */
  payoutValue: number;
  unit: string;
  event: string;
  budgetMinor: number;
  platforms: Platform[];
  validationDays: number;
  status: BrandOfferStatus;
  /** Calendar date, YYYY-MM-DD. */
  updated: string;
  rejectionReason?: string;
}

/** Seed rows for /brand/offers (the builder's local drafts and submissions are listed with them). */
export const DEMO_BRAND_OFFERS: ReadonlyArray<DemoBrandOffer> = [
  {
    id: 'demo-offer-upi-signup',
    name: 'UPI sign-up',
    model: 'CPA',
    payoutType: 'flat',
    payoutValue: 18_000,
    unit: 'sign-up',
    event: 'Verified sign-up with first UPI transaction',
    budgetMinor: 250_000_000,
    platforms: ['meta', 'youtube', 'snapchat'],
    validationDays: 7,
    status: 'Live',
    updated: '2026-09-01',
  },
  {
    id: 'demo-offer-referral',
    name: 'Refer a friend',
    model: 'CPA',
    payoutType: 'flat',
    payoutValue: 12_000,
    unit: 'sign-up',
    event: "Referred friend signs up and makes a first UPI payment",
    budgetMinor: 50_000_000,
    platforms: ['meta', 'telegram'],
    validationDays: 14,
    status: 'Paused',
    updated: '2026-09-18',
  },
  {
    id: 'demo-offer-credit-line',
    name: 'Credit line waitlist',
    model: 'CPL',
    payoutType: 'flat',
    payoutValue: 9_000,
    unit: 'lead',
    event: 'Waitlist form with a verified mobile number',
    budgetMinor: 20_000_000,
    platforms: ['youtube'],
    validationDays: 7,
    status: 'Draft',
    updated: '2026-09-24',
  },
  {
    id: 'demo-offer-merchant-qr',
    name: 'Merchant QR onboarding',
    model: 'CPL',
    payoutType: 'flat',
    payoutValue: 25_000,
    unit: 'lead',
    event: 'Shop owner completes QR onboarding',
    budgetMinor: 30_000_000,
    platforms: ['youtube', 'meta'],
    validationDays: 14,
    status: 'Rejected',
    updated: '2026-09-12',
    rejectionReason: "The landing page is not on the brand's website domain.",
  },
  {
    id: 'demo-offer-bill-pay',
    name: 'First bill payment',
    model: 'CPA',
    payoutType: 'flat',
    payoutValue: 6_000,
    unit: 'payment',
    event: 'First electricity or mobile bill paid by UPI',
    budgetMinor: 15_000_000,
    platforms: ['meta', 'youtube'],
    validationDays: 3,
    status: 'Ended',
    updated: '2026-08-31',
  },
];

/** Roster status on /brand/creators. */
export type BrandCreatorStatus = 'Active' | 'Paused';

export type ConversionStatus = 'Pending' | 'Approved' | 'Rejected' | 'Flagged';

/** September conversions by status (sums to the 10,212 sign-ups drawn in 2b). */
export const DEMO_CONVERSION_COUNTS: Readonly<Record<ConversionStatus, number>> = {
  Approved: 8_934,
  Pending: 1_046,
  Rejected: 188,
  Flagged: 44,
};

export interface DemoConversion {
  id: string;
  /** ISO timestamp, India time. */
  at: string;
  creator: string;
  platform: Platform;
  offer: string;
  subId: string;
  payoutMinor: number;
  status: ConversionStatus;
  /** Rejected / flagged: why. */
  reason?: string;
}

/** Latest conversions (the table shows these; the counts above cover the month). */
export const DEMO_CONVERSIONS: ReadonlyArray<DemoConversion> = [
  { id: 'txn-demo-20929-0412', at: '2026-09-29T14:02:00+05:30', creator: 'Demo Priya Nair', platform: 'instagram', offer: 'UPI sign-up', subId: 'reel-oct-01', payoutMinor: 18_000, status: 'Pending' },
  { id: 'txn-demo-20929-0411', at: '2026-09-29T13:47:00+05:30', creator: 'Demo Rahul Finance', platform: 'youtube', offer: 'UPI sign-up', subId: 'yt-long', payoutMinor: 18_000, status: 'Pending' },
  { id: 'txn-demo-20929-0410', at: '2026-09-29T13:41:00+05:30', creator: 'Demo Kanika Daily', platform: 'snapchat', offer: 'UPI sign-up', subId: 'snap-01', payoutMinor: 18_000, status: 'Flagged', reason: 'Click-to-conversion under 4s' },
  { id: 'txn-demo-20929-0409', at: '2026-09-29T12:15:00+05:30', creator: 'Demo PaisaWise', platform: 'youtube', offer: 'UPI sign-up', subId: 'short-diwali-02', payoutMinor: 18_000, status: 'Pending' },
  { id: 'txn-demo-20928-0388', at: '2026-09-28T21:09:00+05:30', creator: 'Demo Arjun Reels', platform: 'instagram', offer: 'UPI sign-up', subId: 'story-12', payoutMinor: 18_000, status: 'Pending' },
  { id: 'txn-demo-20928-0371', at: '2026-09-28T18:30:00+05:30', creator: 'Demo Priya Nair', platform: 'instagram', offer: 'UPI sign-up', subId: 'reel-oct-01', payoutMinor: 18_000, status: 'Rejected', reason: 'Duplicate account' },
  { id: 'txn-demo-20927-0340', at: '2026-09-27T11:54:00+05:30', creator: 'Demo Rahul Finance', platform: 'youtube', offer: 'UPI sign-up', subId: 'yt-long', payoutMinor: 18_000, status: 'Pending' },
  { id: 'txn-demo-20921-0205', at: '2026-09-21T19:22:00+05:30', creator: 'Demo Kanika Daily', platform: 'snapchat', offer: 'UPI sign-up', subId: 'snap-01', payoutMinor: 18_000, status: 'Approved' },
  { id: 'txn-demo-20920-0187', at: '2026-09-20T10:05:00+05:30', creator: 'Demo PaisaWise', platform: 'youtube', offer: 'UPI sign-up', subId: 'short-diwali-02', payoutMinor: 18_000, status: 'Approved' },
  { id: 'txn-demo-20919-0166', at: '2026-09-19T16:40:00+05:30', creator: 'Demo Arjun Reels', platform: 'instagram', offer: 'UPI sign-up', subId: 'story-12', payoutMinor: 18_000, status: 'Flagged', reason: 'IP / ASN concentration' },
  { id: 'txn-demo-20918-0150', at: '2026-09-18T09:12:00+05:30', creator: 'Demo Priya Nair', platform: 'instagram', offer: 'UPI sign-up', subId: 'reel-oct-01', payoutMinor: 18_000, status: 'Approved' },
  { id: 'txn-demo-20917-0131', at: '2026-09-17T20:48:00+05:30', creator: 'Demo Rahul Finance', platform: 'youtube', offer: 'Refer a friend', subId: 'yt-long', payoutMinor: 12_000, status: 'Approved' },
];

export type BillingStatus = 'Paid' | 'Due';

export interface DemoBillingRow {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  reference: string;
  description: string;
  amountMinor: number;
  status: BillingStatus;
}

const PLAN_MINOR = PRICING.network.monthlyRupees * 100;

/**
 * Billing history. The September network fee (to date) is computed on the
 * page from the spend and the plan's fee; these are the settled rows.
 */
export const DEMO_BILLING_HISTORY: ReadonlyArray<DemoBillingRow> = [
  { date: '2026-09-11', reference: 'TOP-DEMO-0911', description: 'Wallet top-up · UPI', amountMinor: 100_000_000, status: 'Paid' },
  { date: '2026-09-01', reference: 'INV-DEMO-0901', description: 'Network plan · September', amountMinor: PLAN_MINOR, status: 'Paid' },
  { date: '2026-08-31', reference: 'INV-DEMO-0831', description: 'Network fee · August', amountMinor: 11_224_800, status: 'Paid' },
  { date: '2026-08-14', reference: 'TOP-DEMO-0814', description: 'Wallet top-up · Bank transfer', amountMinor: 150_000_000, status: 'Paid' },
  { date: '2026-08-01', reference: 'INV-DEMO-0801', description: 'Network plan · August', amountMinor: PLAN_MINOR, status: 'Paid' },
];

/** Quick amounts in the top-up dialog, in rupees. */
export const DEMO_TOP_UP_PRESETS_RUPEES = [100_000, 500_000, 1_000_000] as const;
