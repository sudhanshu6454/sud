'use client';

/*
 * Demo "Apply" flow for offers that need brand approval (1d). There is no
 * applications endpoint in v1, so an application is recorded only in this
 * browser (localStorage `afflino_demo_applications`) and never reaches a
 * brand; the screens label it as a demo. An applied offer's link shows the
 * status "Review" (design README, 1d).
 */

import { useCallback, useSyncExternalStore } from 'react';

export const APPLICATIONS_KEY = 'afflino_demo_applications';

export interface DemoApplication {
  offerId: string;
  /** ISO timestamp. */
  appliedAt: string;
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: ReadonlyArray<DemoApplication> } = { raw: null, value: [] };
const EMPTY: ReadonlyArray<DemoApplication> = [];
/** Used when localStorage refuses writes (private mode, blocked site data): this page view only. */
let memory: ReadonlyArray<DemoApplication> | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(APPLICATIONS_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): ReadonlyArray<DemoApplication> {
  if (!raw) return EMPTY;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return EMPTY;
    return data.filter(
      (a): a is DemoApplication =>
        typeof a === 'object' && a !== null && typeof a.offerId === 'string' && typeof a.appliedAt === 'string',
    );
  } catch {
    return EMPTY;
  }
}

function snapshot(): ReadonlyArray<DemoApplication> {
  if (memory) return memory;
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === APPLICATIONS_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Record an application in this browser (in memory for this page view when storage is blocked). */
export function recordApplication(offerId: string): void {
  const current = snapshot();
  if (current.some((a) => a.offerId === offerId)) return;
  const next = [...current, { offerId, appliedAt: new Date().toISOString() }];
  try {
    window.localStorage.setItem(APPLICATIONS_KEY, JSON.stringify(next));
  } catch {
    memory = next;
  }
  listeners.forEach((l) => l());
}

export function useDemoApplications(): {
  applications: ReadonlyArray<DemoApplication>;
  hasApplied: (offerId: string) => boolean;
  apply: (offerId: string) => void;
} {
  const applications = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const hasApplied = useCallback((offerId: string) => applications.some((a) => a.offerId === offerId), [applications]);
  return { applications, hasApplied, apply: recordApplication };
}
