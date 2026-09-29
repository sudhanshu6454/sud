'use client';

import { useMemo, useState } from 'react';
import LookCard from './LookCard';
import type { LookSummary } from '../lib/types';
import styles from './LookGrid.module.css';

/**
 * Client half of the home page: search box, category chips, grid and the
 * empty state. Receives the already-loaded looks from the server component
 * (app/page.tsx) — it never calls the API itself.
 */
export default function LookGrid({ looks }: { looks: LookSummary[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of looks) {
      if (l.category) seen.set(l.category.toLowerCase(), l.category);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [looks]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return looks.filter((l) => {
      if (category && (l.category ?? '').toLowerCase() !== category.toLowerCase()) return false;
      if (!q) return true;
      return (
        l.title.toLowerCase().includes(q) ||
        (l.sourcePage ?? '').toLowerCase().includes(q) ||
        (l.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [looks, query, category]);

  const clear = () => {
    setQuery('');
    setCategory(null);
  };

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search looks, pages, categories…"
        className={styles.search}
        aria-label="Search looks"
      />

      {categories.length > 0 && (
        <div className={styles.chipRow} role="group" aria-label="Categories">
          {categories.map((c) => {
            const active = category !== null && category.toLowerCase() === c.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                aria-pressed={active}
                onClick={() => setCategory(active ? null : c)}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}

      <h2 className={styles.sectionTitle}>Curated looks</h2>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{looks.length === 0 ? 'No looks published yet' : 'No looks match'}</p>
          <p className={styles.emptyText}>
            {looks.length === 0 ? 'Check back soon.' : 'Try clearing filters or search terms.'}
          </p>
          {looks.length > 0 && (
            <button type="button" className={styles.clearButton} onClick={clear}>
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className={styles.grid}>
          {visible.map((look) => (
            <LookCard key={look.id} look={look} />
          ))}
        </div>
      )}
    </div>
  );
}
