import type { ReactNode } from 'react';
import { cx } from '../ui/cx';
import styles from './Facts.module.css';

/** A term / value list under a 2px rule, 1px rules between rows, 14px (the offer-detail terms list). */
export function Facts({ items, className, label }: { items: ReadonlyArray<[string, ReactNode]>; className?: string; label?: string }) {
  return (
    <dl className={cx(styles.facts, className)} aria-label={label}>
      {items.map(([term, value]) => (
        <div key={term} className={styles.fact}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
