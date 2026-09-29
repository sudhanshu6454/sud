/*
 * Creator Settings (2d) — the settings shape, its TEST demo defaults, the
 * field checks, dirty tracking and the localStorage round trip. No React
 * (unit-tested in test/settings.test.ts). The Payouts screen reads the
 * saved payout method from here too, so the two screens agree.
 *
 * No v1 endpoint stores profile, platform, payout or notification settings,
 * so "Save changes" keeps them in this browser only. Nothing here verifies
 * anything: PAN, UPI and GSTIN pass shape checks (lib/validators.ts), no
 * KYC, payout-rail or GST lookup runs.
 */

import { DEMO_CREATOR } from '../../../lib/demo/afflino';
import {
  DEMO_BANK_ACCOUNT,
  DEMO_CONNECTED_DETAIL,
  DEMO_NOTIFICATION_PREFS,
  DEMO_PAN,
  DEMO_SETTINGS_PLATFORMS,
  type DemoNotificationPref,
} from '../../../lib/demo/payouts';
import {
  validateBankAccount,
  validateGstin,
  validateIfsc as validateSharedIfsc,
  validatePan,
  validateUpi,
  type ValidationResult,
} from '../../../lib/validators';

export const SETTINGS_STORAGE_KEY = 'afflino_demo_creator_settings';
const STORAGE_VERSION = 1;

export type PayoutMethod = 'upi' | 'bank';
export type SettingsPlatform = 'instagram' | 'youtube' | 'snapchat';
export type NotificationId = DemoNotificationPref['id'];

export interface CreatorSettings {
  profile: { displayName: string; handle: string; language: string; niche: string };
  /** Connected flag per platform (demo toggles: nothing is linked or unlinked). */
  platforms: Record<SettingsPlatform, boolean>;
  payout: {
    method: PayoutMethod;
    upiId: string;
    pan: string;
    gstin: string;
    bankHolder: string;
    bankAccount: string;
    ifsc: string;
  };
  notifications: Record<NotificationId, boolean>;
}

export type SettingsField =
  | 'displayName'
  | 'handle'
  | 'language'
  | 'niche'
  | 'upiId'
  | 'pan'
  | 'gstin'
  | 'bankHolder'
  | 'bankAccount'
  | 'ifsc';

export const SETTINGS_PLATFORMS: ReadonlyArray<SettingsPlatform> = ['instagram', 'youtube', 'snapchat'];

export function defaultSettings(): CreatorSettings {
  const platforms = {} as Record<SettingsPlatform, boolean>;
  for (const p of SETTINGS_PLATFORMS) {
    platforms[p] = DEMO_SETTINGS_PLATFORMS.find((c) => c.platform === p)?.connected ?? false;
  }
  const notifications = {} as Record<NotificationId, boolean>;
  for (const n of DEMO_NOTIFICATION_PREFS) notifications[n.id] = n.defaultOn;
  return {
    profile: {
      displayName: DEMO_CREATOR.name,
      handle: DEMO_CREATOR.instagramHandle,
      language: DEMO_CREATOR.language,
      niche: DEMO_CREATOR.niche,
    },
    platforms,
    payout: {
      method: 'upi',
      upiId: DEMO_CREATOR.upiId,
      pan: DEMO_PAN,
      gstin: '',
      bankHolder: DEMO_BANK_ACCOUNT.holder,
      bankAccount: DEMO_BANK_ACCOUNT.accountNumber,
      ifsc: DEMO_BANK_ACCOUNT.ifsc,
    },
    notifications,
  };
}

/* ---------- field checks ---------- */

const pass = (value: string): ValidationResult => ({ ok: true, message: '', value });
const fail = (message: string): ValidationResult => ({ ok: false, message });

export function validateDisplayName(input: string): ValidationResult {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (raw === '') return fail('Enter the name brands will see.');
  if (raw.length > 60) return fail('Keep the display name to 60 characters.');
  return pass(raw);
}

