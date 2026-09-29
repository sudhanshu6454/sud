/**
 * TEST DEMO DATA — NOT REAL. Afflino screen data from the design handover
 * (renderVals() in Afflino.dc.html), typed, for the screens that have no API
 * endpoint yet. Every page that renders any of it must show <DemoBadge />.
 *
 * Platform invariant 11 (affiliate project notes): demo data is TEST-labelled and never
 * names a real merchant, creator or channel. The handover's mock names
 * (real companies and plausible real channels) are replaced one-for-one with
 * "Demo …" names; handles, UPI IDs, bank, PAN name, promo codes and landing
 * pages likewise (demo-priya, demo.priya@upi, Demo Bank, DEMO12,
 * shop.example.com). The numbers are exactly as designed.
 *
 * Money is integer minor units (paise), INR (DEMO_CURRENCY). Format with
 * lib/format.ts: formatINRFromMinor, formatINRCompactFromMinor, formatCount,
 * formatCountCompact, formatPct, formatPayout, formatDayMonth.
 *
 * Link URLs follow the design's readable format
 * (afflino.com/r/demo-<creator>/demo-<offer>?s=<sub-id>). That format is NOT
 * what the platform mints: the real redirect is /r/{32-hex token}, sets no
 * cookies and carries no readable handle (packages/redirect). Live minted
 * links always show the API's URL.
 */

import type { OfferPayout } from '../format';

export const DEMO_CURRENCY = 'INR' as const;

export type Platform = 'meta' | 'instagram' | 'youtube' | 'snapchat' | 'telegram' | 'web';
export type OfferModel = 'CPA' | 'CPS' | 'CPL' | 'CPI';
export type DemoTagVariant = 'accent' | 'neutral' | 'outline';
export type LinkStatus = 'Active' | 'Paused' | 'Review';
export type PayoutStatus = 'Paid' | 'Scheduled';
export type ReviewType = 'Fraud' | 'Offer' | 'KYC';

/** Short platform labels as the mocks print them ("Meta · YT · Snap", "420K · YT", "260K · IG"). */
export const PLATFORM_SHORT: Record<Platform, string> = {
  meta: 'Meta',
  instagram: 'IG',
  youtube: 'YT',
  snapchat: 'Snap',
  telegram: 'Telegram',
  web: 'Web',
};

/** Full platform names ("Instagram", "YouTube", "Snapchat"). */
export const PLATFORM_NAME: Record<Platform, string> = {
  meta: 'Meta',
  instagram: 'Instagram',
  youtube: 'YouTube',
  snapchat: 'Snapchat',
  telegram: 'Telegram',
  web: 'Website',
};

/** "Meta · YT · Snap" */
export function platformList(platforms: ReadonlyArray<Platform>): string {
  return platforms.map((p) => PLATFORM_SHORT[p]).join(' · ');
}

/* ---------- accounts shown in the shells and across screens ---------- */

export const DEMO_CREATOR = {
  name: 'Demo Priya Nair',
  /** Slug used in demo link URLs. */
  handle: 'demo-priya',
  instagramHandle: '@demo.priyanair',
  youtubeChannel: 'Demo Priya Nair Money',
  followersInstagram: 1_200_000,
  subscribersYoutube: 310_000,
  pctIndiaInstagram: 84,
  /**
   * The design draws "+91 98450 12345", a dialable number in a live mobile
   * series. This one is deliberately impossible (no Indian mobile starts with
   * 0), so it can never ring anyone; validateMobile() rejects it, so a screen
   * that shows it as a pre-filled value makes the user type a real number.
   */
  mobileDisplay: '+91 00000 00000',
  upiId: 'demo.priya@upi',
  bank: 'Demo Bank',
  panName: 'DEMO PRIYA NAIR',
  role: 'Creator',
  /** Sidebar footer line. */
  shellMeta: 'Creator · 1.2M followers',
  language: 'English, Hindi',
  niche: 'Personal finance, lifestyle',
} as const;

export const DEMO_BRAND = {
  name: 'Demo PayUPI',
  plan: 'Network',
  walletMinor: 62_000_000, // ₹6.2L
  shellMeta: 'Network plan · Wallet ₹6.2L',
  category: 'Fintech',
} as const;

export const DEMO_AGENCY = {
  name: 'Demo Loop Talent',
  creators: 42,
  brandClients: 6,
  shellMeta: 'Agency · 42 creators',
} as const;

/** Promo codes drawn in 3c (desktop) and 1e (mobile). */
export const DEMO_PROMO_CODES = { desktop: 'DEMO12', mobile: 'DEMO180' } as const;

