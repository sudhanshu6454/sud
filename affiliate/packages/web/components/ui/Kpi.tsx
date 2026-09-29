import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import styles from './Kpi.module.css';

export interface KpiStripProps {
  /** Number of equal cells per row on desktop. Default: the number of children. */
  columns?: number;
  className?: string;
  children: ReactNode;
}

/**
 * Row of equal KPI cells split by 2px rules, with a 2px rule underneath.
 * Below 760px it becomes two columns (an odd last cell spans both).
 */
export function KpiStrip({ columns, className, children }: KpiStripProps) {
  const count = columns ?? (Array.isArray(children) ? children.filter(Boolean).length : 1);
  return (
    <div className={cx(styles.strip, className)} style={{ '--kpi-columns': count } as CSSProperties}>
      {children}
    </div>
  );
}

export type KpiSize = 32 | 36 | 48 | 56;

export interface KpiCellProps {
  /** Eyebrow, e.g. "Earnings". */
  label: ReactNode;
  /** The big number, already formatted ("₹1,84,320"). Ignored while loading. */
  value?: ReactNode;
  /** 36 (dashboard, default), 32 (admin / reports), 48 (payout balances), 56 (landing). */
  size?: KpiSize;
  /** 13px line under the number, neutral-700 ("Fri 3 Oct · UPI"). */
  meta?: ReactNode;
  /** Render the meta line in accent-700 (a positive delta, "+22% vs prior"). */
  positive?: boolean;
  /** accent-100 cell with accent-700 text (2e "Flagged conversions"). */
  highlight?: boolean;
  /** Shows "—" (with a skeleton bar for the meta line) until the value arrives. */
  loading?: boolean;
  /** Anything under the meta line: a progress bar (3d funnel, 12px gap) or a button (2c, extraSpacing="loose", 16px gap). */
  children?: ReactNode;
  extraSpacing?: 'normal' | 'loose';
  className?: string;
}

export function KpiCell({
  label,
  value,
  size = 36,
  meta,
  positive = false,
  highlight = false,
  loading = false,
  children,
  extraSpacing = 'normal',
  className,
}: KpiCellProps) {
  return (
    <div className={cx(styles.cell, highlight && styles.highlight, className)} aria-busy={loading || undefined}>
      <div className={styles.label}>{label}</div>
      <div className={cx(styles.value, styles[`s${size}`])}>{loading ? '—' : value}</div>
      {loading && meta !== undefined ? (
        <div className={styles.meta} aria-hidden="true">
          <span className={styles.skeleton} />
        </div>
      ) : meta !== undefined && meta !== null ? (
        <div className={cx(styles.meta, positive && styles.positive)}>{meta}</div>
      ) : null}
      {children ? <div className={extraSpacing === 'loose' ? styles.extraLoose : styles.extra}>{children}</div> : null}
    </div>
  );
}
