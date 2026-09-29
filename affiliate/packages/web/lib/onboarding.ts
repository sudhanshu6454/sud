/**
 * Sign-up & onboarding (design handover 2a / 3a) — the model behind /join.
 *
 * Roles, the three steps per branch, the form state and its reducer, the
 * per-step validation (which errors exist, which are visible, which field
 * gets focus), how far the URL's ?step= may jump, and the live submission's
 * body and error mapping. Pure: no React, no browser APIs, so
 * test/onboarding.test.ts covers it directly.
 *
 * Branches:
 * - supply (creator, publisher — drawn in 2a / 3a): account → connect
 *   platforms → payout (PAN, UPI or bank, optional GSTIN, consent).
 * - business (brand, agency — not drawn, same shell): account → company
 *   details (legal name, GSTIN, website, category) → billing contact and a
 *   wallet top-up amount (demo: no payment is taken).
 *
 * Nothing here verifies anything. OTP, platform connections and the PAN
 * "Verified" line are demo flows (no SMS, OAuth or KYC provider exists);
 * the validators below are client-side shape checks like lib/validators.ts.
 * The only live call is POST /v1/publishers for a creator / publisher who
 * holds a dev token (lib/api.ts).
 */

import { formatCountCompact, formatINRWhole, formatPct } from './format';
import { PRICING } from './site-copy';
import {
  validateBankAccount,
  validateGstin,
  validateIfsc,
  validateMobile,
  validateOtp,
  validatePan,
  validateUpi,
  type OptionalRule,
  type ValidationResult,
} from './validators';

// Shared with settings (2d); re-exported so onboarding callers keep one import.
export { validateBankAccount, validateIfsc };

/* ---------- roles and steps ---------- */

export type Role = 'creator' | 'publisher' | 'brand' | 'agency';
export type Branch = 'supply' | 'business';

export interface RoleOption {
  value: Role;
  title: string;
  description: string;
}

/** 2a: the 2×2 account-type grid, in the drawn order and copy. */
export const ROLE_OPTIONS: ReadonlyArray<RoleOption> = [
  {
    value: 'creator',
    title: 'Creator / influencer',
    description: 'Promote offers on your Instagram, YouTube or Snapchat.',
  },
  { value: 'publisher', title: 'Publisher', description: 'Websites, apps, Telegram channels and deal pages.' },
  { value: 'brand', title: 'Brand / advertiser', description: 'List offers and pay only on conversion.' },
  { value: 'agency', title: 'Agency', description: 'Manage several brands or a roster of creators.' },
];

const ROLES: ReadonlyArray<Role> = ROLE_OPTIONS.map((r) => r.value);

/** ?role= → a role, or null when absent / unknown (nothing is preselected). */
export function parseRole(raw: string | string[] | null | undefined): Role | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  return value && (ROLES as ReadonlyArray<string>).includes(value) ? (value as Role) : null;
}

/** Creator / publisher → supply; brand / agency → business. No role yet → supply (the drawn branch). */
export function branchOf(role: Role | null): Branch {
  return role === 'brand' || role === 'agency' ? 'business' : 'supply';
}

export type StepNumber = 1 | 2 | 3;
export const STEP_NUMBERS: ReadonlyArray<StepNumber> = [1, 2, 3];
/** A view of the flow: a step, or the success panel. */
export type JoinView = StepNumber | 'done';

/** ?step= → 1, 2, 3 or 'done'; anything else is step 1. */
export function parseStep(raw: string | string[] | null | undefined): JoinView {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (value === '2') return 2;
  if (value === '3') return 3;
  if (value === 'done') return 'done';
  return 1;
}

export interface StepDef {
  number: StepNumber;
  /** Left-panel step list ("01 — Account type"). */
  label: string;
  /** Phone header strip, where three long labels do not fit. */
  short: string;
}