/** Landing page drawn in 3c. */
export const DEMO_LANDING_PAGE = 'shop.example.com/diwali-sale';

/** Creator overview figures shared by 1c, 1e, 2c and 3f (last 30 days). */
export const DEMO_CREATOR_SUMMARY = {
  earnings30dMinor: 18_432_000, // ₹1,84,320
  earningsDeltaPct: 22,
  clicks30d: 312_880,
  clicksSplitPct: { meta: 61, youtube: 29, snapchat: 10 },
  conversions30d: 4_106,
  conversionRatePct: 1.31,
  nextPayoutMinor: 4_290_000, // ₹42,900
  /**
   * The design prints "Fri 3 Oct"; 3 Oct 2026 is a Saturday. The date here
   * matches the 2c payouts row ("03 Oct"); render the weekday from it.
   */
  nextPayoutDate: '2026-10-03',
  nextPayoutMethod: 'UPI',
  availableMinor: 4_290_000, // ₹42,900
  pendingMinor: 11_248_000, // ₹1,12,480
} as const;

/* ---------- renderVals() lists ---------- */

/** 1c daily earnings: bar heights as a percentage of the chart (30 days, 1–30 Sep); the last 3 are the current period. */
export const DEMO_DAILY_EARNINGS_PCT: ReadonlyArray<number> = [
  40, 52, 38, 61, 70, 66, 58, 80, 74, 62, 55, 90, 84, 78, 69, 72, 95, 88, 77, 64, 58, 82, 91, 86, 73, 68, 79, 97,
  89, 84,
];
export const DEMO_DAILY_EARNINGS_CURRENT = 3;
export const DEMO_DAILY_EARNINGS_AXIS = ['1 Sep', '15 Sep', '30 Sep'] as const;

/** 1c "By platform". */
export const DEMO_EARNINGS_BY_PLATFORM: ReadonlyArray<{
  platform: Platform;
  earnedMinor: number;
  sharePct: number;
  tone: 'accent' | 'ink' | 'muted';
}> = [
  { platform: 'meta', earnedMinor: 11_240_000, sharePct: 61, tone: 'accent' },
  { platform: 'youtube', earnedMinor: 5_350_000, sharePct: 29, tone: 'ink' },
  { platform: 'snapchat', earnedMinor: 1_842_000, sharePct: 10, tone: 'muted' },
];

export interface DemoOffer {
  /** Stable id and link slug: /app/offers/[id], afflino.com/r/demo-priya/<id>. */
  id: string;
  /** Brand / offer title (the design's "brand" field). */
  name: string;
  category: string;
  model: OfferModel;
  /** Tag variant for the model tag, as drawn in 1d. */
  modelTag: DemoTagVariant;
  description: string;
  payout: OfferPayout;
  platforms: ReadonlyArray<Platform>;
  /** Offers that need brand approval show "Apply" instead of "Get link" (1d). None of the drawn ones do. */
  requiresApproval: boolean;
}

/** 1d offer browser, 3f mobile offers (payout per the design's copy). */
export const DEMO_OFFERS: ReadonlyArray<DemoOffer> = [
  {
    id: 'demo-payupi',
    name: 'Demo PayUPI',
    category: 'Fintech',
    model: 'CPA',
    modelTag: 'accent',
    description: 'Verified sign-up with first UPI transaction.',
    payout: { type: 'flat', amountMinor: 18_000, per: 'sign-up' },
    platforms: ['meta', 'youtube', 'snapchat'],
    requiresApproval: false,
  },
  {
    id: 'demo-style',
    name: 'Demo Style Festive',
    category: 'D2C fashion',
    model: 'CPS',
    modelTag: 'neutral',
    // The design adds "30-day cookie": dropped, the platform's redirect sets no
    // cookies and no attribution window is implemented (packages/redirect; ASSUMPTIONS.md 33).
    description: '12% of order value, promo code included.',
    payout: { type: 'percent', percent: 12, per: 'sale' },
    platforms: ['meta', 'youtube'],
    requiresApproval: false,
  },
  {
    id: 'demo-learn',
    name: 'Demo Learn Plus',
    category: 'Edtech',
    model: 'CPL',
    modelTag: 'outline',
    description: 'Qualified lead: phone verified, course selected.',
    payout: { type: 'flat', amountMinor: 15_000, per: 'lead' },
    platforms: ['youtube'],
    requiresApproval: false,
  },
  {
    id: 'demo-eats',
    name: 'Demo Eats Gold',
    category: 'Food delivery',
    model: 'CPA',
    modelTag: 'accent',
    description: 'Gold membership purchase, new users only.',
    payout: { type: 'flat', amountMinor: 4_000, per: 'purchase' },
    platforms: ['meta', 'snapchat'],
    requiresApproval: false,
  },
  {
    id: 'demo-ludo',
    name: 'Demo Ludo Arena',
    category: 'Gaming',
    model: 'CPI',
    modelTag: 'neutral',
    description: 'Install + first match played within 24h.',
    payout: { type: 'flat', amountMinor: 2_200, per: 'install' },
    platforms: ['meta', 'youtube', 'snapchat'],
    requiresApproval: false,
  },
  {
    id: 'demo-rail',
    name: 'Demo Rail Trips',
    category: 'Travel',
    model: 'CPS',
    modelTag: 'outline',
    // The design adds "7-day cookie": dropped, as above.
    description: '4% of booking value.',
    payout: { type: 'percent', percent: 4, per: 'booking' },
    platforms: ['youtube', 'snapchat'],
    requiresApproval: false,
  },
];

