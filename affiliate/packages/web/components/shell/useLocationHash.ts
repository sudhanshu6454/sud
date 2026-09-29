'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The current location.hash ('' on the server and before hydration). Next's
 * router changes the hash with pushState, which fires no hashchange, so
 * callers also call the returned setter from their link clicks.
 */
export function useLocationHash(): [string, (hash: string) => void] {
  const [hash, setHash] = useState('');
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    return () => {
      window.removeEventListener('hashchange', read);
      window.removeEventListener('popstate', read);
    };
  }, []);
  const set = useCallback((next: string) => setHash(next), []);
  return [hash, set];
}
