'use client';

/*
 * Creator Reports — 3d. Filter tags (date range, offer, platform, group by)
 * open small menus and recompute the report; "Export CSV" downloads what is
 * on screen. No v1 endpoint serves reports, so it is TEST demo data
 * throughout (<DemoBadge variant="mock" />).
 */

import { useMemo, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import {
  Button,
  DataTable,
  EmptyState,
  Eyebrow,
  KpiCell,
  KpiStrip,
  PageHeader,
  ProgressBar,
  type DataTableColumn,
} from '@/components/ui';
import { downloadCsv } from '@/lib/download';
import { formatCount, formatCountCompact, formatINRFromMinor, formatPct, formatRate } from '@/lib/format';
import { buildReportCsv, reportFilename } from './csv';
import { FilterMenu } from './FilterMenu';
import {
  DEFAULT_REPORT_FILTERS,
  GROUP_BY_OPTIONS,
  REPORT_OFFER_OPTIONS,
  REPORT_PLATFORM_OPTIONS,
  REPORT_RANGE_OPTIONS,
  buildReport,
  type PeriodRow,
  type ReportFilters,
  type SubIdRow,
} from './model';
import styles from './Reports.module.css';

/* Column widths as drawn (share of the 576px sub-ID table in 3d). */
const SUB_ID_COLUMNS: ReadonlyArray<DataTableColumn<SubIdRow>> = [
  { key: 'subId', header: 'Sub-ID', tone: 'mono', width: '46.88%', cell: (r) => r.subId },
  { key: 'clicks', header: 'Clicks', width: '16.67%', cell: (r) => formatCount(r.clicks) },
  { key: 'cr', header: 'CR', width: '12.33%', cell: (r) => formatPct(r.crPct, { decimals: 1 }) },
  { key: 'earned', header: 'Earned', tone: 'strong', width: '24.12%', cell: (r) => formatINRFromMinor(r.earnedMinor) },
];

function periodColumns(heading: string): ReadonlyArray<DataTableColumn<PeriodRow>> {
  return [
    { key: 'period', header: heading, width: '28%', cell: (r) => r.label },
    { key: 'clicks', header: 'Clicks', width: '18%', cell: (r) => formatCount(r.clicks) },
    { key: 'conversions', header: 'Conv.', width: '18%', cell: (r) => formatCount(r.conversions) },
    { key: 'cr', header: 'CR', width: '18%', cell: (r) => formatRate(r.conversions, r.clicks, 1) },
    { key: 'earned', header: 'Earned', tone: 'strong', width: '18%', cell: (r) => formatINRFromMinor(r.earnedMinor) },
  ];
}

export function Reports() {
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const [announcement, setAnnouncement] = useState('');
  const report = useMemo(() => buildReport(filters), [filters]);

  const update = (patch: Partial<ReportFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    const r = buildReport(next);
    setAnnouncement(`Showing ${r.labels.offer}, ${r.labels.platform}, ${r.labels.range}, by ${r.labels.groupBy.toLowerCase()}.`);
  };

  const clearFilters = () => update({ offerId: 'all', platform: 'all' });

  const onExport = () => {
    const filename = reportFilename(report);
    downloadCsv(filename, buildReportCsv(report));
    setAnnouncement(`Exported ${filename}.`);
  };

  const emptyFilterState = (
    <EmptyState action={{ label: 'Clear filters', onClick: clearFilters }}>
      Nothing matches {report.labels.offer} on {report.labels.platform} in {report.labels.range}.
    </EmptyState>
  );

  const groupHeading = report.labels.groupBy;

  return (
    <>
      <PageHeader
        title="Reports"
        className={styles.header}
        actions={
          <div className={styles.filters}>
            <DemoBadge variant="mock" className={styles.badge} />
            <FilterMenu
              label="Date range"
              value={filters.range}
              options={REPORT_RANGE_OPTIONS}
              onChange={(range) => update({ range })}
            />
            <FilterMenu
              label="Offer"
              value={filters.offerId}
              options={REPORT_OFFER_OPTIONS}
              onChange={(offerId) => update({ offerId })}
            />
            <FilterMenu
              label="Platform"
              value={filters.platform}
              options={REPORT_PLATFORM_OPTIONS}
              onChange={(platform) => update({ platform })}
            />
            <FilterMenu
              label="Group by"
              value={filters.groupBy}
              options={GROUP_BY_OPTIONS}
              triggerText={(o) => `Group by: ${o.label.toLowerCase()}`}
              onChange={(groupBy) => update({ groupBy })}
            />
            <Button variant="secondary" onClick={onExport} className={styles.export}>
              Export CSV
            </Button>
          </div>
        }
      />

      <section aria-label="Funnel">
        <KpiStrip columns={5} className={styles.funnel}>
          {report.funnel.map((step) => (
            <KpiCell
              key={step.key}
              label={step.label}
              size={32}
              value={step.key === 'impressions' ? formatCountCompact(step.value) : formatCount(step.value)}
            >
              <ProgressBar
                value={step.widthPct}
                label={`${step.label}, relative size`}
                valueText={step.key === 'impressions' ? 'Full scale' : `${Math.round(step.widthPct)}% of the funnel scale`}
              />
            </KpiCell>
          ))}
        </KpiStrip>
      </section>

      {report.empty ? (
        <section className={styles.nothing} aria-label="No results">
          {emptyFilterState}
        </section>
      ) : (
        <>
          <div className={styles.row}>
            <section className={styles.citiesCell} aria-labelledby="reports-cities-title">
              <Eyebrow as="h2" id="reports-cities-title" className={styles.citiesLabel}>
                Conversions by city
              </Eyebrow>
              <ul className={styles.cities}>
                {report.cities.map((city) => (
                  <li key={city.name} className={styles.city}>
                    <span>{city.name}</span>
                    <ProgressBar
                      value={city.widthPct}
                      tone="ink"
                      height={12}
                      label={`${city.name}, conversions relative to the top city`}
                    />
                    <span className={styles.cityValue}>{formatCount(city.conversions)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={styles.subIdCell} aria-labelledby="reports-subid-title">
              <Eyebrow as="h2" id="reports-subid-title" className={styles.subIdLabel}>
                By sub-ID
              </Eyebrow>
              <DataTable
                columns={SUB_ID_COLUMNS}
                rows={report.subIds}
                rowKey={(r) => r.subId}
                caption={`Sub-IDs: clicks, conversion rate and earnings, ${report.labels.range}`}
                empty={emptyFilterState}
              />
            </section>
          </div>

          <section className={styles.periods} aria-labelledby="reports-periods-title">
            <Eyebrow as="h2" id="reports-periods-title" className={styles.subIdLabel}>
              By {groupHeading.toLowerCase()}
            </Eyebrow>
            <DataTable
              columns={periodColumns(groupHeading)}
              rows={report.periods}
              rowKey={(r) => r.start}
              caption={`Clicks, conversions and earnings by ${groupHeading.toLowerCase()}, ${report.labels.range}`}
            />
          </section>
        </>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
