'use client';

/*
 * localStorage for the brand demo (drafts, submitted offers, creator-request
 * and conversion decisions, settings). Each key holds one object partitioned by workspace
 * ("own" or an agency client id). Every access is guarded: storage can be
 * missing or throw (private mode, blocked site data), and the pages then
 * work from the demo seed without persisting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export const STORAGE_KEYS = {
  offers: 'afflino_brand_offers_v1',
  requests: 'afflino_brand_requests_v1',
  conversions: 'afflino_brand_conversions_v1',
  settings: 'afflino_brand_settings_v1',
} as const;

type Partitioned<T> = Record<string, T>;

function readAll<T>(key: string): Partitioned<T> {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partitioned<T>) : {};
  } catch {
    return {};
  }
}

export function readPartition<T>(key: string, workspace: string): T | undefined {
  if (typeof window === 'undefined') return undefined;
  return readAll<T>(key)[workspace];
}

/** Returns false when the browser refused the write. */
export function writePartition<T>(key: string, workspace: string, value: T): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const all = readAll<T>(key);
    all[workspace] = value;
    window.localStorage.setItem(key, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/**
 * State backed by one workspace partition. `ready` is false until the
 * browser value has been read (SSR and first paint use `initial`), so pages
 * can show skeletons / "—" instead of a number that is about to change.
 */
export function usePartition<T>(key: string, workspace: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  // `initial` is a fresh object per render; only the partition identity re-reads.
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    const stored = readPartition<T>(key, workspace);
    setValue(stored === undefined ? initialRef.current : stored);
    setReady(true);
  }, [key, workspace]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        writePartition(key, workspace, resolved);
        return resolved;
      });
    },
    [key, workspace],
  );

  return { value, ready, update } as const;
}