const SUPPLY_STEPS: ReadonlyArray<StepDef> = [
  { number: 1, label: 'Account type', short: 'Account' },
  { number: 2, label: 'Connect platforms', short: 'Platforms' },
  { number: 3, label: 'Payout details (PAN, UPI)', short: 'Payout' },
];

const BUSINESS_STEPS: ReadonlyArray<StepDef> = [
  { number: 1, label: 'Account type', short: 'Account' },
  { number: 2, label: 'Company details', short: 'Company' },
  { number: 3, label: 'Billing and wallet', short: 'Billing' },
];

export function stepsFor(role: Role | null): ReadonlyArray<StepDef> {
  return branchOf(role) === 'business' ? BUSINESS_STEPS : SUPPLY_STEPS;
}

/** "01" */
export function stepIndexLabel(step: StepNumber): string {
  return String(step).padStart(2, '0');
}

/* ---------- the pricing plan a brand picked on the marketing page ---------- */

/** The brand plans of the pricing section (lib/site-copy.ts PRICING). */
export type PlanId = keyof typeof PRICING;

const PLAN_IDS = Object.keys(PRICING) as ReadonlyArray<PlanId>;

/** ?plan= → "starter" | "network", or null when absent / unknown. */
export function parsePlan(raw: string | string[] | null | undefined): PlanId | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  return value && (PLAN_IDS as ReadonlyArray<string>).includes(value) ? (value as PlanId) : null;
}

/**
 * The role /join starts with: ?role=, or a brand when only ?plan= came
 * (the plans are brand pricing).
 */
export function initialRole(role: string | string[] | null | undefined, plan: string | string[] | null | undefined): Role | null {
  return parseRole(role) ?? (parsePlan(plan) ? 'brand' : null);
}

/** Only the brand flow carries a plan (the pricing section prices brands). */
export function planFor(role: Role | null, plan: PlanId | null): PlanId | null {
  return role === 'brand' ? plan : null;
}

/** "Starter · ₹0 / month · 15% network fee on approved payouts" (the pricing section's line). */
export function planSummary(plan: PlanId): string {
  const p = PRICING[plan];
  return `${p.name} · ${formatINRWhole(p.monthlyRupees)} / month · ${p.networkFeePct}% network fee on approved payouts`;
}

/**
 * Query string for a view: "?role=creator&step=2" (step 1 carries no step,
 * no role carries no role); a brand keeps the plan it picked
 * ("?role=brand&plan=starter&step=3").
 */
