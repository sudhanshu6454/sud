import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  /** Optional 600-weight first line ("No links yet"). */
  title?: ReactNode;
  /** The 14px copy. */
  children?: ReactNode;
  /** One primary action, e.g. { label: 'Browse offers', href: '/app/offers' } → "Browse offers →". */
  action?: { label: string; href: string } | { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cx(styles.empty, className)}>
      <p className={styles.copy}>
        {title ? <span className={styles.title}>{title}</span> : null}
        {title && children ? ' ' : null}
        {children}
      </p>
      {action ? (
        'href' in action ? (
          <Button variant="primary" arrow href={action.href}>
            {action.label}
          </Button>
        ) : (
          <Button variant="primary" arrow onClick={action.onClick}>
            {action.label}
          </Button>
        )
      ) : null}
    </div>
  );
}
