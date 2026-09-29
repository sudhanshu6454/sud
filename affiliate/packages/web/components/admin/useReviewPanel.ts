'use client';

/*
 * Which queue item's review panel is open, and the hand-off after a
 * decision: the panel closes and focus goes to the row's new "View" button
 * (the "Review" button that opened the panel no longer exists).
 */

import { useCallback, useEffect, useState } from 'react';
import type { AdminReviewItem } from '@/lib/demo/admin';
import type { Decision } from './queueModel';
import type { ReviewQueue } from './useReviewQueue';

export function useReviewPanel(queue: ReviewQueue) {
  const [item, setItem] = useState<AdminReviewItem | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const open = useCallback((next: AdminReviewItem) => setItem(next), []);
  const close = useCallback(() => setItem(null), []);

  // After the decision renders, focus the row's action ([data-review-action],
  // the visible one of the desktop table / phone list).
  useEffect(() => {
    if (!focusId) return;
    const targets = Array.from(document.querySelectorAll<HTMLElement>(`[data-review-action="${CSS.escape(focusId)}"]`));
    const target = targets.find((el) => el.offsetParent !== null);
    // The row can leave a filtered list (a brand in review becomes Active):
    // then focus the page's main region rather than losing focus to <body>.
    if (target) target.focus();
    else document.getElementById('main')?.focus();
    setFocusId(null);
  }, [focusId]);

  const onDecide = useCallback(
    (target: AdminReviewItem, decision: Decision, note: string) => {
      const result = queue.decide(target.id, target.subject, decision, note);
      if (result.ok) {
        setItem(null);
        setFocusId(target.id);
      }
      return result;
    },
    [queue],
  );

  const onReopen = useCallback((target: AdminReviewItem) => queue.reopen(target.id, target.subject), [queue]);

  return {
    item,
    record: item ? queue.decisions[item.id] : undefined,
    open,
    close,
    onDecide,
    onReopen,
  };
}
