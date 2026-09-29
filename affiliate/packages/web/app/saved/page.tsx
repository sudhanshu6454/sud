'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getProduct } from '../../lib/mock-data';
import type { Product } from '../../lib/mock-data';
import { formatINR } from '../../lib/format';
import styles from './page.module.css';

const KEY = 'saved-products';

export default function SavedPage() {
  const [saved, setSaved] = useState<Product[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      const ids: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(ids)) {
        setSaved(
          ids
            .filter((x) => typeof x === 'string')
            .map((id) => getProduct(id as string))
            .filter((p): p is Product => p !== undefined),
        );
      }
    } catch {
      setSaved([]);
    }
    setReady(true);
  }, []);

  const remove = (id: string) => {
    try {
      const raw = localStorage.getItem(KEY);
      const ids: unknown = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(ids)
        ? ids.filter((x) => x !== id)
        : [];
      localStorage.setItem(KEY, JSON.stringify(next));
      setSaved((prev) => prev.filter((p) => p.id !== id));
    } catch {
      /* ignore */
    }
  };

  if (!ready) return null;

  return (
    <div>
      <h1 className={styles.heading}>Saved</h1>

      {saved.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Nothing saved yet</p>
          <p className={styles.emptyText}>
            Tap “Save” on any product to keep it here for later.
          </p>
          <Link href="/" className={styles.cta}>
            Discover looks
          </Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {saved.map((p) => (
            <li key={p.id} className={styles.card}>
              <Link href={`/products/${p.id}`} className={styles.name}>
                {p.brand} — {p.model}
              </Link>
              <p className={styles.priceRow}>
                <span className={styles.price}>{formatINR(p.price_minor)}</span>
                <span className={styles.merchant}>at {p.merchant}</span>
              </p>
              <button
                type="button"
                className={styles.remove}
                onClick={() => remove(p.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
