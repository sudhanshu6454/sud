'use client';

/*
 * Creator Overview — 1c (desktop) and the 1e left composition (phone,
 * ≤760px). Earnings and Next payout come from GET /v1/publisher/earnings
 * when it answers; everything else is TEST demo data (no v1 endpoint), so
 * the page always carries <DemoBadge /> ("fallback" when the call failed).
 */

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import {
  Banner,
  BarChart,
  Button,
  DataTable,
  Eyebrow,
  KpiCell,
  KpiStrip,
  PageHeader,
  ProgressBar,
  Segmented,
  Skeleton,
  StatusTag,
  cx,
  type DataTableColumn,
} from '@/components/ui';
import type { DemoTopLink } from '@/lib/demo/afflino';
import { formatCount, formatCountCompact, formatINRFromMinor } from '@/lib/format';
import { loadOverview, type OverviewLoad } from './data';
import {
  DEFAULT_OVERVIEW_RANGE,
  OVERVIEW_RANGES,
  chartTitle,
  overviewKpis,
  rangeInfo,
  type OverviewRange,
} from './metrics';
import styles from './Overview.module.css';

const RANGE_OPTIONS = OVERVIEW_RANGES.map((r) => ({ value: r.id, label: r.label }));

/** A link that may only wrap after a "/" (never inside "demo-priya"). */
function BreakableUrl({ url }: { url: string }) {
  const parts = url.split('/');
  const segments = parts.map((part, i) => (i < parts.length - 1 ? `${part}/` : part)).filter(Boolean);
  return (
    <>
      {segments.map((segment, i) => (
        <Fragment key={i}>
          {i > 0 ? <wbr /> : null}
          <span className={styles.nowrap}>{segment}</span>
        </Fragment>
      ))}
    </>
  );
}

/* Column widths as drawn (share of the 996px table in 1c). */
const LINK_COLUMNS: ReadonlyArray<DataTableColumn<DemoTopLink>> = [
  { key: 'offer', header: 'Offer', tone: 'strong', width: '22.59%', cell: (r) => r.offer },
  { key: 'url', header: 'Link', tone: 'muted', width: '34.44%', className: styles.linkCell, cell: (r) => <BreakableUrl url={r.url} /> },
  { key: 'clicks', header: 'Clicks', width: '9.44%', cell: (r) => formatCount(r.clicks) },
  { key: 'conversions', header: 'Conv.', width: '7.73%', cell: (r) => formatCount(r.conversions) },
  { key: 'earned', header: 'Earned', width: '13.45%', cell: (r) => formatINRFromMinor(r.earnedMinor) },
  { key: 'status', header: 'Status', width: '12.35%', cell: (r) => <StatusTag status={r.status} /> },
];

const SKELETON_COLUMNS: ReadonlyArray<DataTableColumn<number>> = LINK_COLUMNS.map((c) => ({
  key: c.key,
  header: c.header,
  width: c.width,
  cell: () => <Skeleton width={c.key === 'url' ? '70%' : c.key === 'offer' ? '75%' : '55%'} height={14} inline />,
}));