export function joinSearch(role: Role | null, view: JoinView, plan: PlanId | null = null): string {
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  const kept = planFor(role, plan);
  if (kept) params.set('plan', kept);
  if (view !== 1) params.set('step', String(view));
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Where "Go to your dashboard →" leads. */
export function dashboardHref(role: Role | null): '/app' | '/brand' | '/agency' {
  if (role === 'brand') return '/brand';
  if (role === 'agency') return '/agency';
  return '/app';
}

/* ---------- platforms (supply step 2) ---------- */

export type PlatformId = 'instagram' | 'youtube' | 'snapchat';

export interface PlatformRow {
  id: PlatformId;
  name: string;
  /** Detail line while not connected (3a draws "Optional" for Snapchat). */
  idle: string;
}

/** 3a rows, in the drawn order. Website / Telegram is the fourth row (a URL, not a connection). */
export const SOCIAL_PLATFORMS: ReadonlyArray<PlatformRow> = [
  { id: 'instagram', name: 'Instagram (Meta)', idle: 'Not connected' },
  { id: 'youtube', name: 'YouTube', idle: 'Not connected' },
  { id: 'snapchat', name: 'Snapchat', idle: 'Optional' },
];

/** A connected account's detail line, as 3a prints it: "@handle · 1.2M · 84% India" (no India share → omitted). */
export function connectedDetail(account: { handle: string; followers: number; pctIndia: number | null }): string {
  const parts = [account.handle, formatCountCompact(account.followers)];
  if (account.pctIndia !== null) parts.push(`${formatPct(account.pctIndia)} India`);
  return parts.join(' · ');
}

/** "+916000000001" → "+91 60000 00001" (anything else unchanged). */
export function formatMobile(normalised: string): string {
  return normalised.replace(/^\+91(\d{5})(\d{5})$/, '+91 $1 $2');
}

/* ---------- business categories (business step 2) ---------- */

/** The offer browser's category filters (1d), plus "Other". */
export const BUSINESS_CATEGORIES: ReadonlyArray<string> = [
  'Fintech',
  'D2C fashion',
  'Edtech',
  'Food delivery',
  'Gaming',
  'Travel',
  'Other',
];

/* ---------- extra validators (shape checks only; candidates for lib/validators.ts) ---------- */

const pass = (value: string): ValidationResult => ({ ok: true, message: '', value });
const fail = (message: string): ValidationResult => ({ ok: false, message });

/** A person's name: 2–100 characters after trimming (inner runs of spaces collapsed), with at least one letter. */
export function validateFullName(input: string, emptyMessage = 'Enter your full name.'): ValidationResult {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (raw === '') return fail(emptyMessage);
  if (raw.length < 2) return fail('Enter the full name, not an initial.');
  if (raw.length > 100) return fail('Keep the name under 100 characters.');
  if (!/\p{L}/u.test(raw)) return fail('A name needs letters.');
  return pass(raw);
}

/** Registered company name: 2–200 characters after trimming. */
export function validateLegalName(input: string): ValidationResult {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (raw === '') return fail('Enter the registered company name.');
  if (raw.length < 2) return fail('Enter the full registered name.');
  if (raw.length > 200) return fail('Keep the name under 200 characters.');
  if (!/[\p{L}\p{N}]/u.test(raw)) return fail('A company name needs letters or digits.');
  return pass(raw);
}

/**
 * Website: an http(s) address with a dotted host name ("https://" is added
 * when missing). Normalised to the URL without a trailing "/" on the root.
 */
export function validateWebsite(input: string, rule: OptionalRule = {}): ValidationResult {
  const raw = input.trim();
  if (raw === '') return rule.optional ? pass('') : fail('Enter your website address.');
  if (/\s/.test(raw)) return fail('A web address has no spaces.');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return fail('That is not a web address (e.g. https://shop.example.com).');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail('Use an http or https address.');
  if (url.username || url.password) return fail('Leave the user name and password out of the address.');
  const labels = url.hostname.split('.');
  const tld = labels[labels.length - 1] ?? '';
  if (labels.length < 2 || labels.some((l) => l === '') || !/^[a-z]{2,}$/i.test(tld)) {
    return fail('That is not a web address (e.g. https://shop.example.com).');
  }
  const href = url.pathname === '/' && !url.search && !url.hash ? url.origin : url.href;
  return pass(href);
}

/**
 * Website or Telegram channel for manual review: a Telegram username
 * ("@name", "t.me/name", "telegram.me/name"; 5–32 letters, digits or
 * underscores, starting with a letter) becomes "https://t.me/name";
 * anything else must pass validateWebsite. Invite links (t.me/+…) are not
 * accepted: review needs a public channel.
 */
export function validateChannel(input: string): ValidationResult {
  const raw = input.trim();
  if (raw === '') return fail('Enter a website or Telegram channel.');
  const handle = /^@([A-Za-z][A-Za-z0-9_]{4,31})$/.exec(raw);
  if (handle) return pass(`https://t.me/${handle[1]}`);
  const tme = /^(?:https?:\/\/)?(?:www\.)?(?:t|telegram)\.me\/(.*)$/i.exec(raw);
  if (tme) {
    const name = (tme[1] ?? '').replace(/\/+$/, '');
    if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(name)) {
      return fail('Use the public channel link, e.g. t.me/demochannel.');
    }
    return pass(`https://t.me/${name}`);
  }
  const site = validateWebsite(raw);
  return site.ok ? site : fail('Enter a website (https://…) or a Telegram channel (t.me/…).');
}

