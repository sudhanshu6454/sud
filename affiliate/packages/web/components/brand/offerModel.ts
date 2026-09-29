/**
 * Brand offer builder (3b) — the pure part: form shape, parsing, validation,
 * payout / fee maths, the status flow and the row the offers list shows.
 * No React, relative imports only (the tests import it directly).
 *
 * Money stays integer minor units (paise); a CPS rate is basis points
 * (12% → 1200). Amounts are parsed from the typed string with string maths
 * (no floats) and more than two decimals are rejected, never rounded.
 *
 * The plan's network fee comes from lib/site-copy.ts (placeholder pending
 * business confirmation). The budget cap is read as covering creator
 * payouts; the network fee is billed on top, on approved conversions, as the
 * 3b fee note says. That split is inferred from the 2b dashboard (₹18.4L
 * spend ÷ 10,212 sign-ups = the ₹180 payout) and needs business
 * confirmation.
 */

import type { DemoBrandOffer, BrandOfferStatus } from '../../lib/demo/brand';
import type { OfferModel, Platform } from '../../lib/demo/afflino';
import { formatCount, formatINRFromMinor } from '../../lib/format';
import { PRICING, VALIDATION_WINDOW_DAYS, VALIDATION_WINDOW_OPTIONS_DAYS } from '../../lib/site-copy';

export type { BrandOfferStatus } from '../../lib/demo/brand';

export const OFFER_MODELS: ReadonlyArray<OfferModel> = ['CPA', 'CPS', 'CPL', 'CPI'];

/** Platforms a brand can allow (3b toggle tags), in the drawn order. */
export const OFFER_PLATFORMS: ReadonlyArray<Platform> = ['meta', 'youtube', 'snapchat', 'telegram'];

/** What one conversion is called, by model ("₹180 / sign-up", "12% / sale"). */
export const DEFAULT_UNIT: Readonly<Record<OfferModel, string>> = {
  CPA: 'sign-up',
  CPS: 'sale',
  CPL: 'lead',
  CPI: 'install',
};

export const UNIT_OPTIONS: ReadonlyArray<string> = [
  'sign-up',
  'purchase',
  'payment',
  'sale',
  'booking',
  'lead',
  'install',
  'action',
];

/** The model tag's look, as drawn in 1d (CPA accent, CPS / CPI neutral, CPL outline). */
export const MODEL_TAG: Readonly<Record<OfferModel, 'accent' | 'neutral' | 'outline'>> = {
  CPA: 'accent',
  CPS: 'neutral',
  CPL: 'outline',
  CPI: 'neutral',
};

/**
 * The model tag in tables and lists (/brand/offers, /admin/offers): neutral
 * for every model, one look for one model, and the Status column keeps the
 * colour (an outline tag is the Review / Scheduled status look). The drawn
 * per-offer variants stay on the 1d offer-browser cards and the 3b preview.
 */
export const LIST_MODEL_TAG = 'neutral' as const;

export type OfferStep = 'basics' | 'payout' | 'audience' | 'creative';

export const OFFER_STEPS: ReadonlyArray<{ id: OfferStep; number: string; label: string }> = [
  { id: 'basics', number: '01', label: 'Basics' },
  { id: 'payout', number: '02', label: 'Payout' },
  { id: 'audience', number: '03', label: 'Audience & rules' },
  { id: 'creative', number: '04', label: 'Creative kit' },
];

export type CreatorApproval = 'auto' | 'manual';
export type MinFollowers = 'any' | '10k' | '100k' | '1m';
export type IndiaShare = 'any' | '50' | '75';

export const MIN_FOLLOWER_OPTIONS: ReadonlyArray<{ value: MinFollowers; label: string }> = [
  { value: 'any', label: 'Any size' },
  { value: '10k', label: '10K+ followers' },
  { value: '100k', label: '100K+ followers' },
  { value: '1m', label: '1M+ followers' },
];

export const INDIA_SHARE_OPTIONS: ReadonlyArray<{ value: IndiaShare; label: string }> = [
  { value: 'any', label: 'No minimum' },
  { value: '50', label: 'At least 50% in India' },
  { value: '75', label: 'At least 75% in India' },
];

