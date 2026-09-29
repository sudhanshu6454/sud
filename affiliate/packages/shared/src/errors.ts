/**
 * Canonical error codes shared across the platform.
 * Every API error body uses one of these codes so clients can
 * branch on `error.code` without parsing messages.
 */
export const ERROR_CODES = [
  'PROGRAMME_NOT_APPROVED',
  'OFFER_STALE',
  'PROPERTY_FORBIDDEN',
  'PUBLISHER_NOT_ACTIVE',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CONFLICT',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'LEDGER_IMBALANCE',
  'TRANSFER_STATUS_UNKNOWN',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Wire shape of every API error response. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
  request_id: string;
}

export function apiError(code: ErrorCode, message: string, request_id: string): ApiErrorBody {
  return { error: { code, message }, request_id };
}

/**
 * Throw this from service code. The API layer maps `code` to a stable
 * HTTP status via `status`; uncaught errors become INTERNAL.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}
