'use client';

import type { FocusEvent, ReactNode } from 'react';

/**
 * The "Similar styles" row. On phones it scrolls sideways: a product that
 * takes keyboard focus is scrolled into view, so its focused "Buy on
 * Amazon.in" (and its focus ring) is never cut off at the screen's edge.
 */
export function SimilarRow({ className, children }: { className?: string; children: ReactNode }) {
  const onFocus = (e: FocusEvent<HTMLUListElement>) => {
    const li = (e.target as HTMLElement).closest('li');
    if (li && typeof li.scrollIntoView === 'function') li.scrollIntoView({ inline: 'start', block: 'nearest' });
  };
  return (
    <ul className={className} onFocus={onFocus}>
      {children}
    </ul>
  );
}
