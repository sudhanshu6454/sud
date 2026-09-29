import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './DataTable.module.css';

/** Class names for hand-written tables: table, th, td, right, strong, muted, body, mono, num, wrap. */
export const tableClasses = styles;

export type CellTone = 'default' | 'strong' | 'muted' | 'body' | 'mono';

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  /** Cell content; defaults to String(row[key]). */
  cell?: (row: Row, index: number) => ReactNode;
  /** Default left (every column in the mocks is left-aligned, numbers included). */
  align?: 'left' | 'right';
  /** strong = 600 (first column), muted = neutral-700 (links, refs), body = neutral-800 (reasons), mono = monospace (sub-IDs). */
  tone?: CellTone;
  /** Tabular figures for numeric columns. */
  numeric?: boolean;
  /** CSS width for the column, e.g. '18%' or '120px'. */
  width?: string;
  className?: string;
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row, index: number) => string;
  /** Accessible caption (visually hidden). */
  caption?: string;
  /** Shown in place of the body when rows is empty. */
  empty?: ReactNode;
  /** 12px header padding (2e) instead of 10px. */
  looseHeader?: boolean;
  className?: string;
}

const toneClass: Record<CellTone, string | undefined> = {
  default: undefined,
  strong: styles.strong,
  muted: styles.muted,
  body: styles.body,
  mono: styles.mono,
};

/**
 * Data table with the rendered mock's header and row rules. Hook-free, so it
 * renders in server and client components alike.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  looseHeader = false,
  className,
}: DataTableProps<Row>) {
  return (
    <div className={cx(styles.wrap, className)}>
      <table className={cx(styles.table, looseHeader && styles.headLoose)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cx(styles.th, col.align === 'right' && styles.right)}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty !== undefined ? (
            <tr>
              <td className={styles.empty} colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={rowKey(row, i)}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cx(
                      styles.td,
                      col.align === 'right' && styles.right,
                      toneClass[col.tone ?? 'default'],
                      col.numeric && styles.num,
                      col.className,
                    )}
                  >
                    {col.cell
                      ? col.cell(row, i)
                      : String((row as Record<string, unknown>)[col.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
