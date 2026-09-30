/**
 * Afflino marketing claims, prices, fees and policy figures — ONE place.
 *
 * CONFIRMED BY THE OWNER on 2026-09-29 ("figures are confirmed, keep them"):
 * every figure below (audience reach, upfront cost, payout cycle, plan
 * prices and network fees, TDS rate and section, validation windows, minimum
 * withdrawal, default agency share) came from the design handover as a
 * placeholder and is now the owner's confirmed figure. The exceptions are
 * CREATOR_DISCLOSURE_LINE, which is wording, not a figure, and still waits
 * for counsel, and AMAZON_IN at the bottom, which is Amazon's own mandated
 * text (quoted) plus two button labels that wait for counsel.
 * test/site-copy.test.ts (AMAZON_IN: test/amazon-shop.test.ts) pins the
 * values, so a change is deliberate. Import them from here; never restate
 * them in a page.
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

/**
 * Amazon.in Associates copy (the shop's Amazon offers, the site footer).
 * Sources: the policy brief of 2026-09-29, quoting Amazon's own pages — the
 * amazon.in Associates Operating Agreement ("OA") and help topics (the api
 * package's ASSUMPTIONS.md, "Amazon.in Associates", has the references; no
 * Amazon URL is written anywhere in the web). test/amazon-shop.test.ts pins
 * each string, so a change is deliberate.
 *
 * - `associateStatement` is Amazon's own mandated text, VERBATIM (OA §10:
 *   "You must clearly and prominently state the following, or any
 *   substantially similar statement …"). Not our wording; nothing to
 *   draft. Shown near every Amazon call to action and, once the owner turns
 *   AMAZON_ASSOCIATE on, in the site footer ("identify yourself on your Site
 *   as an Amazon Associate", help GPXFHVYZMTGPUMPE). Whether it is also
 *   enough under the ASCI guidelines is counsel's question
 *   (docs/counsel-briefing.md).
 * - `priceDisclaimer` and `contentAttribution` are OA §11's templates,
 *   VERBATIM except for the bracketed choice Amazon leaves to the Associate:
 *   "[relevant Amazon Site(s), as applicable]" → "Amazon.in" (OA: "“Amazon
 *   Site” means the www.amazon.in site") and "[IN THIS APPLICATION or ON
 *   THIS SITE, as applicable]" → "ON THIS SITE".
 * - `pricePrefix` follows OA §11's example ("Amazon.in Price: Rs.3500 (as of
 *   13/07/2013 14:11 IST - Details)"); the amount is formatted as every
 *   other price on the site (₹3,500).
 * - DRAFT PENDING COUNSEL SIGN-OFF: `ctaLabel` and `noPriceLabel`. The brief
 *   asks for "a "Buy on Amazon.in" CTA" (PR 20: no confusion about the site
 *   on which the order happens), but the amazon.in Trademark Guidelines page
 *   rendered empty, so the nominative use of "Amazon.in" in a button label
 *   is counsel's (docs/action-tracker.md, "Trademarks").
 * - DRAFT PENDING COUNSEL SIGN-OFF: `purchaseNote` (the item page's line
 *   under the button) and `affiliateLinksFact` (the look page's fact in
 *   place of "Sponsored: No"). The purchase note says only where the
 *   purchase happens, never who delivers or takes returns (a third-party
 *   seller's listing is not Amazon's: LR, no "inaccurate, overbroad,
 *   deceptive or otherwise misleading claims about any Product, the Amazon
 *   Site, or any of our policies").
 */
export const AMAZON_IN = {
  connector: 'amazon-associates',
  associateStatement: 'As an Amazon Associate I earn from qualifying purchases.',
  ctaLabel: 'Buy on Amazon.in',
  noPriceLabel: 'See price on Amazon.in',
  pricePrefix: 'Amazon.in Price',
  priceDisclaimer:
    'Product prices and availability are accurate as of the date/time indicated and are subject to change. Any price and availability information displayed on Amazon.in at the time of purchase will apply to the purchase of this product.',
  contentAttribution:
    'CERTAIN CONTENT THAT APPEARS ON THIS SITE COMES FROM AMAZON SELLER SERVICES PRIVATE LIMITED. THIS CONTENT IS PROVIDED ‘AS IS’ AND IS SUBJECT TO CHANGE OR REMOVAL AT ANY TIME.',
  purchaseNote: "You complete the purchase on Amazon.in; Amazon.in's terms apply.",
  affiliateLinksFactLabel: 'Affiliate links',
  affiliateLinksFact: 'Yes (we earn from qualifying purchases)',
} as const;

/**
 * Celebrity looks on the consumer side (the Spotted feed, a look piece by
 * piece, a celebrity's hub, a storefront). DRAFTS PENDING COUNSEL SIGN-OFF
 * (docs/counsel-briefing.md §10, questions Q7–Q11; docs/action-tracker.md
 * "Celebrity look wording"). The wording that says anything about a
 * celebrity or a product is NOT here: the headline, the commercial label,
 * the non-endorsement line and each item's EXACT / SIMILAR line come from
 * the API (packages/shared/src/celebrity.ts CELEBRITY_COPY), so the rule
 * lives in one place. These are the web's own labels around them;
 * test/spotted.test.ts checks them against the wording deny-list (nothing
 * here says or implies that a celebrity wore, owns, chose, loves or
 * recommends a product, no "dupe", no "for less", no savings claim).
 */
export const CELEBRITY_WEB = {
  feedTitle: 'Spotted',
  feedIntro: 'Moments from our pages, piece by piece: the exact item when our editors identified it, and similar styles.',
  trendingTitle: 'Trending this week',
  feedEmptyTitle: 'Nothing spotted yet.',
  feedEmpty: 'New looks appear here as soon as our editors publish them.',
  filterCelebrity: 'Celebrity',
  filterPage: 'Page',
  filterAll: 'All',
  moreLooksTitle: 'More looks',
  exactTag: 'Exact match',
  similarTag: 'Similar style',
  outfitTitle: 'The outfit, piece by piece',
  noProducts: 'Products are not shown for this look.',
  noProductsYet: 'No product for this piece yet.',
  originalPost: 'View the original post',
  fromPage: 'Posted on',
  viewLook: 'View the look',
  hubLooks: 'Looks',
  storefrontLooks: 'Latest looks',
  storefrontEmpty: 'No looks on this page yet.',
  share: 'Share this page',
  copied: 'Link copied',
  qrLabel: 'Scan to open this page',
  withdrawnTitle: 'This page was withdrawn.',
  withdrawn: 'It is no longer available on Afflino.',
  withdrawnAction: 'See every look on Spotted',
  storefrontMissingTitle: 'This page is not on Afflino right now.',
  storefrontMissing: 'The link may be old, or the page is not live yet.',
  hubTitle: 'Spotted looks',
  similarRowHint: 'Swipe for more similar styles',
  piecesIndex: 'The pieces',
  photoNotShown: 'Photo not shown',
  qrShow: 'Show the QR code',
  qrHide: 'Hide the QR code',
  showLooks: 'Show looks',
} as const;
