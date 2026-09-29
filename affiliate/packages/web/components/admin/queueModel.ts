/*
 * Review-queue model for the admin console (2e) and the pages that review
 * the same items (/admin/offers, /admin/fraud, /admin/creators, the brand
 * status on /admin/brands). Pure: no React, no '@/' imports (the root
 * vitest config has no alias), storage injected.
 *
 * Decisions are TEST demo decisions kept in this browser (localStorage
 * QUEUE_STORAGE_KEY). No v1 endpoint serves the queue or takes a decision;
 * nothing is sent anywhere.
 */

import type { ReviewType } from '../../lib/demo/afflino';

export type QueueFilter = 'all' | ReviewType;
export type Decision = 'approved' | 'rejected' | 'info_requested';

export interface DecisionRecord {
  decision: Decision;
  /** Reviewer's note (required to reject). */
  note: string;
  /** ISO timestamp. */
  decidedAt: string;
}

export type Decisions = Readonly<Record<string, DecisionRecord>>;

export interface QueueState {
  filter: QueueFilter;
  decisions: Decisions;
}

export type QueueAction =
  | { type: 'filter'; filter: QueueFilter }
  | { type: 'decide'; id: string; decision: Decision; note: string; at: string }
  | { type: 'reopen'; id: string }
  | { type: 'hydrate'; decisions: Decisions };

export interface QueueItemLike {
  id: string;
  type: ReviewType;
}

export const QUEUE_FILTERS: ReadonlyArray<{ value: QueueFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'Offer', label: 'Offers' },
  { value: 'KYC', label: 'KYC' },
  { value: 'Fraud', label: 'Fraud' },
];

export const DECISIONS: ReadonlyArray<Decision> = ['approved', 'rejected', 'info_requested'];

/** Row status after a decision ("Approved", "Rejected", "Info requested"). */
export const DECISION_LABEL: Record<Decision, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  info_requested: 'Info requested',
};

/** Past-tense line for the aria-live announcement. */
export const DECISION_VERB: Record<Decision, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  info_requested: 'Info requested for',
};

export const NOTE_MAX_LENGTH = 500;

export function initialQueueState(filter: QueueFilter = 'all'): QueueState {
  return { filter, decisions: {} };
}

/**
 * A decision's note rule: rejecting needs a note (the design's mandatory
 * rejection note); any note is at most NOTE_MAX_LENGTH characters.
 */
export function validateDecision(decision: Decision, note: string): { ok: true } | { ok: false; message: string } {
  const trimmed = note.trim();
  if (decision === 'rejected' && trimmed === '') {
    return { ok: false, message: 'Add a note to reject: say why, so the subject can act on it.' };
  }
  if (trimmed.length > NOTE_MAX_LENGTH) {
    return { ok: false, message: `Keep the note under ${NOTE_MAX_LENGTH} characters.` };
  }
  return { ok: true };
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'filter':
      return state.filter === action.filter ? state : { ...state, filter: action.filter };
    case 'decide': {
      // An invalid decision (a rejection without a note) never lands; the
      // panel shows the validation message instead.
      if (!validateDecision(action.decision, action.note).ok) return state;
      return {
        ...state,
        decisions: {
          ...state.decisions,
          [action.id]: { decision: action.decision, note: action.note.trim(), decidedAt: action.at },
        },
      };
    }
    case 'reopen': {
      if (!(action.id in state.decisions)) return state;
      const next = { ...state.decisions };
      delete next[action.id];
      return { ...state, decisions: next };
    }
    case 'hydrate':
      return { ...state, decisions: { ...action.decisions } };
    default:
      return state;
  }
}

/** Items the filter shows, in their original order. */
export function visibleItems<T extends QueueItemLike>(items: ReadonlyArray<T>, filter: QueueFilter): ReadonlyArray<T> {
  return filter === 'all' ? items : items.filter((i) => i.type === filter);
}

/** A decision that takes the item out of the queue (approve / reject). "Info requested" keeps it open. */
export function isClosed(record: DecisionRecord | undefined): boolean {
  return record !== undefined && record.decision !== 'info_requested';
}

/**
 * Open items per filter: the queue's totals (2e: 212 / 14 / 76 / 122) minus
 * the sample items this browser has approved or rejected. Never below 0.
 */
export function queueCounts(
  totals: Readonly<Record<QueueFilter, number>>,
  items: ReadonlyArray<QueueItemLike>,
  decisions: Decisions,
): Record<QueueFilter, number> {
  const closed: Record<ReviewType, number> = { Offer: 0, KYC: 0, Fraud: 0 };
  for (const item of items) if (isClosed(decisions[item.id])) closed[item.type] += 1;
  const offer = Math.max(0, totals.Offer - closed.Offer);
  const kyc = Math.max(0, totals.KYC - closed.KYC);
  const fraud = Math.max(0, totals.Fraud - closed.Fraud);
  const closedAll = closed.Offer + closed.KYC + closed.Fraud;
  return { all: Math.max(0, totals.all - closedAll), Offer: offer, KYC: kyc, Fraud: fraud };
}

/** "All · 212" */
export function filterLabel(filter: QueueFilter, count: string): string {
  const label = QUEUE_FILTERS.find((f) => f.value === filter)?.label ?? filter;
  return `${label} · ${count}`;
}

/* ---------- storage ---------- */

export const QUEUE_STORAGE_KEY = 'afflino_admin_review_v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && (DECISIONS as ReadonlyArray<string>).includes(value);
}

/** Parse stored decisions, dropping anything malformed (a hand-edited or older value). */
export function parseDecisions(raw: string | null): Decisions {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out: Record<string, DecisionRecord> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (!isDecision(v.decision)) continue;
    const note = typeof v.note === 'string' ? v.note : '';
    if (!validateDecision(v.decision, note).ok) continue;
    out[id] = { decision: v.decision, note, decidedAt: typeof v.decidedAt === 'string' ? v.decidedAt : '' };
  }
  return out;
}

export function loadDecisions(storage: StorageLike | null | undefined): Decisions {
  if (!storage) return {};
  try {
    return parseDecisions(storage.getItem(QUEUE_STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Returns false when the browser refused the write (private mode, blocked site data). */
export function saveDecisions(storage: StorageLike | null | undefined, decisions: Decisions): boolean {
  if (!storage) return false;
  try {
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(decisions));
    return true;
  } catch {
    return false;
  }
}
