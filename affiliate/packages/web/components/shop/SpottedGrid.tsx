import type { ReactNode } from 'react';
import type { SpottedCard as Card } from '../../lib/spotted';
import { EmptyState } from '../ui/EmptyState';
import { SpottedCard } from './SpottedCard';
import styles from './SpottedGrid.module.css';

/**
 * The looks of a feed, hub or storefront as 3 / 2 / 1 columns of ruled
 * cells, or the empty state. `storefront`: the page's own cards leave out
 * "Posted on <this page>", and on phones they are two compact columns (the
 * still, the headline, "View the look"), so a visitor finds the post they
 * came from.
 */
export function SpottedGrid({
  looks,
  label,
  empty,
  headingLevel = 'h3',
  storefront = false,
}: {
  looks: ReadonlyArray<Card>;
  label: string;
  empty: { title: string; body: ReactNode; action?: { label: string; href: string } };
  headingLevel?: 'h2' | 'h3';
  storefront?: boolean;
}) {
  if (looks.length === 0) {
    return (
      <div className={styles.empty}>
        <EmptyState title={empty.title} {...(empty.action ? { action: empty.action } : {})}>
          {empty.body}
        </EmptyState>
      </div>
    );
  }
  return (
    <div className={styles.wrap}>
      <ul className={storefront ? `${styles.grid} ${styles.phoneTwo}` : styles.grid} aria-label={label}>
        {looks.map((l) => (
          <SpottedCard key={l.id} look={l} headingLevel={headingLevel} hideSource={storefront} phoneCompact={storefront} />
        ))}
      </ul>
    </div>
  );
}
