'use client';

import { useState } from 'react';
import { COPIED_MS, copyText } from '../../lib/clipboard';
import { CELEBRITY_WEB } from '../../lib/site-copy';
import { Button } from '../ui/Button';

/**
 * Share a storefront's own address (afflino.com/s/<slug>): the phone's share
 * sheet where there is one, else copy the link. A secondary block button
 * under the looks (the page is the visitor's, not a share page). Only the page URL — never a
 * tracked /r/ link, never a merchant URL (messages carry afflino.com pages
 * only).
 */
export function ShareButton({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : null;
    if (nav?.share) {
      try {
        await nav.share({ title, url });
        return;
      } catch {
        // cancelled or refused: fall back to copying
      }
    }
    if (await copyText(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_MS);
    }
  }
  return (
    <Button variant="secondary" block flush touch onClick={share} aria-live="polite">
      {copied ? CELEBRITY_WEB.copied : CELEBRITY_WEB.share}
    </Button>
  );
}
