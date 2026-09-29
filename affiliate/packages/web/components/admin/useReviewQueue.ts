'use client';

/*
 * The review queue's state in a page: the filter (per page) and the demo
 * decisions (this browser, shared by every admin page through
 * localStorage). `ready` is false until the stored decisions are read, so
 * rows show a skeleton action instead of a "Review" button that is about to
 * turn into a status.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  DECISION_VERB,
  initialQueueState,
  loadDecisions,
  queueReducer,
  saveDecisions,
  validateDecision,
  type Decision,
  type QueueFilter,
} from './queueModel';

function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export interface DecideResult {
  ok: boolean;
  message?: string;
}

export function useReviewQueue(initialFilter: QueueFilter = 'all') {
  const [state, dispatch] = useReducer(queueReducer, initialFilter, initialQueueState);
  const [ready, setReady] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  // Only a decision or a reopen writes storage: saving on mount would
  // overwrite the stored decisions with the empty initial state (and in
  // development React runs mount effects twice).
  const dirty = useRef(false);

  useEffect(() => {
    dispatch({ type: 'hydrate', decisions: loadDecisions(browserStorage()) });
    setReady(true);
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    setSaveFailed(!saveDecisions(browserStorage(), state.decisions));
  }, [state.decisions]);

  const setFilter = useCallback((filter: QueueFilter) => dispatch({ type: 'filter', filter }), []);

  const decide = useCallback((id: string, subject: string, decision: Decision, note: string): DecideResult => {
    const check = validateDecision(decision, note);
    if (!check.ok) return { ok: false, message: check.message };
    dirty.current = true;
    dispatch({ type: 'decide', id, decision, note, at: new Date().toISOString() });
    setAnnouncement(`${DECISION_VERB[decision]}: ${subject}.`);
    return { ok: true };
  }, []);

  const reopen = useCallback((id: string, subject: string) => {
    dirty.current = true;
    dispatch({ type: 'reopen', id });
    setAnnouncement(`Reopened: ${subject}.`);
  }, []);

  return { ...state, ready, announcement, saveFailed, setFilter, decide, reopen };
}

export type ReviewQueue = ReturnType<typeof useReviewQueue>;
