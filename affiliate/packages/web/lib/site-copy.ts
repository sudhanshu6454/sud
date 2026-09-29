/**
 * Afflino marketing claims, prices, fees and policy figures — ONE place.
 *
 * CONFIRMED BY THE OWNER on 2026-09-29 ("figures are confirmed, keep them"):
 * every figure below (audience reach, upfront cost, payout cycle, plan
 * prices and network fees, TDS rate and section, validation windows, minimum
 * withdrawal, default agency share) came from the design handover as a
 * placeholder and is now the owner's confirmed figure. The one exception is
 * CREATOR_DISCLOSURE_LINE at the bottom, which is wording, not a figure, and
 * still waits for counsel. test/site-copy.test.ts pins the confirmed values,
 * so a change is deliberate. Import them from here; never restate them in a
 * page.
 */

/**
 * The one-line description of the site: the root <meta name="description">,
 * og:description / twitter:description (lib/seo.ts) and the PWA manifest.
 * Not a figure, but it is marketing copy, so it lives here.
 */
export const SITE_DESCRIPTION = 'An India-first affiliate network for brands, creators, publishers and agencies.';

export const MARKETING_CLAIMS = {
  /** Hero H1 / stat: in-house network reach across Meta, YouTube and Snapchat. */
  audienceReach: '400M',
  audienceReachWords: '400 million',
  platforms: ['Meta', 'YouTube', 'Snapchat'] as const,
  /** Brands pay nothing upfront — pay on conversion. */
  brandUpfrontCostRupees: 0,
  /** Creator payout cycle. */
  creatorPayoutCycle: 'T+7',
  /** Poster close: creators pay no fee and need no minimum following. */
  creatorsFree: true,
} as const;

export const PRICING = {
  starter: {
    name: 'Starter',
    monthlyRupees: 0,
    /** Network fee on approved payouts. */
    networkFeePct: 15,
    maxLiveOffers: 3,
    features: ['Up to 3 live offers', 'Tracked links + promo codes', 'Standard fraud screening', 'Weekly settlement'],
  },
  network: {
    name: 'Network',
    monthlyRupees: 24_999,
    networkFeePct: 8,
    maxLiveOffers: null,
    features: [
      'Unlimited offers',
      'Managed creator recruitment',
      'Advanced fraud + attribution',
      'Dedicated account manager',
    ],
  },
} as const;

/** TDS on creator payouts, as drawn in 2c ("TDS 1% (194-O) deducted"). Confirmed by the owner, 2026-09-29. */
export const TDS = {
  ratePct: 1,
  section: '194-O',
} as const;

/** The brand's validation window before a conversion clears (2c, 3b default). */
export const VALIDATION_WINDOW_DAYS = 7;

/** Validation-window choices in the offer builder (3b). */
export const VALIDATION_WINDOW_OPTIONS_DAYS = [3, 7, 14] as const;

/** Minimum withdrawal; the Withdraw button is disabled below it (2c). */
export const MIN_WITHDRAWAL_RUPEES = 500;

/** Default agency share of a rostered creator's earnings (3e). */
export const DEFAULT_AGENCY_SHARE_PCT = 15;

/**
 * The creator disclosure line every copy / share action offers ("Disclosure
 * text" in 3c, the share sheet in 1e).
 *
 * WORDING PENDING COUNSEL SIGN-OFF — affiliate/docs/action-tracker.md, the
 * "ASCI disclosure labels and placement" and "ASCI sign-off process" rows.
 * It is a draft, not a compliant disclosure; never present it as meeting the
 * ASCI influencer guidelines.
 */
export const CREATOR_DISCLOSURE_LINE = '#ad — I earn a commission if you buy through this link.';