export function Overview() {
  const [range, setRange] = useState<OverviewRange>(DEFAULT_OVERVIEW_RANGE);
  const [load, setLoad] = useState<OverviewLoad | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const request = useRef(0);
  const userChanged = useRef(false);

  useEffect(() => {
    const id = ++request.current;
    setLoad(null);
    loadOverview(range).then((result) => {
      if (id !== request.current) return; // a newer range was picked meanwhile
      setLoad(result);
      if (userChanged.current) setAnnouncement(`Showing the ${result.dataset.title.toLowerCase()}.`);
    });
  }, [range]);

  const onRangeChange = (next: OverviewRange) => {
    userChanged.current = true;
    setRange(next);
  };

  const title = rangeInfo(range).title;
  const kpis = load ? overviewKpis(load.dataset, load.live) : null;
  const dataset = load?.dataset ?? null;
  const badge = load ? (
    <DemoBadge variant={load.fallback ? 'fallback' : 'mock'} className={styles.badge} />
  ) : null;

  return (
    <>
      {load?.mismatch ? (
        <Banner title="Earnings unavailable.">
          The API answered for a different publisher than this account, so the page shows demo data.
        </Banner>
      ) : null}

      {load?.live ? (
        <Banner tone="info">
          Earnings and Next payout are your live balances to date (the earnings API takes no date range). Clicks,
          conversions, the chart and the tables are demo data until their endpoints exist.
        </Banner>
      ) : null}

      {/* ---------- desktop / tablet (1c) ---------- */}
      <div className={styles.desktop}>
        <PageHeader
          className={styles.header}
          eyebrow="Overview"
          title={title}
          actions={
            <>
              {badge}
              <Segmented aria-label="Date range" options={RANGE_OPTIONS} value={range} onChange={onRangeChange} />
              <Button variant="primary" arrow href="/app/links">
                Get a link
              </Button>
            </>
          }
        />

        <KpiStrip columns={4} className={styles.kpis}>
          <KpiCell
            label={kpis?.earnings.label ?? 'Earnings'}
            value={kpis ? formatINRFromMinor(kpis.earnings.valueMinor) : undefined}
            meta={kpis?.earnings.meta ?? ''}
            positive={kpis?.earnings.positive}
            loading={!kpis}
          />
          <KpiCell
            label="Clicks"
            value={kpis ? formatCount(kpis.clicks.value) : undefined}
            meta={kpis?.clicks.meta ?? ''}
            loading={!kpis}
          />
          <KpiCell
            label="Conversions"
            value={kpis ? formatCount(kpis.conversions.value) : undefined}
            meta={kpis?.conversions.meta ?? ''}
            loading={!kpis}
          />
          <KpiCell
            label="Next payout"
            value={kpis ? formatINRFromMinor(kpis.nextPayout.valueMinor) : undefined}
            meta={kpis?.nextPayout.meta ?? ''}
            loading={!kpis}
          />
        </KpiStrip>

        <div className={styles.row}>
          <section className={styles.chartCell} aria-labelledby="overview-chart-title">
            <Eyebrow as="h2" id="overview-chart-title" className={styles.sectionLabel}>
              {dataset?.chart.title ?? chartTitle(range)}
            </Eyebrow>
            {dataset ? (
              <BarChart
                data={dataset.chart.valuesMinor}
                max={dataset.chart.maxMinor}
                highlightLast={dataset.chart.highlightLast}
                axisLabels={dataset.chart.axisLabels}
                label={dataset.chart.summary}
                barLabel={(_, i) => dataset.chart.barLabels[i] ?? ''}
              />
            ) : (
              <div aria-hidden="true">
                <Skeleton height={180} />
                <div className={styles.axisSkeleton}>
                  <Skeleton width={36} height={12} inline />
                  <Skeleton width={36} height={12} inline />
                  <Skeleton width={36} height={12} inline />
                </div>
              </div>
            )}
          </section>

          <section className={styles.platformCell} aria-labelledby="overview-platform-title">
            <Eyebrow as="h2" id="overview-platform-title" className={styles.sectionLabel}>
              By platform
            </Eyebrow>
            <ul className={styles.platforms} aria-busy={!dataset || undefined}>
              {(dataset?.byPlatform ?? [null, null, null]).map((row, i) => (
                <li key={row?.platform ?? i}>
                  <div className={styles.platformRow}>
                    {row ? (
                      <>
                        <span>{row.label}</span>
                        <span>{formatINRFromMinor(row.earnedMinor)}</span>
                      </>
                    ) : (
                      <>
                        <Skeleton width={64} height={14} inline />
                        <Skeleton width={72} height={14} inline />
                      </>
                    )}
                  </div>
                  {row ? (
                    <ProgressBar
                      value={row.sharePct}
                      tone={row.tone}
                      label={`${row.label} share of earnings`}
                      className={styles.platformBar}
                    />
                  ) : (
                    <Skeleton height={8} className={styles.platformBar} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className={styles.links} aria-labelledby="overview-links-title">
          <div className={styles.linksHead}>
            <Eyebrow as="h2" id="overview-links-title">
              Top links
            </Eyebrow>
            <Link href="/app/links" className={styles.allLinks}>
              All links<span aria-hidden="true"> →</span>
            </Link>
          </div>
          {dataset ? (
            <DataTable
              columns={LINK_COLUMNS}
              rows={dataset.topLinks}
              rowKey={(r) => r.offerId}
              caption="Top links: clicks, conversions and earnings per link, all time"
              empty={<span>No links yet.</span>}
            />
          ) : (
            <DataTable columns={SKELETON_COLUMNS} rows={[0, 1, 2, 3]} rowKey={(r) => String(r)} caption="Top links (loading)" />
          )}
        </section>
      </div>

      {/* ---------- phone (1e, left) ---------- */}
      <div className={styles.phone}>
        <h1 className="sr-only">Overview — {title}</h1>
        <section className={styles.hero} aria-labelledby="overview-hero-title">
          <div className={styles.heroTop}>
            <Eyebrow as="h2" id="overview-hero-title">
              {kpis?.phoneEyebrow ?? `Earnings · ${rangeInfo(range).label}`}
            </Eyebrow>
            {badge}
          </div>
          <div className={styles.heroValue} aria-busy={!kpis || undefined}>
            {kpis ? formatINRFromMinor(kpis.earnings.valueMinor) : '—'}
          </div>
          {kpis ? (
            <p className={cx(styles.heroLine, kpis.phonePositive && styles.positive)}>{kpis.phoneLine}</p>
          ) : (
            <p className={styles.heroLine} aria-hidden="true">
              <Skeleton width={180} height={13} inline />
            </p>
          )}
        </section>

        <dl className={styles.mini}>
          <div className={styles.miniCell}>
            <dt>Clicks</dt>
            <dd>{kpis ? formatCountCompact(kpis.clicks.value) : '—'}</dd>
          </div>
          <div className={styles.miniCell}>
            <dt>Conv.</dt>
            <dd>{kpis ? formatCount(kpis.conversions.value) : '—'}</dd>
          </div>
          <div className={styles.miniCell}>
            <dt>CR</dt>
            <dd>{kpis ? kpis.conversionRate : '—'}</dd>
          </div>
        </dl>

        <section className={styles.phoneLinks} aria-labelledby="overview-phone-links-title">
          <Eyebrow as="h2" id="overview-phone-links-title" className={styles.phoneLinksLabel}>
            Top links
          </Eyebrow>
          <ul className={styles.phoneList}>
            {(dataset?.topLinks ?? [null, null, null, null]).map((row, i) => (
              <li key={row?.offerId ?? i} className={styles.phoneRow}>
                {row ? (
                  <>
                    <span className={styles.phoneOffer}>{row.offer}</span>
                    <span>{formatINRFromMinor(row.earnedMinor)}</span>
                  </>
                ) : (
                  <>
                    <Skeleton width={120} height={14} inline />
                    <Skeleton width={72} height={14} inline />
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
