/**
 * Typed fetch client for the Paparazzi v1 API.
 *
 * - Base URL comes from NEXT_PUBLIC_API_BASE (default http://localhost:3000).
 * - Auth: `Authorization: Bearer <token>` where the token is read from
 *   localStorage key `paparazzi_token`. Portal pages call apiFetch(); if the
 *   API is unreachable (or returns a non-OK status) callers fall back to the
 *   clearly-labelled demo data in lib/portal-demo.ts and render <DemoBadge />.
 *
 * Known API surface (packages/api):
 *   success envelope: { data, request_id }
 *   error envelope:   { error: { code, message }, request_id }
 *   GET  /v1/publisher/earnings?publisher_id=<uuid> -> { publisher_id, balances }
 *   POST /v1/links {property_id, programme_id, offer_id, placement_id} -> { token, url }
 *   GET  /v1/disputes -> Dispute[] ; POST /v1/disputes {kind, subject, claim_ref?} -> Dispute
 *   POST /v1/programmes/:id/pause|resume (network_admin) -> kill switch
 *   GET  /v1/suspense?connector=&programme_id=&received_from=&received_to=&reviewed=&limit=&offset=
 *        -> { items: SuspenseItem[], limit, offset, total } (finance_operator, finance_approver, network_admin)
 *   POST /v1/suspense/:id/retry -> { id, attributed, click_id?, reason? }
 *   POST /v1/suspense/:id/review {note} -> { id, reviewed_at, reviewed_by, review_note }
 *
 * Do NOT depend on un-documented endpoints from here; keep using the demo
 * fallback until the API ships them.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/+$/, '') || 'http://localhost:3000';

export const TOKEN_KEY = 'paparazzi_token';
export const PUBLISHER_ID_KEY = 'paparazzi_publisher_id';

/** Used when no publisher id is stored; the earnings endpoint needs a uuid. */
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

export function getPublisherId(): string {
  return readLocal(PUBLISHER_ID_KEY) || DEMO_PUBLISHER_ID;
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
        'Content-Type': 'application/json',
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

/**
 * Run a live request; on any failure (network or API error) return the demo
 * value instead. The `demo: true` flag tells the caller to render <DemoBadge />.
 */
export async function withDemoFallback<T>(
  live: () => Promise<T>,
  demo: T,
): Promise<{ value: T; demo: boolean }> {
  try {
    return { value: await live(), demo: false };
  } catch {
    return { value: demo, demo: true };
  }
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
      return 'property not approved';
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

export type SuspenseReasonCode = 'CLICK_REF_UNMATCHED' | 'NO_CLICK_REF';

export interface SuspenseItem {
  id: string;
  programme_id: string;
  programme_name: string;
  provider_account_id: string;
  source_transaction_id: string;
  returned_click_ref: string | null;
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
  click_id?: string;
  reason?: SuspenseReasonCode;
}

export interface SuspenseReviewResponse {
  id: string;
  reviewed_at: string;
  reviewed_by: string;
  review_note: string;
}