/** Offer categories for the 1d filter row, in the drawn order. */
export const DEMO_OFFER_CATEGORIES = ['Fintech', 'D2C fashion', 'Edtech', 'Food delivery', 'Gaming', 'Travel'] as const;

/** Total live offers in the 1d header ("128 live offers"). */
export const DEMO_LIVE_OFFER_COUNT = 128;

export function demoOfferById(id: string): DemoOffer | undefined {
  return DEMO_OFFERS.find((o) => o.id === id);
}

/** Demo link URL in the design's readable format (not a platform link — see the module header). */
export function demoLinkUrl(offerId: string, subId?: string, creatorHandle: string = DEMO_CREATOR.handle): string {
  return `afflino.com/r/${creatorHandle}/${offerId}${subId ? `?s=${subId}` : ''}`;
}

export interface DemoTopLink {
  offerId: string;
  offer: string;
  url: string;
  clicks: number;
  conversions: number;
  earnedMinor: number;
  status: LinkStatus;
}

/** 1c "Top links" (and 1e mobile). */
export const DEMO_TOP_LINKS: ReadonlyArray<DemoTopLink> = [
  { offerId: 'demo-payupi', offer: 'Demo PayUPI', url: demoLinkUrl('demo-payupi'), clicks: 84_210, conversions: 1_402, earnedMinor: 25_236_000, status: 'Active' },
  { offerId: 'demo-style', offer: 'Demo Style Festive', url: demoLinkUrl('demo-style'), clicks: 61_004, conversions: 980, earnedMinor: 5_880_000, status: 'Active' },
  { offerId: 'demo-learn', offer: 'Demo Learn Plus', url: demoLinkUrl('demo-learn'), clicks: 22_930, conversions: 311, earnedMinor: 4_665_000, status: 'Paused' },
  { offerId: 'demo-eats', offer: 'Demo Eats Gold', url: demoLinkUrl('demo-eats'), clicks: 19_400, conversions: 702, earnedMinor: 2_808_000, status: 'Review' },
];

export interface DemoMyLink {
  offerId: string;
  offer: string;
  subId: string;
  url: string;
  platform: Platform;
  clicks: number;
  /** Earnings per click, minor units (₹6.10 → 610). */
  epcMinor: number;
  status: LinkStatus;
}

/** 3c "My links · 46". */
export const DEMO_MY_LINKS: ReadonlyArray<DemoMyLink> = [
  { offerId: 'demo-style', offer: 'Demo Style Festive', subId: 'short-diwali-02', url: demoLinkUrl('demo-style', 'short-diwali-02'), platform: 'youtube', clicks: 12_400, epcMinor: 610, status: 'Active' },
  { offerId: 'demo-payupi', offer: 'Demo PayUPI', subId: 'reel-oct-01', url: demoLinkUrl('demo-payupi', 'reel-oct-01'), platform: 'meta', clicks: 84_210, epcMinor: 300, status: 'Active' },
  { offerId: 'demo-eats', offer: 'Demo Eats Gold', subId: 'snap-01', url: demoLinkUrl('demo-eats', 'snap-01'), platform: 'snapchat', clicks: 19_400, epcMinor: 145, status: 'Review' },
  { offerId: 'demo-learn', offer: 'Demo Learn Plus', subId: 'yt-long', url: demoLinkUrl('demo-learn', 'yt-long'), platform: 'youtube', clicks: 22_930, epcMinor: 203, status: 'Paused' },
  { offerId: 'demo-rail', offer: 'Demo Rail Trips', subId: 'story-12', url: demoLinkUrl('demo-rail', 'story-12'), platform: 'meta', clicks: 8_120, epcMinor: 190, status: 'Active' },
];