/** Email: one "@", a dotted domain, no spaces. Trimmed; case kept. */
export function validateEmail(input: string): ValidationResult {
  const raw = input.trim();
  if (raw === '') return fail('Enter an email address.');
  if (raw.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(raw)) {
    return fail('An email address looks like name@company.com.');
  }
  return pass(raw);
}

/**
 * Wallet top-up: whole rupees, optional "₹" and grouping commas
 * ("25,000", "₹1,00,000"); at least ₹1 and at most 9 digits (a sanity
 * bound, not a business limit). Normalised to the rupee digits. Optional by
 * default — the wallet can be topped up later.
 */
export function validateTopUp(input: string, rule: OptionalRule = { optional: true }): ValidationResult {
  const raw = input.trim().replace(/^₹\s*/, '');
  if (raw === '') return rule.optional ? pass('') : fail('Enter an amount in rupees.');
  if (!/^[\d,\s]+$/.test(raw)) return fail('Whole rupees only, e.g. 25,000.');
  const digits = raw.replace(/[,\s]/g, '').replace(/^0+(?=\d)/, '');
  if (digits === '' || /^0+$/.test(digits)) return fail('Enter an amount above ₹0.');
  if (digits.length > 9) return fail('That amount is too large for one top-up.');
  return pass(digits);
}

/** A validated top-up in integer minor units (paise), or null when none was entered. */
export function topUpMinor(input: string): number | null {
  const result = validateTopUp(input);
  if (!result.ok || !result.value) return null;
  return Number(result.value) * 100;
}

/* ---------- form state ---------- */

export type PayoutMethod = 'upi' | 'bank';

export interface OnboardingForm {
  role: Role | null;
  fullName: string;
  mobile: string;
  /** The normalised number the (demo) code was "sent" to; null until Send OTP. */
  otpSentTo: string | null;
  otp: string;
  /** Demo connections (no OAuth exists). */
  connected: Record<PlatformId, boolean>;
  /** Website / Telegram submitted for manual review, normalised ('' = none). */
  channel: string;
  pan: string;
  payoutMethod: PayoutMethod;
  upiId: string;
  bankAccount: string;
  ifsc: string;
  gstin: string;
  /** Creator Terms + ASCI influencer disclosure guidelines (supply step 3). */
  consent: boolean;
  legalName: string;
  companyGstin: string;
  website: string;
  category: string;
  billingName: string;
  billingEmail: string;
  topUp: string;
  /** Terms of use (business step 3). */
  termsConsent: boolean;
}

export type TextField =
  | 'fullName'
  | 'mobile'
  | 'otp'
  | 'pan'
  | 'upiId'
  | 'bankAccount'
  | 'ifsc'
  | 'gstin'
  | 'legalName'
  | 'companyGstin'
  | 'website'
  | 'category'
  | 'billingName'
  | 'billingEmail'
  | 'topUp';

/** Every key an error can sit on: the text fields plus the groups. */
export type ErrorKey = TextField | 'role' | 'platforms' | 'consent' | 'termsConsent';

export type StepErrors = Partial<Record<ErrorKey, string>>;

export interface OnboardingState {
  form: OnboardingForm;
  /** Fields left holding a value at least once (their own errors show from then on). */
  touched: Partial<Record<TextField, true>>;
  /** Steps whose Continue / Finish was pressed (every error on them shows from then on). */
  attempted: Partial<Record<StepNumber, true>>;
}

export function emptyForm(role: Role | null = null): OnboardingForm {
  return {
    role,
    fullName: '',
    mobile: '',
    otpSentTo: null,
    otp: '',
    connected: { instagram: false, youtube: false, snapchat: false },
    channel: '',
    pan: '',
    payoutMethod: 'upi',
    upiId: '',
    bankAccount: '',
    ifsc: '',
    gstin: '',
    consent: false,
    legalName: '',
    companyGstin: '',
    website: '',
    category: '',
    billingName: '',
    billingEmail: '',
    topUp: '',
    termsConsent: false,
  };
}