export interface OfferForm {
  /* 01 Basics (drawn) */
  name: string;
  model: OfferModel;
  /** As typed: "₹180" (flat) or "12%" (CPS). */
  payout: string;
  event: string;
  /** As typed: "₹25,00,000". */
  budget: string;
  platforms: Platform[];
  validationDays: number;
  brief: string;
  /* 02 Payout */
  unit: string;
  /** CPS only, optional: the average order value used for the cost estimates. */
  averageOrderValue: string;
  /* 03 Audience & rules */
  approval: CreatorApproval;
  minFollowers: MinFollowers;
  indiaShare: IndiaShare;
  rules: string;
  /* 04 Creative kit */
  landingPage: string;
  promoCode: string;
  assetsUrl: string;
}

export type OfferField = keyof OfferForm;

/** Which step each field lives on (submit jumps to the first step with an error). */
export const FIELD_STEP: Readonly<Record<OfferField, OfferStep>> = {
  name: 'basics',
  model: 'basics',
  payout: 'basics',
  event: 'basics',
  budget: 'basics',
  platforms: 'basics',
  validationDays: 'basics',
  brief: 'basics',
  unit: 'payout',
  averageOrderValue: 'payout',
  approval: 'audience',
  minFollowers: 'audience',
  indiaShare: 'audience',
  rules: 'audience',
  landingPage: 'creative',
  promoCode: 'creative',
  assetsUrl: 'creative',
};

/** Field order for focusing the first error. */
export const FIELD_ORDER: ReadonlyArray<OfferField> = Object.keys(FIELD_STEP) as OfferField[];

export function blankOffer(): OfferForm {
  return {
    name: '',
    model: 'CPA',
    payout: '',
    event: '',
    budget: '',
    platforms: [],
    validationDays: VALIDATION_WINDOW_DAYS,
    brief: '',
    unit: DEFAULT_UNIT.CPA,
    averageOrderValue: '',
    approval: 'auto',
    minFollowers: 'any',
    indiaShare: 'any',
    rules: '',
    landingPage: '',
    promoCode: '',
    assetsUrl: '',
  };
}

/* ------------------------------------------------------------ parsing */

export type Parsed = { ok: true; value: number } | { ok: false };

/**
 * Rupees as typed ("₹25,00,000", "180", "Rs 180.50") → paise. Commas and
 * spaces are ignored; at most two decimals; no sign. String maths, no floats.
 */
export function parseRupeesToMinor(input: string): Parsed {
  const raw = input.trim().replace(/^(₹|rs\.?|inr)\s*/i, '').replace(/[,\s]/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) return { ok: false };
  const rupees = m[1]!.replace(/^0+(?=\d)/, '');
  if (rupees.length > 12) return { ok: false };
  const paise = (m[2] ?? '').padEnd(2, '0');
  return { ok: true, value: Number(rupees) * 100 + Number(paise) };
}

/** A percentage as typed ("12%", "12.5") → basis points (1200, 1250). At most two decimals. */
export function parsePercentToBps(input: string): Parsed {
  const raw = input.trim().replace(/\s*%$/, '').replace(/\s/g, '');
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) return { ok: false };
  const hundredths = (m[2] ?? '').padEnd(2, '0');
  return { ok: true, value: Number(m[1]) * 100 + Number(hundredths) };
}

