/*
 * Agency workspace model (3e): the agency share maths, the dialogs'
 * validation and the browser storage. Pure: no React, no '@/' imports (the
 * root vitest config has no alias), storage injected.
 *
 * Money is integer minor units (paise). The share is a whole percentage
 * (0–50, default DEFAULT_AGENCY_SHARE_PCT from lib/site-copy.ts, a
 * placeholder); share = round(earned × pct / 100) to the paisa.
 */

import { DEFAULT_AGENCY_SHARE_PCT } from '../../lib/site-copy';
import { validateGstin } from '../../lib/validators';
import { formatINRFromMinor } from '../../lib/format';
import type { Platform } from '../../lib/demo/afflino';

export const AGENCY_SHARE_MIN_PCT = 0;
export const AGENCY_SHARE_MAX_PCT = 50;
export { DEFAULT_AGENCY_SHARE_PCT };

export type Check<T> = { ok: true; value: T } | { ok: false; message: string };

/** "15" → 15. Whole numbers from 0 to 50 only; a trailing "%" is allowed. */
export function parseSharePct(input: string): Check<number> {
  const raw = input.trim().replace(/\s*%$/, '');
  if (raw === '') return { ok: false, message: 'Enter the agency share, 0 to 50%.' };
  if (!/^\d{1,3}$/.test(raw)) return { ok: false, message: 'Use a whole number from 0 to 50.' };
  const value = Number(raw);
  if (value < AGENCY_SHARE_MIN_PCT || value > AGENCY_SHARE_MAX_PCT) {
    return { ok: false, message: 'The agency share is 0 to 50%.' };
  }
  return { ok: true, value };
}

function assertShareInputs(earnedMinor: number, pct: number) {
  if (!Number.isSafeInteger(earnedMinor)) throw new RangeError('earnedMinor must be an integer amount in minor units');
  if (!Number.isInteger(pct) || pct < AGENCY_SHARE_MIN_PCT || pct > AGENCY_SHARE_MAX_PCT) {
    throw new RangeError(`pct must be a whole number from ${AGENCY_SHARE_MIN_PCT} to ${AGENCY_SHARE_MAX_PCT}`);
  }
}

/** The agency's share of a creator's earnings, in minor units: round(earned × pct / 100). */
export function agencyShareMinor(earnedMinor: number, pct: number): number {
  assertShareInputs(earnedMinor, pct);
  // earned × pct is an exact integer; one division, rounded half up to the paisa.
  return Math.round((earnedMinor * pct) / 100);
}

/** "₹27,648 (15%)" — the 3e share cell. */
export function formatShareCell(earnedMinor: number, pct: number): string {
  return `${formatINRFromMinor(agencyShareMinor(earnedMinor, pct))} (${pct}%)`;
}

export interface RosterRow {
  name: string;
  reach: number;
  liveOffers: number;
  earnedMinor: number;
}

export interface RosterRowWithShare extends RosterRow {
  shareMinor: number;
  sharePct: number;
}

export function rosterWithShare<R extends RosterRow>(rows: ReadonlyArray<R>, pct: number): Array<R & RosterRowWithShare> {
  return rows.map((row) => ({ ...row, shareMinor: agencyShareMinor(row.earnedMinor, pct), sharePct: pct }));
}

/** Sum of the per-creator shares (each already rounded, so the total matches the column). */
export function totalShareMinor(rows: ReadonlyArray<RosterRow>, pct: number): number {
  return rows.reduce((sum, row) => sum + agencyShareMinor(row.earnedMinor, pct), 0);
}

/* ---------- dialogs ---------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateName(input: string, what: string): Check<string> {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (raw === '') return { ok: false, message: `Enter the ${what}.` };
  if (raw.length < 2) return { ok: false, message: `The ${what} is at least 2 characters.` };
  if (raw.length > 80) return { ok: false, message: `Keep the ${what} under 80 characters.` };
  return { ok: true, value: raw };
}

export function validateEmail(input: string): Check<string> {
  const raw = input.trim();
  if (raw === '') return { ok: false, message: 'Enter an email address.' };
  if (raw.length > 254 || !EMAIL.test(raw)) return { ok: false, message: 'An email address looks like name@domain.com.' };
  return { ok: true, value: raw.toLowerCase() };
}

/** "@handle", a channel name or a site / channel address: 2–60 characters. */
export function validateHandle(input: string): Check<string> {
  const raw = input.trim();
  if (raw === '') return { ok: false, message: 'Enter the handle or channel.' };
  if (raw.length < 2) return { ok: false, message: 'The handle is at least 2 characters.' };
  if (raw.length > 60) return { ok: false, message: 'Keep the handle under 60 characters.' };
  return { ok: true, value: raw };
}

export function validateChoice<T extends string>(input: string, allowed: ReadonlyArray<T>, what: string): Check<T> {
  return (allowed as ReadonlyArray<string>).includes(input)
    ? { ok: true, value: input as T }
    : { ok: false, message: `Choose a ${what}.` };
}

