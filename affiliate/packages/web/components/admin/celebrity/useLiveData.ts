'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, apiFetch, fallbackNotice, getToken, isUnreachable, withDemoFallback, type FallbackNotice } from '@/lib/api';

/** Why a screen shows demo data (null: live). */
export type DemoCause = 'signed-out' | 'unreachable' | 'answered' | null;

export interface LiveData<T> {
  value: T;
  demo: boolean;
  cause: DemoCause;
  notice: FallbackNotice | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * One live GET for an admin screen, the suspense queue's pattern: signed out
 * (no dev token) → the TEST demo value and no call; the API unreachable →
 * the demo value with "Demo data — API unreachable"; an answer the API gave
 * (401 / 403 / 404 / 5xx) → the demo value with a Banner naming it. Only the
 * newest load writes the state.
 */
export function useLiveData<T>(path: string | null, demo: T, what: string): LiveData<T> {
  const [state, setState] = useState<Omit<LiveData<T>, 'reload'>>({ value: demo, demo: true, cause: null, notice: null, loading: true });
  const request = useRef(0);
  const demoRef = useRef(demo);
  demoRef.current = demo;
  const reload = useCallback(async () => {
    const id = ++request.current;
    if (!path) return;
    if (!getToken()) {
      setState({ value: demoRef.current, demo: true, cause: 'signed-out', notice: null, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const r = await withDemoFallback(() => apiFetch<T>(path), demoRef.current);
    if (id !== request.current) return;
    setState({
      value: r.value,
      demo: r.demo,
      cause: r.demo ? (isUnreachable(r.error) ? 'unreachable' : 'answered') : null,
      notice: r.demo ? fallbackNotice(r.error, what) : null,
      loading: false,
    });
  }, [path, what]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { ...state, reload };
}

/** The role in the dev token (display only: the API decides what the role may do). */
export function tokenRole(): string | null {
  const t = getToken();
  const part = t?.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

export type SendResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; body: Record<string, unknown> | null };

/**
 * A POST to the v1 API through the same-origin proxy with the dev token, an
 * Idempotency-Key where the route takes one. Unlike apiFetch it hands back
 * the whole error body, because some refusals carry the reasons (the
 * publish gate's report on a 409, the library file's problems on a 422).
 */
export async function send<T>(path: string, body: unknown, idempotencyKey?: string): Promise<SendResult<T>> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK_UNREACHABLE', message: 'The API could not be reached.', body: null };
  }
  const parsed = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string } } & Record<string, unknown> | null;
  if (!res.ok || !parsed || parsed.data === undefined) {
    return {
      ok: false,
      status: res.status,
      code: parsed?.error?.code ?? 'INTERNAL',
      message: parsed?.error?.message ?? `The API answered HTTP ${res.status}.`,
      body: parsed,
    };
  }
  return { ok: true, data: parsed.data };
}
