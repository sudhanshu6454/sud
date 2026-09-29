'use client';

/*
 * Keeps the "Saved · n" count in the shop nav in step with the wishlist.
 * lib/saved.ts (localStorage `saved-items`) has no change notification, so
 * the shop's writers (SaveButton, the /saved page's Remove) call
 * notifySavedChange() after each write; other tabs are covered by the
 * browser's own `storage` event.
 */

import { useEffect, useState } from 'react';
import { readSaved, SAVED_KEY } from '../../lib/saved';

export const SAVED_CHANGE_EVENT = 'afflino:saved-items-change';

export function notifySavedChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SAVED_CHANGE_EVENT));
}

/** Number of saved items; null until read in the browser (render nothing for it until then). */
export function useSavedCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const update = () => setCount(readSaved().length);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SAVED_KEY) update();
    };
    update();
    window.addEventListener(SAVED_CHANGE_EVENT, update);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SAVED_CHANGE_EVENT, update);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return count;
}
