import type { ReactNode } from 'react';
import { cx } from '../ui/cx';
import styles from './PageBody.module.css';

/** Content area under a <PageHeader>, in the app gutters. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.body, className)}>{children}</div>;
}

/** A policy / scope note (surface fill, accent left rule). */
export function PageNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx(styles.note, className)}>{children}</p>;
}

/** A section heading inside a page body. */
export function PageSection({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={cx(styles.section, className)}>
      {children}
    </h2>
  );
}
