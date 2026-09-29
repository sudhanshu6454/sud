/**
 * Dev sign-in (/login). There is no identity provider yet: the API trusts a
 * signed development token (the JWT stub from
 * packages/api/scripts/mint-dev-token.mjs, claims { sub, org_id, role }).
 * This module checks the token's *shape* and reads the claims it states so
 * the page can show them. It verifies nothing — the API checks the
 * signature on every request — and it never sends the token anywhere.
 *
 * Storage is lib/api.ts's: TOKEN_KEY (the bearer apiFetch sends) and
 * PUBLISHER_ID_KEY (getStoredPublisherId(), for the earnings views and disputes).
 *
 * Relative imports on purpose: the vitest suite imports this module.
 */
import { PUBLISHER_ID_KEY, TOKEN_KEY } from '../../lib/api';

/** The subset of Web Storage the session helpers use (tests pass a Map-backed one). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Claims as the token states them. Unverified. */
export interface TokenClaims {
  sub?: string;
  org_id?: string;
  role?: string;
  /** Seconds since the epoch. */
  exp?: number;
  iat?: number;
}

export interface CheckResult {
  ok: boolean;
  /** Why not, for the inline field error ('' when ok). */
  message: string;
  /** Normalised value to store when ok. */
  value?: string;
}

export interface TokenCheck extends CheckResult {
  claims?: TokenClaims;
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function base64UrlToText(segment: string): string | null {
  try {
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The payload a JWT states, or null when it is not readable JSON. Does not verify the signature. */
export function decodeTokenClaims(token: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const text = base64UrlToText(parts[1]!);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const raw = parsed as Record<string, unknown>;
    const claims: TokenClaims = {};
    if (typeof raw.sub === 'string') claims.sub = raw.sub;
    if (typeof raw.org_id === 'string') claims.org_id = raw.org_id;
    if (typeof raw.role === 'string') claims.role = raw.role;
    if (typeof raw.exp === 'number' && Number.isFinite(raw.exp)) claims.exp = raw.exp;
    if (typeof raw.iat === 'number' && Number.isFinite(raw.iat)) claims.iat = raw.iat;
    return claims;
  } catch {
    return null;
  }
}

/** "29 Sept 2026, 6:00 pm" in the viewer's time zone. */
export function formatExpiry(expSeconds: number): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(expSeconds * 1000),
  );
}

/** The token field: required, JWT-shaped, a readable payload, not past its `exp`. */
export function checkDevToken(input: string, now: number = Date.now()): TokenCheck {
  // Pasted from a terminal it may carry line breaks or a "Bearer " prefix.
  const raw = input.trim().replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
  if (raw === '') return { ok: false, message: 'Paste a development token.' };
  if (!JWT_SHAPE.test(raw)) {
    return {
      ok: false,
      message: 'That is not a development token. A token has three parts separated by dots (header.payload.signature).',
    };
  }
  const claims = decodeTokenClaims(raw);
  if (!claims) {
    return { ok: false, message: 'The middle part of that token could not be read. Paste the whole token.' };
  }
  if (claims.exp !== undefined && claims.exp * 1000 <= now) {
    return { ok: false, message: `This token expired on ${formatExpiry(claims.exp)}. Mint a new one.` };
  }
  return { ok: true, message: '', value: raw, claims };
}

/** The publisher id field: optional; a uuid when present (stored lower-case). */
export function checkPublisherId(input: string): CheckResult {
  const raw = input.trim();
  if (raw === '') return { ok: true, message: '', value: '' };
  if (!UUID.test(raw)) {
    return { ok: false, message: 'A publisher id is a uuid: 32 hex digits in groups of 8-4-4-4-12.' };
  }
  return { ok: true, message: '', value: raw.toLowerCase() };
}

export interface DevSession {
  token: string;
  publisherId: string | null;
}

/** What this browser holds, or null when no token is saved. */
export function readDevSession(storage: StorageLike): DevSession | null {
  const token = storage.getItem(TOKEN_KEY);
  if (!token) return null;
  return { token, publisherId: storage.getItem(PUBLISHER_ID_KEY) || null };
}

/** Save the token and the publisher id; an empty publisher id removes the stored one. */
export function saveDevSession(storage: StorageLike, session: { token: string; publisherId: string }): void {
  storage.setItem(TOKEN_KEY, session.token);
  if (session.publisherId) storage.setItem(PUBLISHER_ID_KEY, session.publisherId);
  else storage.removeItem(PUBLISHER_ID_KEY);
}

/** Sign out: remove both keys. */
export function clearDevSession(storage: StorageLike): void {
  storage.removeItem(TOKEN_KEY);
  storage.removeItem(PUBLISHER_ID_KEY);
}

/** The last characters of a token, to tell tokens apart without printing one. */
export function tokenTail(token: string, length = 6): string {
  return token.length <= length ? token : token.slice(-length);
}

/** window.localStorage, or null when the browser blocks it (private modes, disabled site data). */
export function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    const probe = '__afflino_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
