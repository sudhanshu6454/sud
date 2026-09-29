/**
 * Marketing site copy (design 1b), composed from lib/site-copy.ts.
 *
 * Every figure here (reach, upfront cost, payout cycle, plan prices and fees,
 * plan features) is read from lib/site-copy.ts, where they are recorded as
 * placeholders pending business confirmation. Nothing below restates a
 * number: change the figure there and the site follows.
 *
 * Relative imports on purpose: the vitest suite imports this module and has
 * no `@/` alias.
 */
import { formatINRWhole } from '../../lib/format';
import { MARKETING_CLAIMS, PRICING } from '../../lib/site-copy';

export interface Cta {
  label: string;
  href: string;
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** 3 → "three" (the design spells small counts out); larger counts stay digits. */
export function numberWord(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n]! : String(n);
}

/** ["Meta", "YouTube", "Snapchat"] → "Meta, YouTube and Snapchat". */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const platforms = MARKETING_CLAIMS.platforms;

/** Where each call to action goes. /join reads `role` (brand | creator) and `plan` (starter). */
export const CTA = {
  listOffer: { label: 'List an offer', href: '/join?role=brand' },
  becomeCreator: { label: 'Become a creator', href: '/join?role=creator' },
  startFree: { label: 'Start free', href: '/join?role=brand&plan=starter' },
  talkToSales: { label: 'Talk to sales', href: '/contact' },
  createFreeAccount: { label: 'Create a free account', href: '/join?role=creator' },
} as const satisfies Record<string, Cta>;

export const HERO = {
  eyebrow: 'Affiliate network · India',
  title: `${MARKETING_CLAIMS.audienceReachWords} people. One link between them and your brand.`,
  body:
    `Afflino connects brands with a creator network across ${joinWithAnd(platforms)}. ` +
    'Brands list offers, creators promote them, and every rupee is tracked from click to payout.',
} as const;

export interface HeroStat {
  value: string;
  label: string;
}

export const HERO_STATS: readonly HeroStat[] = [
  {
    value: MARKETING_CLAIMS.audienceReach,
    label: `Audience reach across ${numberWord(platforms.length)} platforms`,
  },
  {
    value: formatINRWhole(MARKETING_CLAIMS.brandUpfrontCostRupees),
    label: 'Upfront cost for brands — pay on conversion',
  },
  {
    value: MARKETING_CLAIMS.creatorPayoutCycle,
    label: 'Creator payouts by UPI or bank transfer',
  },
];

export interface Step {
  eyebrow: string;
  title: string;
  body: string;
}

/** How it works (the section anchored #brands). */
export const STEPS: readonly Step[] = [
  {
    eyebrow: '01 — List',
    title: 'Brands post an offer',
    body: 'Set the payout per sale, lead or install, the platforms allowed, and the creative kit. Live in a day.',
  },
  {
    eyebrow: '02 — Promote',
    title: 'Creators pick and share',
    body: 'Every creator gets a tracked link and a promo code per offer, ready for Reels, Shorts and Snap stories.',
  },
  {
    eyebrow: '03 — Earn',
    title: 'Afflino tracks and pays',
    body: 'Clicks, conversions and fraud checks in one ledger. Approved earnings settle weekly.',
  },
];

export interface Plan {
  key: 'starter' | 'network';
  eyebrow: string;
  /** The recommended plan: accent eyebrow and a primary button. */
  featured: boolean;
  name: string;
  priceLine: string;
  features: readonly string[];
  cta: Cta;
}

export const PLANS: readonly Plan[] = [
  {
    key: 'starter',
    eyebrow: 'Pricing — brands',
    featured: false,
    name: PRICING.starter.name,
    priceLine: `${formatINRWhole(PRICING.starter.monthlyRupees)} / month · ${PRICING.starter.networkFeePct}% network fee on approved payouts`,
    features: PRICING.starter.features,
    cta: CTA.startFree,
  },
  {
    key: 'network',
    eyebrow: 'Pricing — brands',
    featured: true,
    name: PRICING.network.name,
    priceLine: `${formatINRWhole(PRICING.network.monthlyRupees)} / month · ${PRICING.network.networkFeePct}% network fee`,
    features: PRICING.network.features,
    cta: CTA.talkToSales,
  },
];

/**
 * The red poster close (anchored #creators). Rendered only while the
 * business claims creators pay nothing (MARKETING_CLAIMS.creatorsFree); the
 * page drops the section rather than print a claim that no longer holds.
 */
export const POSTER = MARKETING_CLAIMS.creatorsFree
  ? {
      title: 'Creators are free. Forever.',
      body: 'No fee, no minimum followers. Bring your audience, pick an offer, get paid on every conversion.',
      cta: CTA.createFreeAccount,
    }
  : null;
