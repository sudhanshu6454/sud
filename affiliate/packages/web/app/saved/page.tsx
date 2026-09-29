'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { itemHref, readSaved, removeSaved, type SavedItem } from '../../lib/saved';
import { formatMoney } from '../../lib/format';
import styles from './page.module.css';

/**
 * Wishlist. Entries live in localStorage (`saved-items`) with the look id,
 * item id and display data captured when saved; the price shown is the one
 * at save time, so the page says so and links back to the live item page.
 */
export default function SavedPage() {
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSaved(readSaved());
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <div>
      <h1 className={styles.heading}>Saved</h1>

      {saved.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing saved yet</p>
          <p className={styles.emptyText}>Tap “Save” on any product to keep it here for later.</p>
          <Link href="/" className={styles.cta}>
            Discover looks
          </Link>
        </div>
      ) : (
        <>
          <p className={styles.note}>Prices are as of when you saved them — open the item for the current offer.</p>
          <ul className={styles.list}>
            {saved.map((s) => (
              <li key={`${s.lookId}:${s.itemId}`} className={styles.card}>
                <Link href={itemHref(s.lookId, s.itemId)} className={styles.name}>
                  {s.brand} — {s.model}
                </Link>
                <p className={styles.priceRow}>
                  {s.price_minor !== null && s.currency ? (
                    <span className={styles.price}>{formatMoney(s.price_minor, s.currency)}</span>
                  ) : (
                    <span className={styles.merchant}>No live offer when saved</span>
                  )}
                  {s.merchant && <span className={styles.merchant}>at {s.merchant}</span>}
                </p>
                <p className={styles.lookRef}>From: {s.lookTitle}</p>
                <button type="button" className={styles.remove} onClick={() => setSaved(removeSaved(s.lookId, s.itemId))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
