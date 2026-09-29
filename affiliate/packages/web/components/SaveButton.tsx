'use client';

import { useEffect, useState } from 'react';
import { isSaved, toggleSaved, type SavedItem } from '../lib/saved';
import { notifySavedChange } from './shop/savedEvents';
import { cx } from './ui/cx';
import styles from './SaveButton.module.css';

type Props = Omit<SavedItem, 'savedAt'> & {
  /** Full width, label flush left (the phone item page's sticky footer). */
  block?: boolean;
  className?: string;
};

/**
 * Wishlist toggle (localStorage `saved-items`), keyed by look id + item id.
 * A secondary button with aria-pressed: "Save" / "Saved" (accent-100 fill,
 * accent-700 text, like the active nav item). It keeps its place but stays
 * invisible until the browser has read the wishlist, so it never flashes the
 * wrong state; the change is announced politely.
 */
export default function SaveButton({ block = false, className, ...entry }: Props) {
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const name = `${entry.brand} — ${entry.model}`;

  useEffect(() => {
    setSaved(isSaved(entry.lookId, entry.itemId));
    setReady(true);
  }, [entry.lookId, entry.itemId]);

  const toggle = () => {
    const next = toggleSaved(entry);
    setSaved(next);
    notifySavedChange();
    setMessage(next ? `${name} saved for later.` : `${name} removed from saved.`);
  };

  return (
    <>
      <button
        type="button"
        className={cx(styles.button, saved && styles.saved, block && styles.block, !ready && styles.pending, className)}
        onClick={toggle}
        disabled={!ready}
        aria-pressed={saved}
        aria-label={saved ? `Saved: ${name}` : `Save for later: ${name}`}
      >
        {saved ? 'Saved' : 'Save'}
      </button>
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
    </>
  );
}