/** "@demo.priyanair": 3–30 lowercase letters, digits, dots or underscores; the @ is added. */
export function validateHandle(input: string): ValidationResult {
  const raw = input.trim().replace(/^@/, '').toLowerCase();
  if (raw === '') return fail('Enter your handle.');
  if (raw.length < 3 || raw.length > 30) return fail('A handle is 3 to 30 characters.');
  if (!/^[a-z0-9._]+$/.test(raw)) return fail('Use letters, digits, dots and underscores only.');
  return pass(`@${raw}`);
}

/** Free text (languages, niche): trimmed, at most 80 characters, required. */
export function validateShortText(input: string, what: string): ValidationResult {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (raw === '') return fail(`Enter your ${what}.`);
  if (raw.length > 80) return fail('Keep it to 80 characters.');
  return pass(raw);
}

export function validateAccountHolder(input: string): ValidationResult {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (raw === '') return fail('Enter the name on the bank account.');
  if (raw.length > 80) return fail('Keep the name to 80 characters.');
  return pass(raw);
}

/** Bank account number: 9 to 18 digits, spaces and hyphens dropped (lib/validators.ts). */
export function validateAccountNumber(input: string): ValidationResult {
  return validateBankAccount(input, 'Enter the account number.');
}

/** IFSC: 4 letters, a zero, 6 letters or digits (lib/validators.ts). Shape only; no branch lookup. */
export function validateIfsc(input: string): ValidationResult {
  return validateSharedIfsc(input, 'Enter the IFSC.');
}

export interface SettingsValidation {
  ok: boolean;
  errors: Partial<Record<SettingsField, string>>;
  /** The values to save (trimmed, upper-cased, @-prefixed …). Only meaningful when ok. */
  normalized: CreatorSettings;
}

/** Every field checked; the bank fields only for "Bank transfer", the UPI ID only for "UPI". */
export function validateSettings(s: CreatorSettings): SettingsValidation {
  const errors: Partial<Record<SettingsField, string>> = {};
  const normalized: CreatorSettings = {
    profile: { ...s.profile },
    platforms: { ...s.platforms },
    payout: { ...s.payout },
    notifications: { ...s.notifications },
  };
  const check = (field: SettingsField, result: ValidationResult, apply: (value: string) => void) => {
    if (result.ok) apply(result.value ?? '');
    else errors[field] = result.message;
  };

  check('displayName', validateDisplayName(s.profile.displayName), (v) => (normalized.profile.displayName = v));
  check('handle', validateHandle(s.profile.handle), (v) => (normalized.profile.handle = v));
  check('language', validateShortText(s.profile.language, 'languages'), (v) => (normalized.profile.language = v));
  check('niche', validateShortText(s.profile.niche, 'niche'), (v) => (normalized.profile.niche = v));
  check('pan', validatePan(s.payout.pan), (v) => (normalized.payout.pan = v));
  check('gstin', validateGstin(s.payout.gstin), (v) => (normalized.payout.gstin = v));
  if (s.payout.method === 'upi') {
    check('upiId', validateUpi(s.payout.upiId), (v) => (normalized.payout.upiId = v));
  } else {
    check('bankHolder', validateAccountHolder(s.payout.bankHolder), (v) => (normalized.payout.bankHolder = v));
    check('bankAccount', validateAccountNumber(s.payout.bankAccount), (v) => (normalized.payout.bankAccount = v));
    check('ifsc', validateIfsc(s.payout.ifsc), (v) => (normalized.payout.ifsc = v));
  }
  return { ok: Object.keys(errors).length === 0, errors, normalized };
}

/** Field order on the page, for focusing the first invalid field. */
export const SETTINGS_FIELD_ORDER: ReadonlyArray<SettingsField> = [
  'displayName',
  'handle',
  'language',
  'niche',
  'pan',
  'upiId',
  'bankHolder',
  'bankAccount',
  'ifsc',
  'gstin',
];

