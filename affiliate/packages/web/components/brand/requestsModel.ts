/*
 * Creator requests — pure helpers (relative imports only; tested in
 * test/brand-screens.test.ts).
 */

import { formatCount } from '../../lib/format';

/**
 * The empty request list's line. The demo holds a few of the pending
 * requests (3 of the drawn 38); once those are decided, say that the rest
 * are not in the demo data rather than "none waiting" beside a KPI that
 * still counts them.
 */
export function emptyRequestsMessage(pendingCount: number): string {
  if (pendingCount <= 0) return 'No creator requests waiting.';
  return `The demo requests are decided; the other ${formatCount(pendingCount)} are not in the demo data.`;
}
