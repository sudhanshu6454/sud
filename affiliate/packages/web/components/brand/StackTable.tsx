/*
 * A DataTable look-alike (same header / row rules, tableClasses) whose rows
 * become labelled blocks on phones (≤760px): each cell prints its column
 * name, so a wide table stays readable at 360px without sideways scrolling.
 * Candidate for promotion into components/ui (DataTable has no phone mode).
 */

import type { ReactNode } from 'react';
import { cx, tableClasses } from '@/components/ui';
import styles from './StackTable.module.css';

export interface StackColumn<Row> {
  key: string;
  header: ReactNode;
  /** Plain-text column name printed before the cell on phones (default: header when it is a string). */
  label?: string;
  cell: (row: Row) => ReactNode;
  tone?: 'strong' | 'muted' | 'body' | 'mono';
  numeric?: boolean;
  width?: string;
  /** Phone: the row's heading cell (no label, full width, first). */
  primary?: boolean;
  /** Phone: actions cell (no label). */
  actions?: boolean;
  /** Keep this cell on one line on desktop. */
  nowrap?: boolean;
  /** Hide the column between the phone breakpoint and 1100px (narrow desktops); phones still list it. */
  hideMd?: boolean;
}

export interface StackTableProps<Row> {
  columns: ReadonlyArray<StackColumn<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row) => string;
  caption: string;
  empty?: ReactNode;
  className?: string;
}

export function StackTable<Row>({ columns, rows, rowKey, caption, empty, className }: StackTableProps<Row>) {
  return (
    <div className={cx(tableClasses.wrap, styles.wrap, className)}>
      <table className={cx(tableClasses.table, styles.table)}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cx(tableClasses.th, c.hideMd && styles.hideMd)}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty !== undefined ? (
            <tr>
              <td className={cx(tableClasses.empty, styles.emptyCell)} colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    data-label={c.primary || c.actions ? undefined : c.label ?? (typeof c.header === 'string' ? c.header : undefined)}
                    className={cx(
                      tableClasses.td,
                      c.tone && tableClasses[c.tone],
                      c.numeric && tableClasses.num,
                      c.primary && styles.primary,
                      c.actions && styles.actions,
                      c.nowrap && styles.nowrap,
                      c.hideMd && styles.hideMd,
                    )}
                  >
                    {c.cell(row)}
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
