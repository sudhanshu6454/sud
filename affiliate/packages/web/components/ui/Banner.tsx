import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './Banner.module.css';

export interface BannerProps {
  /** error = page-level failure (accent-100, role="alert"); info = neutral note. */
  tone?: 'error' | 'info';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Top-of-page banner for page-level failures (accent-100 background). */
export function Banner({ tone = 'error', title, children, className }: BannerProps) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx(styles.banner, tone === 'info' && styles.neutral, className)}>
      {title ? <span className={styles.title}>{title}</span> : null}
      {children ? <span>{children}</span> : null}
    </div>
  );
}