export function settingsEqual(a: CreatorSettings, b: CreatorSettings): boolean {
  return serialise(a) === serialise(b);
}

/** Key-order-independent serialisation. */
function serialise(s: CreatorSettings): string {
  const sorted = (o: Record<string, unknown>) =>
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]);
  return JSON.stringify([sorted(s.profile), sorted(s.platforms), sorted(s.payout), sorted(s.notifications)]);
}

/* ---------- localStorage ---------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickStrings<T extends Record<string, string>>(base: T, source: unknown): T {
  const out = { ...base };
  if (!isRecord(source)) return out;
  for (const key of Object.keys(base) as Array<keyof T>) {
    const v = source[key as string];
    if (typeof v === 'string' && v.length <= 200) out[key] = v as T[keyof T];
  }
  return out;
}

function pickBooleans<K extends string>(base: Record<K, boolean>, source: unknown): Record<K, boolean> {
  const out = { ...base };
  if (!isRecord(source)) return out;
  for (const key of Object.keys(base) as K[]) {
    const v = source[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  return out;
}

/**
 * Read a stored value defensively: unknown keys are ignored, missing or
 * mistyped ones fall back to the defaults, another version is ignored.
 */
export function parseStoredSettings(raw: string | null): CreatorSettings | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !isRecord(parsed.settings)) return null;
  const stored = parsed.settings;
  const base = defaultSettings();
  const payout = pickStrings({ ...base.payout, method: base.payout.method as string }, stored.payout);
  return {
    profile: pickStrings(base.profile, stored.profile),
    platforms: pickBooleans(base.platforms, stored.platforms),
    payout: { ...payout, method: payout.method === 'bank' ? 'bank' : 'upi' },
    notifications: pickBooleans(base.notifications, stored.notifications),
  };
}

export function serialiseSettings(s: CreatorSettings): string {
  return JSON.stringify({ version: STORAGE_VERSION, settings: s });
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The saved settings, or the demo defaults (no storage, nothing saved, unreadable value). */
export function loadSettings(storage: StorageLike | null = browserStorage()): CreatorSettings {
  if (!storage) return defaultSettings();
  try {
    return parseStoredSettings(storage.getItem(SETTINGS_STORAGE_KEY)) ?? defaultSettings();
  } catch {
    return defaultSettings();
  }
}

/** false when the browser refused (private mode, storage full, blocked site data). */
export function saveSettings(s: CreatorSettings, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, serialiseSettings(s));
    return true;
  } catch {
    return false;
  }
}

/* ---------- shared read-outs ---------- */

/** The detail line under a platform row. */
export function platformDetail(platform: SettingsPlatform, connected: boolean): string {
  if (!connected) return 'Not connected';
  const drawn = DEMO_SETTINGS_PLATFORMS.find((c) => c.platform === platform);
  return drawn?.connected ? drawn.detail : DEMO_CONNECTED_DETAIL;
}

export interface PayoutMethodSummary {
  /** "demo.priya@upi" or "Bank account ····4321". */
  label: string;
  /** Short method name for payout rows: "UPI" or "Bank". */
  short: string;
  /** "Withdraw to UPI" / "Withdraw to bank". */
  withdrawLabel: string;
  /** The PAN on file is the demo PAN the demo shows as verified (nothing verified it). */
  panDemoVerified: boolean;
}

export function payoutMethodSummary(s: CreatorSettings): PayoutMethodSummary {
  const panDemoVerified = s.payout.pan.trim().toUpperCase() === DEMO_PAN;
  if (s.payout.method === 'bank') {
    const digits = s.payout.bankAccount.replace(/\D/g, '');
    return {
      label: digits.length >= 4 ? `Bank account ····${digits.slice(-4)}` : 'Bank account',
      short: 'Bank',
      withdrawLabel: 'Withdraw to bank',
      panDemoVerified,
    };
  }
  return { label: s.payout.upiId.trim(), short: 'UPI', withdrawLabel: 'Withdraw to UPI', panDemoVerified };
}
