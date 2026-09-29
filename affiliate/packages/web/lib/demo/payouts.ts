/**
 * TEST DEMO DATA — NOT REAL. Extra rows for the creator Payouts screen (2c)
 * and the Settings screen (2d) that the handover does not draw: the
 * Conversions and Clicks tables behind 2c's segmented control, the payout
 * method and the settings defaults. Every page that renders any of it shows
 * <DemoBadge />.
 *
 * Same rules as lib/demo/afflino.ts (platform invariant 11): every proper
 * noun is "Demo …", identifiers are demo-marked, money is integer minor
 * units (paise, INR). Offers and sub-IDs are the ones already in
 * lib/demo/afflino.ts (DEMO_OFFERS, DEMO_MY_LINKS), so the tables agree with
 * the links and reports screens.
 */

import { DEMO_CREATOR, DEMO_PLATFORM_CONNECTIONS, type Platform } from './afflino';

/** The period the 2c toolbar tag names ("Sep 2026"). */
export const DEMO_PAYOUT_PERIOD = { key: '2026-09', label: 'Sep 2026' } as const;

/** "Today" for the demo screens: a demo withdrawal is dated this day. */
export const DEMO_TODAY = '2026-09-29';

export type ConversionStatus = 'Approved' | 'Pending' | 'Rejected';

export interface DemoConversionRow {
  id: string;
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  offerId: string;
  offer: string;
  subId: string;
  platform: Platform;
  /** What converted, as the brand reported it: "Sign-up", "Sale ₹2,450". */
  event: string;
  commissionMinor: number;
  status: ConversionStatus;
}

/**
 * 2c "Conversions" (latest first). Commissions follow each offer's payout in
 * DEMO_OFFERS: ₹180 / sign-up, 12% / sale, ₹150 / lead, ₹40 / purchase,
 * 4% / booking.
 */
export const DEMO_CONVERSION_ROWS: ReadonlyArray<DemoConversionRow> = [
  { id: 'cv-demo-0929-1', date: '2026-09-29', offerId: 'demo-payupi', offer: 'Demo PayUPI', subId: 'reel-oct-01', platform: 'meta', event: 'Sign-up', commissionMinor: 18_000, status: 'Pending' },
  { id: 'cv-demo-0929-2', date: '2026-09-29', offerId: 'demo-style', offer: 'Demo Style Festive', subId: 'short-diwali-02', platform: 'youtube', event: 'Sale ₹2,450', commissionMinor: 29_400, status: 'Pending' },
  { id: 'cv-demo-0928-1', date: '2026-09-28', offerId: 'demo-eats', offer: 'Demo Eats Gold', subId: 'snap-01', platform: 'snapchat', event: 'Purchase', commissionMinor: 4_000, status: 'Pending' },
  { id: 'cv-demo-0927-1', date: '2026-09-27', offerId: 'demo-learn', offer: 'Demo Learn Plus', subId: 'yt-long', platform: 'youtube', event: 'Lead', commissionMinor: 15_000, status: 'Approved' },
  { id: 'cv-demo-0926-1', date: '2026-09-26', offerId: 'demo-payupi', offer: 'Demo PayUPI', subId: 'reel-oct-01', platform: 'meta', event: 'Sign-up', commissionMinor: 18_000, status: 'Approved' },
  { id: 'cv-demo-0925-1', date: '2026-09-25', offerId: 'demo-rail', offer: 'Demo Rail Trips', subId: 'story-12', platform: 'meta', event: 'Booking ₹3,800', commissionMinor: 15_200, status: 'Approved' },
  { id: 'cv-demo-0924-1', date: '2026-09-24', offerId: 'demo-style', offer: 'Demo Style Festive', subId: 'short-diwali-02', platform: 'youtube', event: 'Sale ₹2,000', commissionMinor: 24_000, status: 'Rejected' },
  { id: 'cv-demo-0924-2', date: '2026-09-24', offerId: 'demo-payupi', offer: 'Demo PayUPI', subId: 'reel-oct-01', platform: 'meta', event: 'Sign-up', commissionMinor: 18_000, status: 'Approved' },
];

