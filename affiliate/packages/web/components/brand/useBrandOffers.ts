'use client';

/*
 * The brand's offers: the TEST seed (lib/demo/brand.ts) plus the builder's
 * drafts and submissions, kept in this browser per workspace. No v1
 * endpoint exists for brand offers, so nothing here reaches the API or the
 * admin queue; "In review" is a local status. Status changes on seed rows
 * (pause, end …) are stored as overrides so they survive a reload.
 */

import { useCallback, useMemo } from 'react';
import { DEMO_BRAND_OFFERS, type BrandOfferStatus, type DemoBrandOffer } from '@/lib/demo/brand';
import { formToRow, nextStatus, type OfferAction, type OfferForm } from './offerModel';
import { STORAGE_KEYS, usePartition } from './storage';

export interface LocalOffer {
  id: string;
  form: OfferForm;
  status: BrandOfferStatus;
  /** YYYY-MM-DD */
  updated: string;
  /** ISO timestamp of the last save. */
  savedAt: string;
}

interface OffersPartition {
  local: LocalOffer[];
  overrides: Record<string, { status: BrandOfferStatus; updated: string }>;
  deleted: string[];
}

const EMPTY: OffersPartition = { local: [], overrides: {}, deleted: [] };

export interface OfferRow extends DemoBrandOffer {
  /** 'local' rows were made in this browser with the builder. */
  source: 'seed' | 'local';
}

/** Today as YYYY-MM-DD in India time. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

function newId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `local-offer-${rand}`;
}

function normalise(p: OffersPartition | undefined): OffersPartition {
  return {
    local: Array.isArray(p?.local) ? p!.local : [],
    overrides: p?.overrides && typeof p.overrides === 'object' ? p.overrides : {},
    deleted: Array.isArray(p?.deleted) ? p!.deleted : [],
  };
}

export function useBrandOffers(workspaceKey: string) {
  const { value, ready, update } = usePartition<OffersPartition>(STORAGE_KEYS.offers, workspaceKey, EMPTY);
  const data = normalise(value);

  const rows: OfferRow[] = useMemo(() => {
    const local = [...data.local]
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
      .map((o) => ({ ...formToRow(o.id, o.form, o.status, o.updated), source: 'local' as const }));
    const seeds = DEMO_BRAND_OFFERS.filter((o) => !data.deleted.includes(o.id)).map((o) => {
      const override = data.overrides[o.id];
      return { ...o, ...(override ?? {}), source: 'seed' as const };
    });
    return [...local, ...seeds];
  }, [data.local, data.overrides, data.deleted]);

  const getLocal = useCallback((id: string) => data.local.find((o) => o.id === id), [data.local]);

  /** Save the form as `status` (a new record when id is absent or unknown). Returns the record id. */
  const save = useCallback(
    (form: OfferForm, status: BrandOfferStatus, id?: string): string => {
      const recordId = id && id.startsWith('local-offer-') ? id : newId();
      const now = new Date();
      const record: LocalOffer = { id: recordId, form, status, updated: todayIso(now), savedAt: now.toISOString() };
      update((prev) => {
        const p = normalise(prev);
        const exists = p.local.some((o) => o.id === recordId);
        // Editing a seed row (a draft or a rejected demo offer) replaces it with the local record.
        const deleted = id && !id.startsWith('local-offer-') && !p.deleted.includes(id) ? [...p.deleted, id] : p.deleted;
        return {
          ...p,
          deleted,
          local: exists ? p.local.map((o) => (o.id === recordId ? record : o)) : [record, ...p.local],
        };
      });
      return recordId;
    },
    [update],
  );

  /** Apply a status action (pause, resume, end, withdraw). Returns the new status, or null if not allowed. */
  const act = useCallback(
    (row: OfferRow, action: OfferAction): BrandOfferStatus | null => {
      const to = nextStatus(row.status, action);
      if (!to) return null;
      const updated = todayIso();
      update((prev) => {
        const p = normalise(prev);
        if (row.source === 'local') {
          return { ...p, local: p.local.map((o) => (o.id === row.id ? { ...o, status: to, updated } : o)) };
        }
        return { ...p, overrides: { ...p.overrides, [row.id]: { status: to, updated } } };
      });
      return to;
    },
    [update],
  );

  const remove = useCallback(
    (row: OfferRow) => {
      update((prev) => {
        const p = normalise(prev);
        if (row.source === 'local') return { ...p, local: p.local.filter((o) => o.id !== row.id) };
        return { ...p, deleted: p.deleted.includes(row.id) ? p.deleted : [...p.deleted, row.id] };
      });
    },
    [update],
  );

  /** Put the seed rows back and drop this browser's drafts and submissions. */
  const reset = useCallback(() => update(EMPTY), [update]);

  return { ready, rows, getLocal, save, act, remove, reset };
}
