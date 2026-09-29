'use client';

import { useEffect, useState } from 'react';
import { isSaved, toggleSaved, type SavedItem } from '../lib/saved';
import styles from './SaveButton.module.css';

type Props = Omit<SavedItem, 'savedAt'>;

/** Wishlist toggle (localStorage `saved-items`); keyed by look id + item id. */
export default function SaveButton(entry: Props) {
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSaved(isSaved(entry.lookId, entry.itemId));
    setReady(true);
  }, [entry.lookId, entry.itemId]);

  if (!ready) return null;

  return (
    <button
      type="button"
      className={`${styles.button} ${saved ? styles.saved : ''}`}
      onClick={() => setSaved(toggleSaved(entry))}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved' : 'Save for later'}
    >
      {saved ? 'Saved ✓' : 'Save'}
    </button>
  );
}
