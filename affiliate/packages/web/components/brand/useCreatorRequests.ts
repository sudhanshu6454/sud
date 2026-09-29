'use client';

/*
 * Creator requests (2b, 3f, /brand/creators): the pending list and the
 * brand's Approve / Decline decisions, kept in this browser per workspace.
 * TEST demo data — no creator is notified. The KPI counts follow the
 * decisions: pending = 38 − decided, active creators = 642 + approved.
 */

import { useCallback, useMemo } from 'react';
import { DEMO_CREATOR_REQUESTS, PLATFORM_SHORT, type DemoCreatorRequest } from '@/lib/demo/afflino';
import { DEMO_BRAND_SUMMARY } from '@/lib/demo/brand';
import { formatCountCompact } from '@/lib/format';
import { STORAGE_KEYS, usePartition } from './storage';

export type RequestDecision = 'approved' | 'declined';

export function requestReach(r: DemoCreatorRequest): string {
  return `${formatCountCompact(r.reach)} · ${PLATFORM_SHORT[r.platform]}`;
}

export function useCreatorRequests(workspaceKey: string) {
  const { value: decisions, ready, update } = usePartition<Record<string, RequestDecision>>(
    STORAGE_KEYS.requests,
    workspaceKey,
    {},
  );

  const pending = useMemo(() => DEMO_CREATOR_REQUESTS.filter((r) => decisions[r.name] === undefined), [decisions]);
  const approved = useMemo(() => DEMO_CREATOR_REQUESTS.filter((r) => decisions[r.name] === 'approved'), [decisions]);
  const decidedCount = DEMO_CREATOR_REQUESTS.length - pending.length;

  const decide = useCallback(
    (name: string, decision: RequestDecision) => update((prev) => ({ ...prev, [name]: decision })),
    [update],
  );

  const reset = useCallback(() => update({}), [update]);

  return {
    ready,
    pending,
    approved,
    decisions,
    pendingCount: Math.max(0, DEMO_BRAND_SUMMARY.pendingRequests - decidedCount),
    activeCreators: DEMO_BRAND_SUMMARY.activeCreators + approved.length,
    approve: (name: string) => decide(name, 'approved'),
    decline: (name: string) => decide(name, 'declined'),
    reset,
  };
}
