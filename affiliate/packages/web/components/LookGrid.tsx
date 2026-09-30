'use client';

/*
 * The shop grid (/shop) in the 1d offer-browser composition: page header with
 * the look count and a search input, a row of category filter tags with a
 * sort on the right, then the looks as 2px-ruled cells. Receives the
 * already-loaded looks from the server page (app/(shop)/shop/page.tsx) and
 * never calls the API itself. Search and filters run over the loaded list
 * (the list endpoint has neither).
 */

import { useMemo, useState } from 'react';
import DemoBadge from './DemoBadge';
import { DisclosureLine } from './shop/DisclosureLine';
import LookCard from './LookCard';
import { filterLooks, lookCategories, LOOK_SORTS, sortLooks, type LookSort } from './shop/model';
import { EmptyState } from './ui/EmptyState';
import { Input } from './ui/Input';
import { PageHeader } from './ui/PageHeader';
import { TagButton } from './ui/Tag';
import type { LookSummary } from '../lib/types';
import styles from './LookGrid.module.css';

export interface LookGridProps {
  looks: LookSummary[];
  /** The catalogue fell back to the TEST demo data: render the badge. */
  demo: boolean;
  /**
   * Rendered as a section of a page that has its own h1 (/shop under the
   * Spotted feed): the header is an h2 with this eyebrow, the cards' titles
   * h3. Default: the grid is the page (h1, cards h2).
   */
  sectionEyebrow?: string;
}

export default function LookGrid({ looks, demo, sectionEyebrow }: LookGridProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<LookSort>('newest');

  const categories = useMemo(() => lookCategories(looks), [looks]);
  const visible = useMemo(() => sortLooks(filterLooks(looks, { query, category }), sort), [looks, query, category, sort]);
  const now = useMemo(() => new Date(), []);

  const clear = () => {
    setQuery('');
    setCategory(null);
  };

  const count = `${looks.length} curated ${looks.length === 1 ? 'look' : 'looks'}`;
  const trimmed = query.trim();

  return (
    <>
      <PageHeader
        eyebrow={sectionEyebrow ?? 'Shop the looks'}
        as={sectionEyebrow ? 'h2' : 'h1'}
        title={count}
        description="Spotted on your favourite pages — shop exact matches and similar styles."
        className={styles.header}
        actions={
          <>
            {demo ? <DemoBadge className={styles.badge} /> : null}
            <span className={styles.search}>
              <Input
                type="search"
                compact
                aria-label="Search looks"
                placeholder="Search looks, pages, categories"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('');
                }}
              />
            </span>
          </>
        }
      />

      <div className={styles.filters}>
        <div className={styles.tags} role="group" aria-label="Filter by category">
          <TagButton selected={category === null} onClick={() => setCategory(null)} className={styles.tag}>
            All
          </TagButton>
          {categories.map((c) => {
            const active = category !== null && category.toLowerCase() === c.toLowerCase();
            return (
              <TagButton key={c} selected={active} onClick={() => setCategory(active ? null : c)} className={styles.tag}>
                {c}
              </TagButton>
            );
          })}
        </div>
        <label className={styles.sort}>
          Sort:{' '}
          <span className={styles.sortBox}>
            <span className={styles.sizer} aria-hidden="true">
              {LOOK_SORTS.find((s) => s.value === sort)?.label}
            </span>
            <select className={styles.sortSelect} value={sort} onChange={(e) => setSort(e.target.value as LookSort)}>
              {LOOK_SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <p className="sr-only" aria-live="polite">
        {visible.length === looks.length ? count : `${visible.length} of ${looks.length} looks shown`}
      </p>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          {looks.length === 0 ? (
            <EmptyState title="No looks published yet." action={{ label: 'See your saved items', href: '/saved' }}>
              New looks appear here as soon as the editors publish them.
            </EmptyState>
          ) : (
            <EmptyState title="No looks match." action={{ label: 'Clear search', onClick: clear }}>
              {trimmed ? `Nothing matches “${trimmed}”` : 'Nothing matches'}
              {category ? ` in ${category}` : ''}. Try a page name or a category.
            </EmptyState>
          )}
        </div>
      ) : (
        <div className={styles.gridWrap}>
          <ul className={styles.grid} aria-label="Looks">
            {visible.map((look) => (
              <LookCard key={look.id} look={look} now={now} headingLevel={sectionEyebrow ? 'h3' : 'h2'} />
            ))}
          </ul>
        </div>
      )}

      <DisclosureLine />
    </>
  );
}