export function initialState(role: Role | null = null): OnboardingState {
  return { form: emptyForm(role), touched: {}, attempted: {} };
}

export type OnboardingAction =
  | { type: 'setRole'; role: Role }
  | { type: 'setText'; field: TextField; value: string }
  | { type: 'setPayoutMethod'; method: PayoutMethod }
  | { type: 'setConsent'; field: 'consent' | 'termsConsent'; value: boolean }
  /** Demo "Send OTP": records the number when it is valid (no SMS is sent). */
  | { type: 'sendOtp' }
  /** Demo connect / disconnect (no OAuth). */
  | { type: 'togglePlatform'; platform: PlatformId }
  /** Website / Telegram for manual review; stored only when validateChannel passes, '' removes it. */
  | { type: 'setChannel'; value: string }
  | { type: 'touch'; field: TextField }
  | { type: 'attempt'; step: StepNumber };

/** Upper-cased, space-free identifiers (PAN, IFSC, GSTIN) as the user types. */
const UPPER_FIELDS: ReadonlySet<TextField> = new Set(['pan', 'ifsc', 'gstin', 'companyGstin']);

function normaliseInput(field: TextField, value: string): string {
  if (UPPER_FIELDS.has(field)) return value.toUpperCase().replace(/\s+/g, '');
  if (field === 'otp') return value.replace(/\D/g, '').slice(0, 6);
  return value;
}

export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  const { form } = state;
  switch (action.type) {
    case 'setRole':
      return form.role === action.role ? state : { ...state, form: { ...form, role: action.role } };
    case 'setText': {
      const value = normaliseInput(action.field, action.value);
      const next: OnboardingForm = { ...form, [action.field]: value };
      if (action.field === 'mobile' && form.otpSentTo !== null) {
        // A code "sent" to another number no longer counts.
        const mobile = validateMobile(value);
        if (!mobile.ok || mobile.value !== form.otpSentTo) {
          next.otpSentTo = null;
          next.otp = '';
        }
      }
      return { ...state, form: next };
    }
    case 'setPayoutMethod':
      return form.payoutMethod === action.method ? state : { ...state, form: { ...form, payoutMethod: action.method } };
    case 'setConsent':
      return { ...state, form: { ...form, [action.field]: action.value } };
    case 'sendOtp': {
      const mobile = validateMobile(form.mobile);
      if (!mobile.ok || !mobile.value) return { ...state, touched: { ...state.touched, mobile: true } };
      if (form.otpSentTo === mobile.value) return state;
      return { ...state, form: { ...form, otpSentTo: mobile.value, otp: '' } };
    }
    case 'togglePlatform':
      return {
        ...state,
        form: { ...form, connected: { ...form.connected, [action.platform]: !form.connected[action.platform] } },
      };
    case 'setChannel': {
      if (action.value.trim() === '') return { ...state, form: { ...form, channel: '' } };
      const channel = validateChannel(action.value);
      return channel.ok && channel.value ? { ...state, form: { ...form, channel: channel.value } } : state;
    }
    case 'touch':
      // Leaving an empty field marks nothing: tabbing through a form must not paint it red.
      if (state.touched[action.field] || form[action.field].trim() === '') return state;
      return { ...state, touched: { ...state.touched, [action.field]: true } };
    case 'attempt':
      return state.attempted[action.step]
        ? state
        : { ...state, attempted: { ...state.attempted, [action.step]: true } };
    default:
      return state;
  }
}

/* ---------- validation ---------- */