/** 1200 → "12%", 1250 → "12.5%", 1225 → "12.25%". */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = String(bps % 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${frac ? `.${frac}` : ''}%`;
}

export type PayoutValue = { type: 'flat'; minor: number } | { type: 'percent'; bps: number };

/** The typed payout, when it parses to a positive value in range; CPS is a percentage. */
export function payoutValue(form: Pick<OfferForm, 'model' | 'payout'>): PayoutValue | null {
  if (form.model === 'CPS') {
    const p = parsePercentToBps(form.payout);
    return p.ok && p.value > 0 && p.value <= 10_000 ? { type: 'percent', bps: p.value } : null;
  }
  const p = parseRupeesToMinor(form.payout);
  return p.ok && p.value > 0 ? { type: 'flat', minor: p.value } : null;
}

/** "₹180 / sign-up", "12% / sale"; null when the payout does not parse. */
export function payoutLabel(form: Pick<OfferForm, 'model' | 'payout' | 'unit'>): string | null {
  const value = payoutValue(form);
  if (!value) return null;
  const unit = form.unit.trim() || DEFAULT_UNIT[form.model];
  return `${value.type === 'flat' ? formatINRFromMinor(value.minor) : formatBps(value.bps)} / ${unit}`;
}

/* ------------------------------------------------------------ fee maths */

export type BrandPlan = keyof typeof PRICING;

/** The plan's network fee in percent (site-copy placeholder: Network 8%, Starter 15%). */
export function networkFeePct(plan: BrandPlan): number {
  return PRICING[plan].networkFeePct;
}

/** Network fee on an approved payout, in paise (rounded half up to the paisa). */
export function feeMinor(payoutMinor: number, feePct: number): number {
  return Math.round((payoutMinor * feePct) / 100);
}

/** Creator payout for one CPS sale of the given order value (paise), rounded half up to the paisa. */
export function percentPayoutMinor(orderValueMinor: number, bps: number): number {
  return Math.round((orderValueMinor * bps) / 10_000);
}

export interface OfferCostBreakdown {
  /** Creator payout per approved conversion (for CPS: at the average order value). */
  payoutMinor: number;
  feeMinor: number;
  /** payout + fee: what one approved conversion costs the brand. */
  costMinor: number;
  feePct: number;
  /** Approved conversions the budget cap pays out for (the fee is billed on top). */
  conversionsInBudget: number | null;
  /** Fee billed if the whole cap is paid out. */
  feeAtCapMinor: number | null;
}

/**
 * The payout step's maths. Null when the payout does not parse, or for CPS
 * without a usable average order value.
 */
export function costBreakdown(
  form: Pick<OfferForm, 'model' | 'payout' | 'budget' | 'averageOrderValue'>,
  plan: BrandPlan,
): OfferCostBreakdown | null {
  const value = payoutValue(form);
  if (!value) return null;
  let payout: number;
  if (value.type === 'flat') {
    payout = value.minor;
  } else {
    const aov = parseRupeesToMinor(form.averageOrderValue);
    if (!aov.ok || aov.value <= 0) return null;
    payout = percentPayoutMinor(aov.value, value.bps);
    if (payout <= 0) return null;
  }
  const feePct = networkFeePct(plan);
  const fee = feeMinor(payout, feePct);
  const budget = parseRupeesToMinor(form.budget);
  const hasBudget = budget.ok && budget.value > 0;
  return {
    payoutMinor: payout,
    feeMinor: fee,
    costMinor: payout + fee,
    feePct,
    conversionsInBudget: hasBudget ? Math.floor(budget.value / payout) : null,
    feeAtCapMinor: hasBudget ? feeMinor(budget.value, feePct) : null,
  };
}

/* ------------------------------------------------------------ reach (demo) */

/** Sum of the per-platform [low, high] reach (millions); null with no platform. */
export function estimateReach(
  platforms: ReadonlyArray<Platform>,
  table: Readonly<Partial<Record<Platform, readonly [number, number]>>>,
): [number, number] | null {
  let low = 0;
  let high = 0;
  let any = false;
  for (const p of platforms) {
    const r = table[p];
    if (!r) continue;
    low += r[0];
    high += r[1];
    any = true;
  }
  return any ? [low, high] : null;
}

/** [38, 52] → "38–52M". */
export function formatReach(range: readonly [number, number]): string {
  return `${formatCount(range[0])}–${formatCount(range[1])}M`;
}

/* ------------------------------------------------------------ validation */

export type OfferErrors = Partial<Record<OfferField, string>>;

export interface ValidationContext {
  /** The brand's website host; the landing page must be on it (or a subdomain). */
  allowedDomain: string;
}

const PROMO_RE = /^[A-Z0-9]{4,15}$/;

/** Host of an https URL, or an error message. */
function httpsHost(input: string): { host: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { error: 'Enter a full address starting with https://' };
  }
  if (url.protocol !== 'https:') return { error: 'Use an https:// address.' };
  if (!url.hostname.includes('.')) return { error: 'Enter a full address starting with https://' };
  return { host: url.hostname.toLowerCase() };
}

/** The host of a website setting ("https://shop.example.com" or "shop.example.com"). */
export function domainOf(website: string): string {
  const raw = website.trim();
  if (!raw) return '';
  try {
    return new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function onDomain(host: string, domain: string): boolean {
  const h = host.replace(/^www\./, '');
  return h === domain || h.endsWith(`.${domain}`);
}

/** Every rule the builder checks before "Submit for review". Empty object = valid. */
export function validateOffer(form: OfferForm, ctx: ValidationContext): OfferErrors {
  const e: OfferErrors = {};

  const name = form.name.trim();
  if (name === '') e.name = 'Give the offer a name.';
  else if (name.length < 3) e.name = 'Use at least 3 characters.';
  else if (name.length > 80) e.name = 'Keep the name to 80 characters.';

  if (!OFFER_MODELS.includes(form.model)) e.model = 'Choose a payout model.';

  let flatPayout: number | null = null;
  if (form.model === 'CPS') {
    const p = parsePercentToBps(form.payout);
    if (form.payout.trim() === '') e.payout = 'Enter the payout as a % of the sale.';
    else if (!p.ok) e.payout = 'Enter a percentage with up to 2 decimals, e.g. 12%.';
    else if (p.value <= 0 || p.value > 10_000) e.payout = 'Use a percentage above 0 and at most 100.';
  } else {
    const p = parseRupeesToMinor(form.payout);
    if (form.payout.trim() === '') e.payout = 'Enter the payout per conversion.';
    else if (!p.ok) e.payout = 'Enter an amount in rupees with up to 2 decimals, e.g. ₹180.';
    else if (p.value <= 0) e.payout = 'The payout must be more than ₹0.';
    else flatPayout = p.value;
  }

  const event = form.event.trim();
  if (event === '') e.event = 'Say what counts as a conversion.';
  else if (event.length > 140) e.event = 'Keep the conversion event to 140 characters.';

  const budget = parseRupeesToMinor(form.budget);
  if (form.budget.trim() === '') e.budget = 'Enter a budget cap.';
  else if (!budget.ok) e.budget = 'Enter an amount in rupees, e.g. ₹25,00,000.';
  else if (budget.value <= 0) e.budget = 'The budget cap must be more than ₹0.';
  else if (flatPayout !== null && budget.value < flatPayout) e.budget = 'The budget cap must cover at least one payout.';

  if (form.platforms.length === 0) e.platforms = 'Choose at least one platform.';
  else if (form.platforms.some((p) => !OFFER_PLATFORMS.includes(p))) e.platforms = 'Choose from the listed platforms.';

  if (!(VALIDATION_WINDOW_OPTIONS_DAYS as ReadonlyArray<number>).includes(form.validationDays)) {
    e.validationDays = 'Choose a validation window.';
  }

  const brief = form.brief.trim();
  if (brief === '') e.brief = 'Tell creators what to say and what to avoid.';
  else if (brief.length > 1000) e.brief = 'Keep the brief to 1,000 characters.';

  if (form.unit.trim() === '') e.unit = 'Say what one conversion is called.';
  else if (form.unit.trim().length > 20) e.unit = 'Keep it to 20 characters.';

  if (form.model === 'CPS' && form.averageOrderValue.trim() !== '') {
    const aov = parseRupeesToMinor(form.averageOrderValue);
    if (!aov.ok || aov.value <= 0) e.averageOrderValue = 'Enter an amount in rupees, e.g. ₹1,500.';
  }

  if (form.rules.trim().length > 600) e.rules = 'Keep the rules to 600 characters.';

  const landing = form.landingPage.trim();
  if (landing === '') e.landingPage = 'Enter the landing page creators send people to.';
  else {
    const h = httpsHost(landing);
    if ('error' in h) e.landingPage = h.error;
    else if (!ctx.allowedDomain) e.landingPage = 'Add your website in Settings first: landing pages must be on it.';
    else if (!onDomain(h.host, ctx.allowedDomain)) e.landingPage = `Use a page on ${ctx.allowedDomain}, your website in Settings.`;
  }

  const promo = form.promoCode.trim().toUpperCase();
  if (promo !== '' && !PROMO_RE.test(promo)) e.promoCode = 'A promo code is 4–15 letters or digits.';

  const assets = form.assetsUrl.trim();
  if (assets !== '') {
    const h = httpsHost(assets);
    if ('error' in h) e.assetsUrl = h.error;
  }

  return e;
}

/** A draft only needs a name. */
export function validateDraft(form: Pick<OfferForm, 'name'>): OfferErrors {
  const name = form.name.trim();
  if (name === '') return { name: 'Give the draft a name before saving it.' };
  if (name.length > 80) return { name: 'Keep the name to 80 characters.' };
  return {};
}

/** The first field with an error, in form order. */
export function firstError(errors: OfferErrors): OfferField | null {
  return FIELD_ORDER.find((f) => errors[f] !== undefined) ?? null;
}

/** Error counts per step (the tab row marks steps that need attention). */
export function errorsByStep(errors: OfferErrors): Record<OfferStep, number> {
  const counts: Record<OfferStep, number> = { basics: 0, payout: 0, audience: 0, creative: 0 };
  for (const f of Object.keys(errors) as OfferField[]) counts[FIELD_STEP[f]] += 1;
  return counts;
}

/* ------------------------------------------------------------ status flow */

/**
 * Draft → In review → Live → Paused / Ended (or Rejected). Admin moves an
 * offer out of review (Live or Rejected); the brand can withdraw it, pause,
 * resume and end a live one, and edit a draft or a rejected offer.
 */
export type OfferAction = 'edit' | 'delete' | 'withdraw' | 'pause' | 'resume' | 'end' | 'duplicate';

export const STATUS_ACTIONS: Readonly<Record<BrandOfferStatus, ReadonlyArray<OfferAction>>> = {
  Draft: ['edit', 'delete'],
  'In review': ['withdraw'],
  Live: ['pause', 'end'],
  Paused: ['resume', 'end'],
  Ended: ['duplicate'],
  Rejected: ['edit', 'delete'],
};

export const ACTION_LABEL: Readonly<Record<OfferAction, string>> = {
  edit: 'Edit',
  delete: 'Delete',
  withdraw: 'Withdraw',
  pause: 'Pause',
  resume: 'Resume',
  end: 'End',
  duplicate: 'Duplicate',
};

/** The status an action moves an offer to (null: the action does not change the status, or is not allowed). */
export function nextStatus(status: BrandOfferStatus, action: OfferAction): BrandOfferStatus | null {
  if (!STATUS_ACTIONS[status].includes(action)) return null;
  switch (action) {
    case 'withdraw':
      return 'Draft';
    case 'pause':
      return 'Paused';
    case 'resume':
      return 'Live';
    case 'end':
      return 'Ended';
    default:
      return null;
  }
}

/** Every status in flow order (the offers list filter). */
export const STATUS_ORDER: ReadonlyArray<BrandOfferStatus> = ['Live', 'In review', 'Draft', 'Paused', 'Ended', 'Rejected'];

/* ------------------------------------------------------------ list rows */

/** The offers-list row for a builder form (unparsed amounts become 0 and show as "—"). */
export function formToRow(
  id: string,
  form: OfferForm,
  status: BrandOfferStatus,
  updated: string,
): DemoBrandOffer {
  const value = payoutValue(form);
  const budget = parseRupeesToMinor(form.budget);
  return {
    id,
    name: form.name.trim() || 'Untitled offer',
    model: form.model,
    payoutType: form.model === 'CPS' ? 'percent' : 'flat',
    payoutValue: value ? (value.type === 'flat' ? value.minor : value.bps) : 0,
    unit: form.unit.trim() || DEFAULT_UNIT[form.model],
    event: form.event.trim(),
    budgetMinor: budget.ok ? budget.value : 0,
    platforms: [...form.platforms],
    validationDays: form.validationDays,
    status,
    updated,
  };
}

/** "₹180 / sign-up" / "12% / sale" for a row; "—" when not set. */
export function rowPayoutLabel(row: Pick<DemoBrandOffer, 'payoutType' | 'payoutValue' | 'unit'>): string {
  if (row.payoutValue <= 0) return '—';
  return `${row.payoutType === 'flat' ? formatINRFromMinor(row.payoutValue) : formatBps(row.payoutValue)} / ${row.unit}`;
}

/** A seed offer back into the builder's form (Duplicate / Edit of a demo row). */
export function rowToForm(row: DemoBrandOffer, landingPage = ''): OfferForm {
  const rupees = (minor: number) => {
    const r = Math.floor(minor / 100);
    const p = minor % 100;
    return `${formatINRFromMinor(r * 100)}${p ? `.${String(p).padStart(2, '0')}` : ''}`;
  };
  return {
    ...blankOffer(),
    name: row.name,
    model: row.model,
    payout: row.payoutValue > 0 ? (row.payoutType === 'flat' ? rupees(row.payoutValue) : formatBps(row.payoutValue)) : '',
    unit: row.unit,
    event: row.event,
    budget: row.budgetMinor > 0 ? rupees(row.budgetMinor) : '',
    platforms: OFFER_PLATFORMS.filter((p) => row.platforms.includes(p)),
    validationDays: row.validationDays,
    landingPage,
  };
}
