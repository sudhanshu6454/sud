/*
 * GET /v1/publisher/earnings → the balances the creator screens print.
 * One mapping for the overview (1c "Next payout") and payouts (2c
 * "Available to withdraw"), so the two never disagree about the same money.
 * The buckets (packages/api/src/routes/earnings.ts), per currency:
 *
 * - pending:   the publisher's share of conversions still awaiting approval.
 * - approved:  the net publisher_liability ledger balance (a paid batch
 *              debits it) — approved and not yet paid, including earnings
 *              the merchant has not paid for and earnings still inside the
 *              returns window.
 * - collected: merchant cash allocated to the publisher's eligible (approved,
 *              past the returns window, unreversed) earnings — a running
 *              total, capped at eligible.
 * - payable:   everything already in a payout batch that has not failed or
 *              been cancelled, paid batches included — a running total.
 *
 * nextBatch = max(collected − payable, 0) is what the next payout batch can
 * still draw: the formula POST /v1/payout-batches sizes a batch with
 * (max(min(eligible, collected) − batched, 0)). Not reflected: the
 * contract's payout threshold, which the response does not carry.
 *
 * A currency with no activity has no bucket and reads as zero. Relative
 * imports only (tested).
 */

import {
  apiFetch,
  fallbackNotice,
  getStoredPublisherId,
  getToken,
  isUnreachable,
  withDemoFallback,
  type EarningsResponse,
  type FallbackNotice,
} from './api';

export interface EarningsBalances {
  pendingMinor: number;
  approvedMinor: number;
  collectedMinor: number;
  payableMinor: number;
  /** max(collected − payable, 0): what the next payout batch can draw. */
  nextBatchMinor: number;
}

function bucketValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function earningsBalances(response: EarningsResponse, currency = 'INR'): EarningsBalances {
  const bucket = response.balances?.[currency];
  const collectedMinor = bucketValue(bucket?.collected);
  const payableMinor = bucketValue(bucket?.payable);
  return {
    pendingMinor: bucketValue(bucket?.pending),
    approvedMinor: bucketValue(bucket?.approved),
    collectedMinor,
    payableMinor,
    nextBatchMinor: Math.max(collectedMinor - payableMinor, 0),
  };
}

/* ---------- the live call, shared by Overview (1c) and Payouts (2c) ---------- */

export interface LiveEarningsCall {
  /** The API's answer for the stored publisher; null → the page shows its designed demo figures. */
  response: EarningsResponse | null;
  /** The call never reached the API (the only case the badge says "API unreachable"). */
  unreachable: boolean;
  /** Why there are no live figures, when the page should say so in a Banner. */
  notice: FallbackNotice | null;
}

const LOGIN_ACTION = { href: '/login', label: 'Sign-in page' } as const;

/** A token but no publisher id: nothing to ask the API for. */
export const NO_PUBLISHER_NOTICE: FallbackNotice = {
  title: 'Add your publisher id to see live earnings.',
  message: 'No publisher id is saved in this browser, so this page shows demo data. Add it on the sign-in page.',
  action: LOGIN_ACTION,
};

/** The API answered for another publisher id than the one asked for. */
export const MISMATCH_NOTICE: FallbackNotice = {
  title: 'Earnings unavailable.',
  message: 'The API answered for a different publisher than this account, so this page shows demo data.',
};

/** 404 from the earnings route: the id is not a publisher of the token's organisation. */
export const PUBLISHER_NOT_FOUND_NOTICE: FallbackNotice = {
  title: 'This publisher id is not in your organisation.',
  message: "The API found no publisher with the saved id in your token's organisation, so this page shows demo data.",
  action: { href: '/login', label: 'Change it on the sign-in page' },
};

type Fetcher = typeof apiFetch;

/**
 * GET /v1/publisher/earnings for the publisher saved by /login or /join.
 * No request at all without a token (a signed-out visitor sees the designed
 * demo page, labelled "Demo data") or without a saved publisher id (a
 * Banner asks for it; the demo id is never sent). An unreachable API is the
 * "API unreachable" badge; any answer the API gave (401, 403, 404, 400, 5xx)
 * is a Banner that names it.
 */
export async function loadLiveEarnings(fetcher: Fetcher = apiFetch): Promise<LiveEarningsCall> {
  if (!getToken()) return { response: null, unreachable: false, notice: null };
  const publisherId = getStoredPublisherId();
  if (!publisherId) return { response: null, unreachable: false, notice: NO_PUBLISHER_NOTICE };
  const { value, error } = await withDemoFallback<EarningsResponse | null>(
    () => fetcher<EarningsResponse>(`/v1/publisher/earnings?publisher_id=${encodeURIComponent(publisherId)}`),
    null,
  );
  if (error || !value) {
    return {
      response: null,
      unreachable: isUnreachable(error),
      notice: fallbackNotice(error, 'your live earnings', { 'not-found': PUBLISHER_NOT_FOUND_NOTICE }),
    };
  }
  if (value.publisher_id !== publisherId) return { response: null, unreachable: false, notice: MISMATCH_NOTICE };
  return { response: value, unreachable: false, notice: null };
}
