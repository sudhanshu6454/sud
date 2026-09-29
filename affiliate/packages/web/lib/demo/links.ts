/**
 * TEST DEMO DATA — NOT REAL. What the offer browser (1d), offer detail /
 * get link (1e) and link generator (3c) need on top of lib/demo/afflino.ts:
 * each demo offer's terms line, attribution window, allowed landing domain,
 * default landing page, promo code, whether it needs brand approval, and a
 * reference order value used only to rank percentage offers.
 *
 * Platform invariant 11: TEST-labelled, no real merchant. Landing domains
 * are RFC 2606 example.com hosts; promo codes follow the afflino.ts mapping
 * (the design's two drawn codes → DEMO12 / DEMO180; the others take the
 * same "DEMO + payout figure" shape).
 *
 * Cookie wording: the design says "30-day cookie" / "Cookie 30 days". The
 * platform sets no cookies (packages/redirect; counsel-gated), so the copy
 * reads "attribution window". No attribution window is implemented either —
 * the day counts are the design's placeholders, like every other figure here.
 *
 * Reference order values (typicalOrderMinor): a percentage payout ("12% /
 * sale") has no rupee value until there is an order, so "Sort: Highest
 * payout" ranks it on payout × this reference order value (lib/links.ts,
 * estimatedPayoutMinor). They are TEST figures chosen so the ranking
 * reproduces the order the design draws under that sort; they are never
 * printed. A real offers endpoint would carry the brand's own average order
 * value (or the sort would rank percentage offers separately).
 */

import {
  DEMO_CREATOR,
  DEMO_LANDING_PAGE,
  DEMO_MY_LINKS,
  DEMO_OFFERS,
  DEMO_PROMO_CODES,
  type DemoOffer,
  type Platform,
} from './afflino';

export interface DemoLinkOffer extends DemoOffer {
  /** The offer detail's terms line (1e): payout, event, allowed platforms, attribution window. */
  terms: string;
  /** "Attribution 30 days" (the design's "Cookie 30 days"; see the module header). */
  attributionDays: number;
  /**
   * Hosts a landing page may be on. Matched exactly (case-insensitive), as
   * the API matches an offer's destination against the programme's
   * allowed_domains (packages/api/src/routes/links.ts).
   */
  allowedDomains: ReadonlyArray<string>;
  /** Pre-filled landing page (host + path, no scheme — as drawn in 3c). */
  defaultLanding: string;
  promoCode: string;
  /** Reference order value for ranking a percentage payout, minor units. Flat payouts leave it out. */
  typicalOrderMinor?: number;
}

interface Extra {
  description?: string;
  terms: string;
  attributionDays: number;
  allowedDomains: ReadonlyArray<string>;
  defaultLanding: string;
  promoCode: string;
  requiresApproval?: boolean;
  typicalOrderMinor?: number;
}

const EXTRA: Record<string, Extra> = {
  'demo-payupi': {
    // 1e: "₹180 per verified sign-up. Allowed: Meta, YouTube, Snapchat. Cookie 30 days."
    terms: '₹180 per verified sign-up. Allowed: Meta, YouTube, Snapchat. Attribution 30 days.',
    attributionDays: 30,
    allowedDomains: ['pay.example.com'],
    defaultLanding: 'pay.example.com/upi-signup',
    promoCode: DEMO_PROMO_CODES.mobile,
  },
  'demo-style': {
    // 1d: "12% of order value, 30-day cookie, promo code included."
    description: '12% of order value, 30-day attribution window, promo code included.',
    terms: '12% of order value on every sale. Allowed: Meta, YouTube. Attribution 30 days.',
    attributionDays: 30,
    allowedDomains: ['shop.example.com'],
    defaultLanding: DEMO_LANDING_PAGE,
    promoCode: DEMO_PROMO_CODES.desktop,
    typicalOrderMinor: 140_000, // ₹1,400 → 12% ≈ ₹168, between ₹180 and ₹150 as drawn
  },
  'demo-learn': {
    terms: '₹150 per qualified lead (phone verified, course selected). Allowed: YouTube. Attribution 30 days.',
    attributionDays: 30,
    allowedDomains: ['learn.example.com'],
    defaultLanding: 'learn.example.com/plus',
    promoCode: 'DEMO150',
  },
  'demo-eats': {
    terms: '₹40 per Gold membership purchase, new users only. Allowed: Meta, Snapchat. Attribution 30 days.',
    attributionDays: 30,
    allowedDomains: ['eats.example.com'],
    defaultLanding: 'eats.example.com/gold',
    promoCode: 'DEMO40',
  },
  'demo-ludo': {
    terms: '₹22 per install with a first match played within 24h. Allowed: Meta, YouTube, Snapchat. Attribution 30 days. The brand approves creators before links go live.',
    attributionDays: 30,
    allowedDomains: ['play.example.com'],
    defaultLanding: 'play.example.com/ludo',
    promoCode: 'DEMO22',
    // The one demo offer that needs brand approval: 1d shows "Apply" for it,
    // and applying puts its link in "Review" (design README, 1d).
    requiresApproval: true,
  },
  'demo-rail': {
    // 1d: "4% of booking value, 7-day cookie."
    description: '4% of booking value, 7-day attribution window.',
    terms: '4% of booking value. Allowed: YouTube, Snapchat. Attribution 7 days.',
    attributionDays: 7,
    allowedDomains: ['trips.example.com'],
    defaultLanding: 'trips.example.com/trains',
    promoCode: 'DEMO4',
    typicalOrderMinor: 50_000, // ₹500 → 4% = ₹20, below ₹22 as drawn
  },
};

/** The six 1d offers with their link terms, in the drawn order. */
export const DEMO_LINK_OFFERS: ReadonlyArray<DemoLinkOffer> = DEMO_OFFERS.map((offer) => {
  const extra = EXTRA[offer.id];
  if (!extra) throw new Error(`lib/demo/links.ts: no link terms for demo offer ${offer.id}`);
  const { description, requiresApproval, ...rest } = extra;
  return {
    ...offer,
    ...rest,
    description: description ?? offer.description,
    requiresApproval: requiresApproval ?? offer.requiresApproval,
  };
});

export function demoLinkOfferById(id: string): DemoLinkOffer | undefined {
  return DEMO_LINK_OFFERS.find((o) => o.id === id);
}

/** Link slugs in demo URLs: the creator handle from afflino.ts. */
export const DEMO_LINK_HANDLE = DEMO_CREATOR.handle;

/** Short category labels for the phone filter row (3f draws "Fashion" for "D2C fashion"). */
export const CATEGORY_SHORT: Readonly<Record<string, string>> = {
  'D2C fashion': 'Fashion',
};

/**
 * What the generator starts with for an offer: the creator's existing demo
 * link for it when there is one (3c's Demo Style Festive: YouTube,
 * short-diwali-02; 1e's Demo PayUPI: Meta, reel-oct-01), else the first
 * allowed platform and no sub-ID.
 */
export function demoDraftDefaults(offer: DemoLinkOffer): { landing: string; platform: Platform; subId: string } {
  const existing = DEMO_MY_LINKS.find((l) => l.offerId === offer.id && offer.platforms.includes(l.platform));
  return {
    landing: offer.defaultLanding,
    platform: existing?.platform ?? offer.platforms[0] ?? 'meta',
    subId: existing?.subId ?? '',
  };
}

/** The offer 3c draws in the generator. */
export const DEMO_GENERATOR_OFFER_ID = 'demo-style';
