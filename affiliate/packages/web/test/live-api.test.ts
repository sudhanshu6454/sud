/*
 * The app areas' live calls (lib/api.ts, lib/earnings.ts, lib/idempotency.ts,
 * components/admin/suspenseModel.ts): what is sent, and how an answer the API
 * gave is told apart from an API that could not be reached.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  suspenseQuery,
  suspenseReasonLabel,
  suspenseRefLabel,
  retryBlockedReason,
  EMPTY_SUSPENSE_FILTERS,
  SUSPENSE_REASON_LABELS,
} from '../components/admin/suspenseModel';
import { ApiError, apiFetch, fallbackKind, fallbackNotice, isUnreachable, withDemoFallback } from '../lib/api';
import { MISMATCH_NOTICE, NO_PUBLISHER_NOTICE, PUBLISHER_NOT_FOUND_NOTICE, loadLiveEarnings } from '../lib/earnings';
import { IdempotencyKeys, randomKey } from '../lib/idempotency';
import { formatDayMonthTime } from '../lib/format';

const PUBLISHER = '5942a374-1111-4111-8111-222222222222';

function stubStorage(values: Record<string, string>) {
  vi.stubGlobal('window', {
    localStorage: { getItem: (k: string) => (k in values ? values[k] : null) },
  });
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('sends a JSON content type only with a body (a bodyless POST must reach its handler)', async () => {
    stubStorage({ paparazzi_token: 'tok' });
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        seen.push(init.headers as Record<string, string>);
        return jsonResponse(200, { data: { ok: true }, request_id: 'r' });
      }),
    );
    await apiFetch('/v1/suspense/x/retry', { method: 'POST' });
    await apiFetch('/v1/suspense/x/review', { method: 'POST', body: { note: 'checked the logs' } });
    expect(seen[0]).toEqual({ Authorization: 'Bearer tok' });
    expect(seen[0]).not.toHaveProperty('Content-Type');
    expect(seen[1]).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer tok' });
  });
});

describe('demo fallback: an unreachable API vs an answer', () => {
  it('withDemoFallback hands back the error', async () => {
    const ok = await withDemoFallback(async () => 1, 0);
    expect(ok).toEqual({ value: 1, demo: false, error: null });
    const failed = await withDemoFallback(async () => {
      throw new ApiError('FORBIDDEN', 'Role editor cannot read suspense', 403);
    }, 0);
    expect(failed.value).toBe(0);
    expect(failed.demo).toBe(true);
    expect(failed.error?.status).toBe(403);
    const odd = await withDemoFallback(async () => {
      throw new TypeError('boom');
    }, 0);
    expect(odd.error?.code).toBe('INTERNAL');
  });

  it('says "unreachable" only when the API never answered', () => {
    expect(isUnreachable(new ApiError('NETWORK_UNREACHABLE', 'x', 0))).toBe(true);
    expect(isUnreachable(new ApiError('UPSTREAM_UNAVAILABLE', 'x', 502))).toBe(true);
    for (const [code, status] of [
      ['UNAUTHORIZED', 401],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
      ['VALIDATION_ERROR', 400],
      ['INTERNAL', 500],
    ] as const) {
      expect(isUnreachable(new ApiError(code, 'x', status))).toBe(false);
    }
    expect(fallbackNotice(new ApiError('NETWORK_UNREACHABLE', 'x', 0), 'your earnings')).toBeNull();
  });

  it('names the answer in a Banner', () => {
    expect(fallbackKind(new ApiError('UNAUTHORIZED', 'Invalid or expired token', 401))).toBe('unauthorized');
    const signIn = fallbackNotice(new ApiError('UNAUTHORIZED', 'Invalid or expired token', 401), 'your live earnings');
    expect(signIn?.title).toBe('Sign in to see your live earnings.');
    expect(signIn?.action).toEqual({ href: '/login', label: 'Log in again' });
    const role = fallbackNotice(new ApiError('FORBIDDEN', 'Role publisher_owner cannot do this', 403), 'the suspense queue');
    expect(role?.title).toBe('This account cannot read the suspense queue.');
    expect(role?.message).toContain('Role publisher_owner cannot do this');
    expect(fallbackNotice(new ApiError('INTERNAL', 'x', 500), 'your tickets')?.title).toBe('Your tickets unavailable.');
  });
});

describe('GET /v1/publisher/earnings (Overview and Payouts)', () => {
  const answer = (publisherId: string) => ({ publisher_id: publisherId, balances: { INR: { pending: 1, approved: 2, collected: 3, payable: 0 } } });

  it('sends nothing without a token (the designed demo page, labelled "Demo data")', async () => {
    stubStorage({});
    const fetcher = vi.fn();
    expect(await loadLiveEarnings(fetcher as never)).toEqual({ response: null, unreachable: false, notice: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never sends the demo publisher id: a token without a saved id asks for one', async () => {
    stubStorage({ paparazzi_token: 'tok' });
    const fetcher = vi.fn();
    expect(await loadLiveEarnings(fetcher as never)).toEqual({ response: null, unreachable: false, notice: NO_PUBLISHER_NOTICE });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks for the saved publisher and returns its balances', async () => {
    stubStorage({ paparazzi_token: 'tok', paparazzi_publisher_id: PUBLISHER });
    const fetcher = vi.fn(async () => answer(PUBLISHER));
    const call = await loadLiveEarnings(fetcher as never);
    expect(fetcher).toHaveBeenCalledWith(`/v1/publisher/earnings?publisher_id=${PUBLISHER}`);
    expect(call).toEqual({ response: answer(PUBLISHER), unreachable: false, notice: null });
  });

  it('401 / 403 / 404 are Banners, not "API unreachable"', async () => {
    stubStorage({ paparazzi_token: 'tok', paparazzi_publisher_id: PUBLISHER });
    const failWith = (code: string, status: number) =>
      vi.fn(async () => {
        throw new ApiError(code, 'answered', status);
      });
    const expired = await loadLiveEarnings(failWith('UNAUTHORIZED', 401) as never);
    expect(expired.unreachable).toBe(false);
    expect(expired.notice?.action?.href).toBe('/login');
    const forbidden = await loadLiveEarnings(failWith('FORBIDDEN', 403) as never);
    expect(forbidden.unreachable).toBe(false);
    expect(forbidden.notice?.title).toBe('This account cannot read your live earnings.');
    const otherOrg = await loadLiveEarnings(failWith('NOT_FOUND', 404) as never);
    expect(otherOrg.notice).toBe(PUBLISHER_NOT_FOUND_NOTICE);
    const down = await loadLiveEarnings(failWith('UPSTREAM_UNAVAILABLE', 502) as never);
    expect(down).toEqual({ response: null, unreachable: true, notice: null });
  });

  it('an answer for another publisher is the mismatch Banner (never "unreachable")', async () => {
    stubStorage({ paparazzi_token: 'tok', paparazzi_publisher_id: PUBLISHER });
    const call = await loadLiveEarnings((async () => answer('11111111-1111-4111-8111-111111111111')) as never);
    expect(call).toEqual({ response: null, unreachable: false, notice: MISMATCH_NOTICE });
  });
});

describe('Idempotency-Key per unchanged payload', () => {
  it('reuses the key while the payload is unchanged and forgets it on request', () => {
    const keys = new IdempotencyKeys('dispute');
    const a = keys.keyFor({ subject: 'x', kind: 'other' });
    expect(a).toMatch(/^dispute-[0-9a-f]{32}$/);
    expect(keys.keyFor({ subject: 'x', kind: 'other' })).toBe(a);
    expect(keys.keyFor({ subject: 'y', kind: 'other' })).not.toBe(a);
    keys.forget({ subject: 'x', kind: 'other' });
    expect(keys.keyFor({ subject: 'x', kind: 'other' })).not.toBe(a);
    expect(randomKey()).not.toBe(randomKey());
  });
});

describe('suspense queue (/admin/suspense)', () => {
  it('filters by India calendar day, both bounds inclusive of the whole day', () => {
    const q = suspenseQuery({ ...EMPTY_SUSPENSE_FILTERS, from: '2026-09-29', to: '2026-09-29' });
    const params = new URL(`http://x${q}`).searchParams;
    const from = new Date(params.get('received_from')!);
    const to = new Date(params.get('received_to')!);
    // A row received 2026-09-29 10:56Z (16:26 IST) is inside the one-day window.
    const received = new Date('2026-09-29T10:56:00Z');
    expect(from.getTime()).toBeLessThanOrEqual(received.getTime());
    expect(to.getTime()).toBeGreaterThanOrEqual(received.getTime());
    expect(from.toISOString()).toBe('2026-09-28T18:30:00.000Z');
    expect(to.toISOString()).toBe('2026-09-29T18:29:59.999Z');
    expect(params.get('limit')).toBe('100');
    expect(suspenseQuery(EMPTY_SUSPENSE_FILTERS)).toBe('/v1/suspense?limit=100');
  });

  it('prints dates, reasons and the retry block in the app style', () => {
    expect(formatDayMonthTime('2026-09-21T09:12:00Z')).toBe('21 Sep · 14:42');
    expect(suspenseReasonLabel('CLICK_REF_UNMATCHED')).toBe('Click ref unmatched');
    expect(suspenseReasonLabel('NO_CLICK_REF')).toBe('No click ref');
    expect(suspenseReasonLabel('SOMETHING_NEW')).toBe('Something new');
    expect(retryBlockedReason(null)).toMatch(/No click reference or tracking ID/);
    expect(retryBlockedReason('click-ref-1')).toBe('');
    // Amazon rows carry a tracking ID instead of a click reference: retryable.
    expect(retryBlockedReason(null, 'demo-ig-21')).toBe('');
    expect(suspenseRefLabel({ returned_click_ref: null, returned_tracking_ref: 'demo-ig-21' })).toEqual({ kind: 'tracking ID', value: 'demo-ig-21' });
    expect(suspenseRefLabel({ returned_click_ref: 'c1', returned_tracking_ref: 'demo-ig-21' })).toEqual({ kind: 'ref', value: 'c1' });
    expect(suspenseRefLabel({ returned_click_ref: null })).toEqual({ kind: 'ref', value: null });
  });

  it('labels every reason code the API can send (docs/openapi.yaml SuspenseItem.reason_code), in sentence case', () => {
    const spec = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'openapi.yaml'), 'utf8');
    const m = /reason_code:\s*\n\s*type: string\s*\n\s*enum: \[([^\]]+)\]/.exec(spec);
    expect(m).not.toBeNull();
    const codes = m![1]!.split(',').map((c) => c.trim());
    expect(codes).toHaveLength(6);
    expect(Object.keys(SUSPENSE_REASON_LABELS).sort()).toEqual([...codes].sort());
    expect(suspenseReasonLabel('TRACKING_ID_UNMAPPED')).toBe('Tracking ID not mapped');
    expect(suspenseReasonLabel('TRACKING_ID_IS_STORE_DEFAULT')).toBe('Store ID, no page');
    expect(suspenseReasonLabel('TRACKING_ID_MAPPED_AFTER_SALE')).toBe('Tracking ID mapped after the sale');
    expect(suspenseReasonLabel('ATTRIBUTION_CONFLICT')).toBe('Click and tracking ID disagree');
    for (const label of Object.values(SUSPENSE_REASON_LABELS)) expect(label[0]).toBe(label[0]!.toUpperCase());
  });
});
