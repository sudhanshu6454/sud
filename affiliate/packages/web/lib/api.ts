/**
 * Typed fetch client for the Paparazzi v1 API.
 *
 * - Base URL comes from NEXT_PUBLIC_API_BASE; the default is the same-origin
 *   `/api` prefix, which app/api/[...path]/route.ts proxies to API_BASE at
 *   request time (so portal/console calls need no CORS and no public API
 *   origin). Set NEXT_PUBLIC_API_BASE to an absolute URL to call the API
 *   directly instead.
 * - Auth: `Authorization: Bearer <token>` where the token is read from
 *   localStorage key `paparazzi_token`. Portal pages call apiFetch(); if the
 *   API is unreachable (or returns a non-OK status) callers fall back to the
 *   clearly-labelled demo data in lib/portal-demo.ts and render <DemoBadge />.
 *   withDemoFallback hands back the error: only an unreachable API
 *   (isUnreachable) is labelled "API unreachable"; an answer the API gave
 *   (401 / 403 / 404 / 400 / 5xx) is named in a Banner (fallbackNotice).
 * - `Content-Type: application/json` is sent only with a body: Fastify
 *   rejects an empty body declared as JSON (a bodyless POST such as
 *   /v1/suspense/:id/retry would never reach its handler).
 *
 * Known API surface (packages/api):
 *   success envelope: { data, request_id }
 *   error envelope:   { error: { code, message }, request_id }
 *   GET  /v1/publisher/earnings?publisher_id=<uuid> -> { publisher_id, balances }
 *   POST /v1/links {property_id, programme_id, offer_id, placement_id} -> { token, url }
 *   GET  /v1/disputes?publisher_id= -> Dispute[] ; POST /v1/disputes {kind, subject, claim_ref?, publisher_id?} -> Dispute
 *   POST /v1/programmes/:id/pause|resume (network_admin) -> kill switch
 *   GET  /v1/suspense?connector=&programme_id=&received_from=&received_to=&reviewed=&limit=&offset=
 *        -> { items: SuspenseItem[], limit, offset, total } (finance_operator, finance_approver, network_admin)
 *   POST /v1/suspense/:id/retry -> { id, attributed, click_id?, reason? }
 *   POST /v1/suspense/:id/review {note} -> { id, reviewed_at, reviewed_by, review_note }
 *
 * Do NOT depend on un-documented endpoints from here; keep using the demo
 * fallback until the API ships them.
 */

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/+$/, '') || '/api';

export const TOKEN_KEY = 'paparazzi_token';
export const PUBLISHER_ID_KEY = 'paparazzi_publisher_id';

/** The TEST demo publisher of lib/portal-demo.ts. Never sent to the API (a real API answers 404). */
export const DEMO_PUBLISHER_ID = '11111111-1111-4111-8111-111111111111';

function readLocal(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return readLocal(TOKEN_KEY);
}

/** The publisher id /login (or /join) stored, or null: never the demo id. */
export function getStoredPublisherId(): string | null {
  const value = readLocal(PUBLISHER_ID_KEY)?.trim();
  return value ? value : null;
}

/** Canonical error codes from @paparazzi/shared + our own network sentinel. */
export type ApiCode =
  | 'PROGRAMME_NOT_APPROVED'
  | 'OFFER_STALE'
  | 'PROPERTY_FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'LEDGER_IMBALANCE'
  | 'INTERNAL'
  | 'NETWORK_UNREACHABLE'
  | string;

