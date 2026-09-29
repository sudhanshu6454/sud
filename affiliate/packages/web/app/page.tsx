'use client';

import { useMemo, useState } from 'react';
import LookCard from '../components/LookCard';
import { looks, getProductsForLook } from '../lib/mock-data';
import styles from './page.module.css';

const CATEGORIES = ['Fashion', 'Footwear', 'Bags', 'Accessories'];
const BUDGETS = ['Under ₹1k', '₹1k–₹5k', '₹5k+'];

export default function HomePage() {
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return looks;
    return looks.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.sourcePage.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div>
      <h1 className={styles.heading}>Shop the looks</h1>
      <p className={styles.sub}>
        Spotted on your favourite pages — shop exact matches and similar styles.
      </p>

      {/* Search — local filter over mock data (no API wiring yet) */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search looks, pages, categories…"
        className={styles.search}
        aria-label="Search looks"
      />

      <div className={styles.chipRow} aria-label="Categories">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className={styles.chip} title="Category filter — stub">
            {c}
          </button>
        ))}
      </div>

      <div className={styles.chipRow} aria-label="Budget filters">
        {BUDGETS.map((b) => (
          <button key={b} type="button" className={styles.chip} title="Budget filter — visual only">
            {b}
          </button>
        ))}
      </div>

      <h2 className={styles.sectionTitle}>Curated looks</h2>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No looks match</p>
          <p className={styles.emptyText}>Try clearing filters or search terms.</p>
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => setQuery('')}
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((look) => (
            <LookCard
              key={look.id}
              look={look}
              productCount={getProductsForLook(look).length}
            />
          ))}
        </div>
      )}
    </div>
  );
}
