'use client';

/*
 * "My links · 46" — the right column of 3c: title, filter input and the
 * table (Link = offer + monospace URL, Platform, Clicks, EPC, Status).
 * TEST demo rows (lib/demo/afflino.ts DEMO_MY_LINKS, plus a "Review" row for
 * each approval-only offer applied to in this browser): v1 has no endpoint
 * that lists a creator's links, so the section carries
 * <DemoBadge variant="mock" />.
 */

import { useId, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { EmptyState, Input, StatusTag, tableClasses as t } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { PLATFORM_NAME, type LinkStatus, type Platform } from '@/lib/demo/afflino';
import { formatCount, formatINRFromMinor } from '@/lib/format';
import { filterLinks } from '@/lib/links';
import styles from './MyLinks.module.css';

export interface MyLinkRow {
  key: string;
  offer: string;
  url: string;
  subId: string;
  platform: Platform;
  /** null = no data yet (a new link in Review). */
  clicks: number | null;
  epcMinor: number | null;
  status: LinkStatus;
}

export interface MyLinksProps {
  rows: ReadonlyArray<MyLinkRow>;
  /** Header count ("My links · 46"): the account's total, not just the rows shown. */
  total: number;
}

export function MyLinks({ rows, total }: MyLinksProps) {
  const headingId = `ml${useId().replace(/:/g, '')}`;
  const [query, setQuery] = useState('');
  const withNames = rows.map((r) => ({ ...r, platformName: PLATFORM_NAME[r.platform] }));
  const shown = filterLinks(withNames, query);
  const trimmed = query.trim();

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <h2 id={headingId} className={styles.title}>
            My links · {total}
          </h2>
          <DemoBadge variant="mock" className={styles.badge} />
        </div>
        <span className={styles.filter}>
          <Input
            type="search"
            compact
            aria-label="Filter links"
            placeholder="Filter links"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
      </div>

      <p className="sr-only" aria-live="polite">
        {trimmed ? `${shown.length} of ${rows.length} links match` : ''}
      </p>

      <div className={t.wrap}>
        <table className={t.table}>
          <caption className="sr-only">My links (demo data)</caption>
          <thead>
            <tr>
              <th scope="col" className={t.th}>
                Link
              </th>
              <th scope="col" className={cx(t.th, styles.colPlatform)}>
                Platform
              </th>
              <th scope="col" className={cx(t.th, styles.colNum)}>
                Clicks
              </th>
              <th scope="col" className={cx(t.th, styles.colNum, styles.colEpc)}>
                EPC
              </th>
              <th scope="col" className={cx(t.th, styles.colStatus)}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td className={t.empty} colSpan={5}>
                  {rows.length === 0 ? (
                    <EmptyState title="No links yet." action={{ label: 'Browse offers', href: '/app/offers' }}>
                      Pick an offer and get your first tracked link.
                    </EmptyState>
                  ) : (
                    <EmptyState title="No links match." action={{ label: 'Clear filter', onClick: () => setQuery('') }}>
                      Nothing matches “{trimmed}”. Filter by offer, sub-ID, platform or status.
                    </EmptyState>
                  )}
                </td>
              </tr>
            ) : (
              shown.map((row) => {
                const epc = row.epcMinor === null ? '—' : formatINRFromMinor(row.epcMinor, { paise: true });
                const clicks = row.clicks === null ? '—' : formatCount(row.clicks);
                return (
                  <tr key={row.key}>
                    <td className={cx(t.td, styles.linkCell)}>
                      <div className={styles.offer}>{row.offer}</div>
                      <div className={styles.url}>{row.url}</div>
                      <div className={styles.phoneMeta}>
                        {PLATFORM_NAME[row.platform]} · EPC {epc}
                      </div>
                    </td>
                    <td className={cx(t.td, styles.colPlatform)}>{PLATFORM_NAME[row.platform]}</td>
                    <td className={cx(t.td, t.num, styles.colNum)}>{clicks}</td>
                    <td className={cx(t.td, t.num, styles.colNum, styles.colEpc)}>{epc}</td>
                    <td className={cx(t.td, styles.colStatus)}>
                      <StatusTag status={row.status} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