export interface DemoClickRow {
  id: string;
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  offerId: string;
  offer: string;
  subId: string;
  platform: Platform;
  clicks: number;
  conversions: number;
}

/** 2c "Clicks": clicks per link per day (latest first). */
export const DEMO_CLICK_ROWS: ReadonlyArray<DemoClickRow> = [
  { id: 'ck-demo-0929-1', date: '2026-09-29', offerId: 'demo-payupi', offer: 'Demo PayUPI', subId: 'reel-oct-01', platform: 'meta', clicks: 2_914, conversions: 48 },
  { id: 'ck-demo-0929-2', date: '2026-09-29', offerId: 'demo-style', offer: 'Demo Style Festive', subId: 'short-diwali-02', platform: 'youtube', clicks: 1_206, conversions: 17 },
  { id: 'ck-demo-0928-1', date: '2026-09-28', offerId: 'demo-payupi', offer: 'Demo PayUPI', subId: 'reel-oct-01', platform: 'meta', clicks: 3_102, conversions: 51 },
  { id: 'ck-demo-0928-2', date: '2026-09-28', offerId: 'demo-eats', offer: 'Demo Eats Gold', subId: 'snap-01', platform: 'snapchat', clicks: 688, conversions: 24 },
  { id: 'ck-demo-0927-1', date: '2026-09-27', offerId: 'demo-learn', offer: 'Demo Learn Plus', subId: 'yt-long', platform: 'youtube', clicks: 804, conversions: 11 },
  { id: 'ck-demo-0927-2', date: '2026-09-27', offerId: 'demo-rail', offer: 'Demo Rail Trips', subId: 'story-12', platform: 'meta', clicks: 290, conversions: 3 },
];

/* ---------- settings (2d) ---------- */

/**
 * A PAN that cannot belong to anyone: the fourth character (the holder
 * type) is never "O" and the serial is never 0000. It passes the shape
 * check (validatePan); nothing verifies it.
 */
export const DEMO_PAN = 'DEMOX0000Z';

/** Bank details for the "Bank transfer" method; account number and IFSC start blank (the demo creator is paid by UPI). */
export const DEMO_BANK_ACCOUNT = {
  holder: DEMO_CREATOR.panName,
  bank: DEMO_CREATOR.bank,
  accountNumber: '',
  ifsc: '',
} as const;

export interface DemoNotificationPref {
  id: 'payout_sent' | 'conversion_approved' | 'offer_invites' | 'weekly_report' | 'product_news';
  label: string;
  detail: string;
  defaultOn: boolean;
}

/** Notification toggles (not drawn; same row style as "Connected platforms"). */
export const DEMO_NOTIFICATION_PREFS: ReadonlyArray<DemoNotificationPref> = [
  { id: 'payout_sent', label: 'Payout sent', detail: 'When a payout leaves Afflino for your UPI ID or bank account.', defaultOn: true },
  { id: 'conversion_approved', label: 'Conversions approved', detail: 'A daily summary of the conversions brands approved.', defaultOn: true },
  { id: 'offer_invites', label: 'Offer invitations', detail: 'When a brand invites you or approves your application.', defaultOn: true },
  { id: 'weekly_report', label: 'Weekly report', detail: 'Clicks, conversions and earnings, every Monday.', defaultOn: false },
  { id: 'product_news', label: 'Product news', detail: 'New features and network updates.', defaultOn: false },
];

/** Connected platforms as 2d draws them (from lib/demo/afflino.ts). */
export const DEMO_SETTINGS_PLATFORMS = DEMO_PLATFORM_CONNECTIONS;

/** Detail line of a platform the demo "connects": nothing is linked. */
export const DEMO_CONNECTED_DETAIL = 'Demo connection · no account linked';