/** Fields on each step, in screen order (the first invalid one gets focus). */
export function stepFields(
  role: Role | null,
  step: StepNumber,
  form?: Pick<OnboardingForm, 'payoutMethod'>,
): ErrorKey[] {
  if (step === 1) return ['role', 'fullName', 'mobile', 'otp'];
  if (branchOf(role) === 'business') {
    return step === 2
      ? ['legalName', 'website', 'category', 'companyGstin']
      : ['billingName', 'billingEmail', 'topUp', 'termsConsent'];
  }
  if (step === 2) return ['platforms'];
  const payout: ErrorKey[] = form?.payoutMethod === 'bank' ? ['bankAccount', 'ifsc'] : ['upiId'];
  return ['pan', ...payout, 'gstin', 'consent'];
}

/** One text field on its own (shape only; cross-field rules live in stepErrors). */
export function fieldError(form: OnboardingForm, field: TextField): string | undefined {
  const r = ((): ValidationResult => {
    switch (field) {
      case 'fullName':
        return validateFullName(form.fullName);
      case 'mobile':
        return validateMobile(form.mobile);
      case 'otp':
        return validateOtp(form.otp);
      case 'pan':
        return validatePan(form.pan);
      case 'upiId':
        return validateUpi(form.upiId);
      case 'bankAccount':
        return validateBankAccount(form.bankAccount);
      case 'ifsc':
        return validateIfsc(form.ifsc);
      case 'gstin':
        return validateGstin(form.gstin);
      case 'legalName':
        return validateLegalName(form.legalName);
      case 'companyGstin':
        return validateGstin(form.companyGstin);
      case 'website':
        return validateWebsite(form.website);
      case 'category':
        return form.category ? pass(form.category) : fail('Choose a category.');
      case 'billingName':
        return validateFullName(form.billingName, "Enter the billing contact's name.");
      case 'billingEmail':
        return validateEmail(form.billingEmail);
      case 'topUp':
        return validateTopUp(form.topUp);
      default:
        return pass('');
    }
  })();
  return r.ok ? undefined : r.message;
}

/** Every error on a step, in screen order (whether shown yet or not). Empty = the step is complete. */
export function stepErrors(form: OnboardingForm, step: StepNumber): StepErrors {
  const errors: StepErrors = {};
  for (const key of stepFields(form.role, step, form)) {
    let message: string | undefined;
    switch (key) {
      case 'role':
        message = form.role ? undefined : 'Choose how you will use Afflino.';
        break;
      case 'mobile': {
        message = fieldError(form, 'mobile');
        if (!message && validateMobile(form.mobile).value !== form.otpSentTo) {
          message = 'Send the OTP to verify this number.';
        }
        break;
      }
      case 'otp':
        // Asked only once a code has been "sent" to the current number.
        message =
          form.otpSentTo !== null && form.otpSentTo === validateMobile(form.mobile).value
            ? fieldError(form, 'otp')
            : undefined;
        break;
      case 'platforms':
        message =
          Object.values(form.connected).some(Boolean) || form.channel !== ''
            ? undefined
            : 'Connect at least one platform, or add a website or Telegram channel, to continue.';
        break;
      case 'consent':
        message = form.consent ? undefined : 'Agree to the Creator Terms and the ASCI guidelines to finish.';
        break;
      case 'termsConsent':
        message = form.termsConsent ? undefined : 'Agree to the Terms of use to finish.';
        break;
      default:
        message = fieldError(form, key);
    }
    if (message) errors[key] = message;
  }
  return errors;
}

export function isStepComplete(form: OnboardingForm, step: StepNumber): boolean {
  return Object.keys(stepErrors(form, step)).length === 0;
}

/**
 * The errors to draw now: all of them once the step was attempted; before
 * that, only the own (shape) errors of touched fields — a field is touched
 * when it is left holding a value, or when Send OTP is pressed on it.
 */
export function visibleErrors(state: OnboardingState, step: StepNumber): StepErrors {
  const all = stepErrors(state.form, step);
  if (state.attempted[step]) return all;
  const shown: StepErrors = {};
  for (const key of Object.keys(all) as ErrorKey[]) {
    if (!isTextField(key) || !state.touched[key]) continue;
    const own = fieldError(state.form, key);
    if (own) shown[key] = own;
  }
  return shown;
}