export class ApiError extends Error {
  readonly code: ApiCode;
  readonly status: number;
  constructor(code: ApiCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

interface SuccessEnvelope<T> {
  data: T;
  request_id: string;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
  request_id?: string;
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

/** Fetch from the v1 API, unwrap the success envelope, throw ApiError on failure. */
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(
      'NETWORK_UNREACHABLE',
      `API unreachable at ${API_BASE}: ${err instanceof Error ? err.message : 'network error'}`,
      0,
    );
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const envelope = parsed as ErrorEnvelope | null;
    const code = envelope?.error?.code || 'INTERNAL';
    const message = envelope?.error?.message || `Request failed with HTTP ${res.status}`;
    throw new ApiError(code, message, res.status);
  }

  return (parsed as SuccessEnvelope<T>).data;
}

export interface DemoFallbackResult<T> {
  value: T;
  /** true: `value` is the demo value (render <DemoBadge />). */
  demo: boolean;
  /** Why the live call failed; null when it answered. */
  error: ApiError | null;
}

/**
 * Run a live request; on any failure (network or API error) return the demo
 * value instead. The `demo: true` flag tells the caller to render
 * <DemoBadge />; `error` says why, so the page can tell an unreachable API
 * (isUnreachable → variant "fallback") from an answer it gave (a Banner
 * from fallbackNotice, and the plain "Demo data" badge).
 */
export async function withDemoFallback<T>(live: () => Promise<T>, demo: T): Promise<DemoFallbackResult<T>> {
  try {
    return { value: await live(), demo: false, error: null };
  } catch (err) {
    const error =
      err instanceof ApiError ? err : new ApiError('INTERNAL', err instanceof Error ? err.message : 'Unexpected error', 0);
    return { value: demo, demo: true, error };
  }
}

/**
 * The request never got an answer from the API: the browser could not reach
 * it (NETWORK_UNREACHABLE) or the same-origin proxy could not
 * (UPSTREAM_UNAVAILABLE, 502). Only then does a page say "API unreachable".
 */
export function isUnreachable(error: ApiError | null | undefined): boolean {
  return !!error && (error.code === 'NETWORK_UNREACHABLE' || error.code === 'UPSTREAM_UNAVAILABLE');
}

export interface FallbackNotice {
  title: string;
  message: string;
  /** A way out, e.g. { href: '/login', label: 'Log in again' }. */
  action?: { href: string; label: string };
}

/** Why a live call fell back to demo data. */
export type FallbackKind = 'unreachable' | 'unauthorized' | 'forbidden' | 'not-found' | 'invalid' | 'error';

export function fallbackKind(error: ApiError | null | undefined): FallbackKind | null {
  if (!error) return null;
  if (isUnreachable(error)) return 'unreachable';
  if (error.status === 401 || error.code === 'UNAUTHORIZED') return 'unauthorized';
  if (error.status === 403 || error.code === 'FORBIDDEN') return 'forbidden';
  if (error.status === 404 || error.code === 'NOT_FOUND') return 'not-found';
  if (error.status === 400 || error.status === 422 || error.code === 'VALIDATION_ERROR') return 'invalid';
  return 'error';
}

/**
 * The Banner for a live call the API answered with an error, so the page
 * shows demo data; null for an unreachable API (the badge says so) and for
 * no error. `what` names the data ("your earnings", "the suspense queue");
 * `overrides` replaces the wording for one kind (e.g. a 404 that means "this
 * publisher id is not in your organisation").
 */
export function fallbackNotice(
  error: ApiError | null | undefined,
  what: string,
  overrides: Partial<Record<Exclude<FallbackKind, 'unreachable'>, FallbackNotice>> = {},
): FallbackNotice | null {
  const kind = fallbackKind(error);
  if (!error || !kind || kind === 'unreachable') return null;
  const override = overrides[kind];
  if (override) return override;
  const said = error.message ? ` ("${error.message.replace(/[.\s]+$/, '')}")` : '';
  switch (kind) {
    case 'unauthorized':
      return {
        title: `Sign in to see ${what}.`,
        message: 'The API did not accept your token (missing, expired or from another environment), so this page shows demo data.',
        action: { href: '/login', label: 'Log in again' },
      };
    case 'forbidden':
      return {
        title: `This account cannot read ${what}.`,
        message: `The API refused your role${said}, so this page shows demo data.`,
      };
    case 'not-found':
      return { title: `${capitalise(what)} not found.`, message: `The API answered 404${said}, so this page shows demo data.` };
    case 'invalid':
      return { title: 'The API rejected the request.', message: `It answered${said || ' 400'}, so this page shows demo data.` };
    default:
      return {
        title: `${capitalise(what)} unavailable.`,
        message: `The API answered with an error (${error.code}), so this page shows demo data.`,
      };
  }
}

function capitalise(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/* ---------- v1 types ---------- */

export interface BalanceBucket {
  pending: number;
  approved: number;
  collected: number;
  payable: number;
}

export interface EarningsResponse {
  publisher_id: string;
  balances: Record<string, BalanceBucket>;
}

export interface CreateLinkBody {
  property_id: string;
  programme_id: string;
  offer_id: string;
  placement_id: string;
}

export interface CreateLinkResponse {
  token: string;
  url: string;
}

/* ---------- disputes (v1) ---------- */

export type DisputeKind = 'missing_commission' | 'wrong_amount' | 'unattributed_click' | 'other';
export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'rejected';

export interface Dispute {
  id: string;
  conversion_id: string | null;
  publisher_id: string | null;
  kind: DisputeKind;
  subject: string;
  claim_ref: string | null;
  status: DisputeStatus;
  evidence: unknown;
  resolution_note: string | null;
  created_at: string;
}

export interface OpenDisputeBody {
  kind?: DisputeKind;
  subject: string;
  claim_ref?: string;
  conversion_id?: string;
  /** The filer's publisher (checked against the token's organisation). */
  publisher_id?: string;
  evidence?: Record<string, unknown>;
}

/** Human-readable mapping for POST /v1/links error codes. */
export function linkErrorMessage(code: ApiCode): string {
  switch (code) {
    case 'PROGRAMME_NOT_APPROVED':
      return 'programme not active';
    case 'OFFER_STALE':
      return 'offer expired';
    case 'PROPERTY_FORBIDDEN':
      return 'property not found or not approved for your organisation';
    case 'PUBLISHER_NOT_ACTIVE':
      return 'publisher onboarding incomplete — account must be active';
    case 'NOT_FOUND':
      return 'placement not found';
    case 'VALIDATION_ERROR':
      return 'invalid request — check the selected values';
    case 'UNAUTHORIZED':
      return 'not signed in — add your token first';
    case 'FORBIDDEN':
      return 'your role cannot create links';
    case 'NETWORK_UNREACHABLE':
      return 'API unreachable';
    default:
      return `link creation failed (${code})`;
  }
}

/* ---------- suspense queue ops (v1, operator console) ---------- */

/** The API's reason codes (docs/openapi.yaml SuspenseItem.reason_code; the last four: Amazon.in Associates' tracking IDs). */
export type SuspenseReasonCode =
  | 'CLICK_REF_UNMATCHED'
  | 'NO_CLICK_REF'
  | 'TRACKING_ID_UNMAPPED'
  | 'TRACKING_ID_IS_STORE_DEFAULT'
  | 'TRACKING_ID_MAPPED_AFTER_SALE'
  | 'ATTRIBUTION_CONFLICT';

export interface SuspenseItem {
  id: string;
  programme_id: string;
  programme_name: string;
  provider_account_id: string;
  source_transaction_id: string;
  returned_click_ref: string | null;
  /** The tracking ID the provider reported (Amazon.in Associates); absent from older APIs. */
  returned_tracking_ref?: string | null;
  currency: string;
  eligible_value_minor: number;
  commission_minor: number;
  provider_status: string;
  status: string;
  received_at: string;
  raw: unknown;
  reason_code: SuspenseReasonCode;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
}

export interface SuspenseListResponse {
  items: SuspenseItem[];
  limit: number;
  offset: number;
  total: number;
}

export interface SuspenseRetryResponse {
  id: string;
  attributed: boolean;
  click_id?: string | null;
  placement_id?: string | null;
  reason?: SuspenseReasonCode;
}

export interface SuspenseReviewResponse {
  id: string;
  reviewed_at: string;
  reviewed_by: string;
  review_note: string;
}