/** Total in the 3c header ("My links · 46"). */
export const DEMO_MY_LINKS_TOTAL = 46;

export interface DemoCreatorRow {
  name: string;
  platform: Platform;
  clicks: number;
  signUps: number;
  payoutMinor: number;
}

/** 2b "Top creators". */
export const DEMO_TOP_CREATORS: ReadonlyArray<DemoCreatorRow> = [
  { name: 'Demo Priya Nair', platform: 'instagram', clicks: 84_210, signUps: 1_402, payoutMinor: 25_236_000 },
  { name: 'Demo Rahul Finance', platform: 'youtube', clicks: 71_880, signUps: 1_190, payoutMinor: 21_420_000 },
  { name: 'Demo Kanika Daily', platform: 'snapchat', clicks: 48_020, signUps: 744, payoutMinor: 13_392_000 },
  { name: 'Demo PaisaWise', platform: 'youtube', clicks: 39_540, signUps: 702, payoutMinor: 12_636_000 },
  { name: 'Demo Arjun Reels', platform: 'instagram', clicks: 33_100, signUps: 515, payoutMinor: 9_270_000 },
];

export interface DemoCreatorRequest {
  name: string;
  reach: number;
  platform: Platform;
}

/** 2b / 3f "Creator requests" ("420K · YT"). */
export const DEMO_CREATOR_REQUESTS: ReadonlyArray<DemoCreatorRequest> = [
  { name: 'Demo Meera Tech', reach: 420_000, platform: 'youtube' },
  { name: 'Demo Deals Channel', reach: 1_100_000, platform: 'telegram' },
  { name: 'Demo Vikram Vlogs', reach: 260_000, platform: 'instagram' },
];

export interface DemoPayout {
  /** Calendar date, YYYY-MM-DD. Printed "26 Sep" (formatDayMonth(date, { pad: true })). */
  date: string;
  /** "PO-20926-118", or "Scheduled" for the upcoming run. */
  reference: string;
  method: string;
  grossMinor: number;
  tdsMinor: number;
  netMinor: number;
  status: PayoutStatus;
}

/** 2c payouts table and 3f mobile history. TDS is the design's 1% (lib/site-copy.ts, placeholder). */
export const DEMO_PAYOUTS: ReadonlyArray<DemoPayout> = [
  { date: '2026-09-26', reference: 'PO-20926-118', method: 'UPI', grossMinor: 3_840_000, tdsMinor: 38_400, netMinor: 3_801_600, status: 'Paid' },
  { date: '2026-09-19', reference: 'PO-20919-094', method: 'UPI', grossMinor: 5_125_000, tdsMinor: 51_300, netMinor: 5_073_700, status: 'Paid' },
  { date: '2026-09-12', reference: 'PO-20912-071', method: 'UPI', grossMinor: 2_980_000, tdsMinor: 29_800, netMinor: 2_950_200, status: 'Paid' },
  { date: '2026-09-05', reference: 'PO-20905-042', method: 'Bank · Demo Bank', grossMinor: 4_410_000, tdsMinor: 44_100, netMinor: 4_365_900, status: 'Paid' },
  { date: '2026-10-03', reference: 'Scheduled', method: 'UPI', grossMinor: 4_290_000, tdsMinor: 42_900, netMinor: 4_247_100, status: 'Scheduled' },
];

export interface DemoPlatformConnection {
  platform: Platform;
  name: string;
  detail: string;
  connected: boolean;
}

/** 2d "Connected platforms" (3a shows the same accounts with "% India"). */
export const DEMO_PLATFORM_CONNECTIONS: ReadonlyArray<DemoPlatformConnection> = [
  { platform: 'instagram', name: 'Instagram', detail: '@demo.priyanair · 1.2M followers · connected', connected: true },
  { platform: 'youtube', name: 'YouTube', detail: 'Demo Priya Nair Money · 310K subscribers · connected', connected: true },
  { platform: 'snapchat', name: 'Snapchat', detail: 'Not connected', connected: false },
];

export interface DemoReviewItem {
  id: string;
  type: ReviewType;
  subject: string;
  reason: string;
  /** Age as drawn ("12m", "1h", "1d"). */
  age: string;
}