/** The first key with an error, in screen order (focus goes there), or null. */
export function firstErrorKey(errors: StepErrors): ErrorKey | null {
  const keys = Object.keys(errors) as ErrorKey[];
  return keys[0] ?? null;
}

const TEXT_FIELDS: ReadonlySet<string> = new Set<TextField>([
  'fullName',
  'mobile',
  'otp',
  'pan',
  'upiId',
  'bankAccount',
  'ifsc',
  'gstin',
  'legalName',
  'companyGstin',
  'website',
  'category',
  'billingName',
  'billingEmail',
  'topUp',
]);

function isTextField(key: ErrorKey): key is TextField {
  return TEXT_FIELDS.has(key);
}

/**
 * The step a URL may show: the requested one, unless an earlier step is
 * incomplete (a fresh load of ?step=3, or a hand-edited URL), in which case
 * that earlier step. 'done' needs a finished submission (the caller's flag).
 */
export function reachableView(form: OnboardingForm, requested: JoinView, finished: boolean): JoinView {
  if (requested === 'done') {
    if (finished) return 'done';
    requested = 3;
  }
  for (const step of STEP_NUMBERS) {
    if (step >= requested) break;
    if (!isStepComplete(form, step)) return step;
  }
  return requested;
}

/* ---------- submission ---------- */

/** POST /v1/publishers body (packages/api/src/routes/publishers.ts): the full name as legal_name, country IN. */
export interface CreatePublisherBody {
  legal_name: string;
  country: 'IN';
}

/** The API's public publisher row. */
export interface PublisherApplication {
  id: string;
  legal_name: string;
  country: string;
  status: string;
  onboarding_state: string;
  created_at?: unknown;
}

export function applicationBody(form: OnboardingForm): CreatePublisherBody {
  const name = validateFullName(form.fullName);
  return { legal_name: name.value ?? form.fullName.trim(), country: 'IN' };
}

/** Only creators and publishers become a publisher application, and only with a dev token. */
export function submitsLive(role: Role | null, hasToken: boolean): boolean {
  return hasToken && (role === 'creator' || role === 'publisher');
}

/** Human labels for the API's onboarding states (0003_phase3.sql). */
export const ONBOARDING_STATE_LABEL: Readonly<Record<string, string>> = {
  application: 'Application received',
  identity_review: 'Identity review',
  property_verification: 'Property verification',
  programme_eligibility: 'Programme eligibility',
  contract: 'Contract',
  active: 'Active',
};

export function onboardingStateLabel(state: string): string {
  return ONBOARDING_STATE_LABEL[state] ?? state;
}

export type SubmitFailure =
  /** The API could not be reached (browser or the /api proxy): a labelled demo result, nothing created. */
  | { kind: 'fallback' }
  /** The API answered with a refusal: say why, nothing created, the user may retry. */
  | { kind: 'error'; message: string };

/** Maps a POST /v1/publishers failure (ApiError code + message) to what the page does. */
export function submitFailure(code: string, message: string): SubmitFailure {
  switch (code) {
    case 'NETWORK_UNREACHABLE':
    case 'UPSTREAM_UNAVAILABLE':
      return { kind: 'fallback' };
    case 'UNAUTHORIZED':
      return {
        kind: 'error',
        message:
          'Your sign-in token was not accepted (missing, expired or from another environment). Log in again, then finish.',
      };
    case 'FORBIDDEN':
      return {
        kind: 'error',
        message:
          'Your token’s role cannot open a publisher application. It needs publisher_owner, editor or network_admin.',
      };
    case 'VALIDATION_ERROR':
      return { kind: 'error', message: `The API rejected the details: ${message}` };
    case 'RATE_LIMITED':
      return { kind: 'error', message: 'Too many attempts. Wait a moment, then finish again.' };
    default:
      return {
        kind: 'error',
        message: `The application could not be created (${code}). Nothing was saved; try again.`,
      };
  }
}