export interface InviteDraft {
  name: string;
  email: string;
  platform: string;
  handle: string;
}

export interface Invite {
  id: string;
  name: string;
  email: string;
  platform: Platform;
  handle: string;
  createdAt: string;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export function validateInvite(
  draft: InviteDraft,
  platforms: ReadonlyArray<Platform>,
): { ok: true; value: Omit<Invite, 'id' | 'createdAt'> } | { ok: false; errors: FieldErrors<keyof InviteDraft> } {
  const name = validateName(draft.name, 'creator’s name');
  const email = validateEmail(draft.email);
  const platform = validateChoice(draft.platform, platforms, 'main platform');
  const handle = validateHandle(draft.handle);
  if (name.ok && email.ok && platform.ok && handle.ok) {
    return { ok: true, value: { name: name.value, email: email.value, platform: platform.value, handle: handle.value } };
  }
  const errors: FieldErrors<keyof InviteDraft> = {};
  if (!name.ok) errors.name = name.message;
  if (!email.ok) errors.email = email.message;
  if (!platform.ok) errors.platform = platform.message;
  if (!handle.ok) errors.handle = handle.message;
  return { ok: false, errors };
}

export interface ClientDraft {
  name: string;
  category: string;
  email: string;
  gstin: string;
}

export interface PendingClient {
  id: string;
  name: string;
  category: string;
  email: string;
  gstin: string;
  createdAt: string;
}

export function validateClient(
  draft: ClientDraft,
  categories: ReadonlyArray<string>,
): { ok: true; value: Omit<PendingClient, 'id' | 'createdAt'> } | { ok: false; errors: FieldErrors<keyof ClientDraft> } {
  const name = validateName(draft.name, 'brand name');
  const category = validateChoice(draft.category, categories, 'category');
  const email = validateEmail(draft.email);
  const gstin = validateGstin(draft.gstin);
  if (name.ok && category.ok && email.ok && gstin.ok) {
    return { ok: true, value: { name: name.value, category: category.value, email: email.value, gstin: gstin.value ?? '' } };
  }
  const errors: FieldErrors<keyof ClientDraft> = {};
  if (!name.ok) errors.name = name.message;
  if (!category.ok) errors.category = category.message;
  if (!email.ok) errors.email = email.message;
  if (!gstin.ok) errors.gstin = gstin.message;
  return { ok: false, errors };
}

/* ---------- storage ---------- */

export const AGENCY_STORAGE_KEYS = {
  share: 'afflino_agency_share_v1',
  invites: 'afflino_agency_invites_v1',
  clients: 'afflino_agency_clients_v1',
} as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function read(storage: StorageLike | null | undefined, key: string): unknown {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function write(storage: StorageLike | null | undefined, key: string, value: unknown): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** The stored share, or the default when nothing valid is stored. */
export function loadSharePct(storage: StorageLike | null | undefined): number {
  const value = read(storage, AGENCY_STORAGE_KEYS.share);
  if (typeof value !== 'number') return DEFAULT_AGENCY_SHARE_PCT;
  const check = parseSharePct(String(value));
  return check.ok ? check.value : DEFAULT_AGENCY_SHARE_PCT;
}

export function saveSharePct(storage: StorageLike | null | undefined, pct: number): boolean {
  return write(storage, AGENCY_STORAGE_KEYS.share, pct);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

export function loadInvites(storage: StorageLike | null | undefined, platforms: ReadonlyArray<Platform>): Invite[] {
  const value = read(storage, AGENCY_STORAGE_KEYS.invites);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is Invite =>
      !!v &&
      typeof v === 'object' &&
      isString(v.id) &&
      isString(v.name) &&
      isString(v.email) &&
      isString(v.handle) &&
      isString(v.createdAt) &&
      (platforms as ReadonlyArray<string>).includes(v.platform),
  );
}

export function saveInvites(storage: StorageLike | null | undefined, invites: ReadonlyArray<Invite>): boolean {
  return write(storage, AGENCY_STORAGE_KEYS.invites, invites);
}

export function loadPendingClients(storage: StorageLike | null | undefined): PendingClient[] {
  const value = read(storage, AGENCY_STORAGE_KEYS.clients);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is PendingClient =>
      !!v &&
      typeof v === 'object' &&
      isString(v.id) &&
      isString(v.name) &&
      isString(v.category) &&
      isString(v.email) &&
      isString(v.gstin) &&
      isString(v.createdAt),
  );
}

export function savePendingClients(storage: StorageLike | null | undefined, clients: ReadonlyArray<PendingClient>): boolean {
  return write(storage, AGENCY_STORAGE_KEYS.clients, clients);
}

/** A local id for a demo record ("demo-invite-…"). */
export function demoId(prefix: string, now: number = Date.now(), random: number = Math.random()): string {
  return `demo-${prefix}-${now.toString(36)}${Math.floor(random * 1e6).toString(36)}`;
}