/** 2e review queue. Fraud reasons are the design's signal examples. */
export const DEMO_REVIEW_QUEUE: ReadonlyArray<DemoReviewItem> = [
  { id: 'rq-demo-1', type: 'Fraud', subject: demoLinkUrl('demo-ludo', undefined, 'demo-deals'), reason: '2,140 installs from 3 device IDs in 2h', age: '12m' },
  { id: 'rq-demo-2', type: 'Offer', subject: 'Demo CardMint · Credit card CPA ₹900', reason: 'New brand, compliance check', age: '1h' },
  { id: 'rq-demo-3', type: 'KYC', subject: 'Demo Meera Tech', reason: 'PAN name mismatch', age: '3h' },
  { id: 'rq-demo-4', type: 'Fraud', subject: demoLinkUrl('demo-eats', undefined, 'demo-kanika'), reason: 'Click-to-conversion under 4s', age: '5h' },
  { id: 'rq-demo-5', type: 'Offer', subject: 'Demo Style Festive · payout change', reason: '12% → 10% mid-campaign', age: '1d' },
];

/** 2e queue filter counts ("All · 212", "Offers · 14", "KYC · 76", "Fraud · 122"). */
export const DEMO_REVIEW_COUNTS = { all: 212, offers: 14, kyc: 76, fraud: 122 } as const;

export interface DemoFunnelStep {
  label: string;
  value: number;
  /** Bar width relative to impressions, as drawn. */
  widthPct: number;
}

/** 3d funnel strip. Impressions print compact ("9.8M"), the rest in full. */
export const DEMO_FUNNEL: ReadonlyArray<DemoFunnelStep> = [
  { label: 'Impressions', value: 9_800_000, widthPct: 100 },
  { label: 'Clicks', value: 312_880, widthPct: 64 },
  { label: 'Landed', value: 271_040, widthPct: 52 },
  { label: 'Conversions', value: 4_106, widthPct: 18 },
  { label: 'Approved', value: 3_812, widthPct: 16 },
];

/** 3d "Conversions by city". */
export const DEMO_CITIES: ReadonlyArray<{ name: string; conversions: number; widthPct: number }> = [
  { name: 'Mumbai', conversions: 812, widthPct: 100 },
  { name: 'Delhi NCR', conversions: 744, widthPct: 92 },
  { name: 'Bengaluru', conversions: 630, widthPct: 78 },
  { name: 'Hyderabad', conversions: 402, widthPct: 50 },
  { name: 'Pune', conversions: 318, widthPct: 39 },
  { name: 'Jaipur', conversions: 204, widthPct: 25 },
];

/** 3d "By sub-ID". */
export const DEMO_SUB_IDS: ReadonlyArray<{ subId: string; clicks: number; crPct: number; earnedMinor: number }> = [
  { subId: 'reel-oct-01', clicks: 41_200, crPct: 1.9, earnedMinor: 14_094_000 },
  { subId: 'short-diwali-02', clicks: 12_400, crPct: 1.4, earnedMinor: 7_564_000 },
  { subId: 'story-12', clicks: 8_120, crPct: 0.9, earnedMinor: 1_543_000 },
  { subId: 'yt-long', clicks: 22_930, crPct: 1.4, earnedMinor: 4_665_000 },
  { subId: 'snap-01', clicks: 19_400, crPct: 3.6, earnedMinor: 2_808_000 },
];

/** 3e brand clients (3 of the 6 drawn). */
export const DEMO_AGENCY_CLIENTS: ReadonlyArray<{ id: string; category: string; name: string; spendMinor: number; creators: number }> = [
  { id: 'demo-payupi', category: 'Fintech', name: 'Demo PayUPI', spendMinor: 184_000_000, creators: 21 },
  { id: 'demo-style', category: 'D2C fashion', name: 'Demo Style Festive', spendMinor: 92_000_000, creators: 14 },
  { id: 'demo-ludo', category: 'Gaming', name: 'Demo Ludo Arena', spendMinor: 41_000_000, creators: 9 },
];

/** 3e roster. */
export const DEMO_AGENCY_ROSTER: ReadonlyArray<{
  name: string;
  reach: number;
  liveOffers: number;
  earnedMinor: number;
  agencyShareMinor: number;
  agencySharePct: number;
}> = [
  { name: 'Demo Priya Nair', reach: 1_500_000, liveOffers: 6, earnedMinor: 18_432_000, agencyShareMinor: 2_764_800, agencySharePct: 15 },
  { name: 'Demo Kanika Daily', reach: 880_000, liveOffers: 4, earnedMinor: 13_392_000, agencyShareMinor: 2_008_800, agencySharePct: 15 },
  { name: 'Demo Arjun Reels', reach: 640_000, liveOffers: 5, earnedMinor: 9_270_000, agencyShareMinor: 1_390_500, agencySharePct: 15 },
  { name: 'Demo Meera Tech', reach: 420_000, liveOffers: 2, earnedMinor: 3_820_000, agencyShareMinor: 573_000, agencySharePct: 15 },
];
