'use client';

/*
 * Copy-to-clipboard with the handover's feedback rule: the button reads
 * "Copied" for 2s, and a polite live region announces what was copied.
 * The copy itself (with its execCommand fallback) is lib/clipboard.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { COPIED_MS, copyText } from '@/lib/clipboard';

export { COPIED_MS, copyText };

export interface CopyFeedback<K extends string> {
  /** The key copied in the last 2s, or null. */
  copied: K | null;
  /** Text for an aria-live="polite" region ('' when idle). */
  announcement: string;
  /** Copy `text`; `said` is what the live region announces on success. */
  copy: (text: string, key: K, said: string) => Promise<boolean>;
  /** Announce something else (e.g. "QR code downloaded"). */
  announce: (said: string) => void;
}

export function useCopyFeedback<K extends string>(): CopyFeedback<K> {
  const [copied, setCopied] = useState<K | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const announce = useCallback((said: string) => {
    // Clear first so repeating the same message is announced again.
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(said), 30);
  }, []);

  const copy = useCallback(
    async (text: string, key: K, said: string) => {
      const ok = await copyText(text);
      if (timer.current) clearTimeout(timer.current);
      if (ok) {
        setCopied(key);
        announce(said);
        timer.current = setTimeout(() => setCopied(null), COPIED_MS);
      } else {
        setCopied(null);
        announce('Copy failed — select the text and copy it manually.');
      }
      return ok;
    },
    [announce],
  );

  return { copied, announcement, copy, announce };
}
