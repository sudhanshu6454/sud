import type { ReactNode } from 'react';
import { DataTable, cx, type DataTableProps } from '@/components/ui';
import styles from './ResponsiveTable.module.css';

export interface ResponsiveTableProps<Row> extends DataTableProps<Row> {
  /** The row on phones (≤760px): a stacked block (use <StackRow>). */
  phoneRow: (row: Row, index: number) => ReactNode;
}

/**
 * A DataTable on desktop and a stacked list on phones, where five or more
 * columns cannot fit 360px. Both are rendered; CSS shows one (the hidden one
 * is display:none, so assistive technology only meets the visible one).
 * Hook-free. Candidate for promotion to components/ui.
 */
export function ResponsiveTable<Row>({ phoneRow, className, ...table }: ResponsiveTableProps<Row>) {
  const { rows, rowKey, caption, empty } = table;
  return (
    <div className={className}>
      <div className={styles.desktop}>
        <DataTable {...table} />
      </div>
      <ul className={styles.phone} aria-label={caption}>
        {rows.length === 0 && empty !== undefined ? (
          <li className={cx(styles.item, styles.empty)}>{empty}</li>
        ) : (
          rows.map((row, i) => (
            <li key={rowKey(row, i)} className={styles.item}>
              {phoneRow(row, i)}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export interface StackRowProps {
  /** 600-weight first line. */
  title: ReactNode;
  /** Right of the title (a figure or a tag). */
  aside?: ReactNode;
  /** 13px neutral-700 lines under the title. */
  meta?: ReactNode;
  /** Controls under the meta (≥44px targets). */
  actions?: ReactNode;
  /** Above the title (a type tag). */
  eyebrow?: ReactNode;
}

/** One phone row: optional eyebrow, title + aside, meta, actions. */
export function StackRow({ title, aside, meta, actions, eyebrow }: StackRowProps) {
  return (
    <div className={styles.row}>
      {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
      <div className={styles.head}>
        <div className={styles.title}>{title}</div>
        {aside !== undefined && aside !== null ? <div className={styles.aside}>{aside}</div> : null}
      </div>
      {meta ? <div className={styles.meta}>{meta}</div> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
