'use client';

/*
 * Brand overview — 2b (desktop) and 3f right (phone, ≤760px). TEST demo
 * data (lib/demo/afflino.ts, lib/demo/brand.ts): no v1 endpoint serves brand
 * campaign figures, so the page carries <DemoBadge variant="mock" />.
 * Creator-request decisions are kept in this browser and move the "pending
 * approval" and "Active creators" figures.
 */

import DemoBadge from '@/components/DemoBadge';
import { Button, DataTable, Eyebrow, KpiCell, KpiStrip, PageHeader, ProgressBar, type DataTableColumn } from '@/components/ui';
import { DEMO_TOP_CREATORS, PLATFORM_NAME, type DemoCreatorRow } from '@/lib/demo/afflino';
import { DEMO_BRAND_PERIOD, DEMO_BRAND_SUMMARY } from '@/lib/demo/brand';
import { formatCount, formatINRCompactFromMinor, formatINRFromMinor, formatPct } from '@/lib/format';
import { CreatorRequestList } from './CreatorRequestList';
import { useCreatorRequests } from './useCreatorRequests';
import { useBrandWorkspace } from './workspace';
import shared from './shared.module.css';
import styles from './BrandOverview.module.css';

const S = DEMO_BRAND_SUMMARY;

/** Column widths as drawn in 2b (183 / 129 / 88 / 115 / 126 of 641px). */
const CREATOR_COLUMNS: ReadonlyArray<DataTableColumn<DemoCreatorRow>> = [
  { key: 'name', header: 'Creator', tone: 'strong', width: '28.5%', cell: (r) => r.name },
  { key: 'platform', header: 'Platform', tone: 'muted', width: '20.1%', cell: (r) => PLATFORM_NAME[r.platform] },
  { key: 'clicks', header: 'Clicks', numeric: true, width: '13.7%', cell: (r) => formatCount(r.clicks) },
  { key: 'signUps', header: 'Sign-ups', numeric: true, width: '17.9%', cell: (r) => formatCount(r.signUps) },
  { key: 'payout', header: 'Payout', numeric: true, cell: (r) => formatINRFromMinor(r.payoutMinor) },
];

export function BrandOverview() {
  const ws = useBrandWorkspace();
  const requests = useCreatorRequests(ws.key);
  const loading = !requests.ready;

  const costPerSignUpMinor = Math.round(S.spendMinor / S.signUps);
  const budgetPct = (S.spendMinor / S.budgetMinor) * 100;
  const spend = formatINRCompactFromMinor(S.spendMinor);
  const budget = formatINRCompactFromMinor(S.budgetMinor);

  return (
    <>
      {/* ---------- desktop (2b) ---------- */}
      <div className={styles.desktop}>
        <PageHeader
          eyebrow={`${ws.name} · ${DEMO_BRAND_PERIOD.month}`}
          title="Campaign performance"
          actions={
            <>
              <DemoBadge variant="mock" className={styles.badge} />
              <Button variant="secondary" href={ws.href('/brand/billing#top-up')}>
                Top up wallet
              </Button>
              <Button variant="primary" arrow href={ws.href('/brand/offers/new')}>
                New offer
              </Button>
            </>
          }
        />
        <KpiStrip columns={4} className={shared.kpis}>
          <KpiCell label="Spend" value={spend} meta={`of ${budget} budget`} loading={loading} />
          <KpiCell
            label="Sign-ups"
            value={formatCount(S.signUps)}
            meta={`${formatPct(S.signUpsDeltaPct, { signed: true })} vs ${DEMO_BRAND_PERIOD.previousMonthShort}`}
            positive
            loading={loading}
          />
          <KpiCell
            label="Cost / sign-up"
            value={formatINRFromMinor(costPerSignUpMinor)}
            meta={S.pricingNote}
            loading={loading}
          />
          <KpiCell
            label="Active creators"
            value={formatCount(requests.activeCreators)}
            meta={`${formatCount(requests.pendingCount)} pending approval`}
            loading={loading}
          />
        </KpiStrip>

        <div className={styles.row}>
          <section className={styles.creators} aria-labelledby="brand-top-creators">
            <Eyebrow as="h2" id="brand-top-creators" className={styles.sectionLabel}>
              Top creators
            </Eyebrow>
            <DataTable
              columns={CREATOR_COLUMNS}
              rows={DEMO_TOP_CREATORS}
              rowKey={(r) => r.name}
              caption={`Top creators, ${DEMO_BRAND_PERIOD.month}`}
              className={styles.table}
            />
          </section>
          <section className={styles.requests} aria-labelledby="brand-requests">
            <Eyebrow as="h2" id="brand-requests">
              Creator requests
            </Eyebrow>
            <CreatorRequestList
              variant="desktop"
              labelledBy="brand-requests"
              requests={requests.pending}
              ready={requests.ready}
              onApprove={requests.approve}
              onDecline={requests.decline}
              emptyAction={{ label: 'View creators', href: ws.href('/brand/creators') }}
            />
          </section>
        </div>
      </div>

      {/* ---------- phone (3f right) ---------- */}
      <div className={styles.phone}>
        <header className={styles.phHead}>
          <div className={styles.phEyebrowRow}>
            <Eyebrow>Brand · {ws.name}</Eyebrow>
            <DemoBadge variant="mock" className={styles.badge} />
          </div>
          <h1 className={styles.phTitle}>Today</h1>
        </header>
        <div className={styles.phKpis}>
          <div className={styles.phKpi}>
            <div className={styles.phKpiLabel}>Sign-ups</div>
            <div className={styles.phKpiValue}>{loading ? '—' : formatCount(S.today.signUps)}</div>
          </div>
          <div className={styles.phKpi}>
            <div className={styles.phKpiLabel}>Spend</div>
            <div className={styles.phKpiValue}>{loading ? '—' : formatINRFromMinor(S.today.spendMinor)}</div>
          </div>
        </div>
        <div className={styles.phBudget}>
          <div className={styles.phBudgetLabel}>
            Budget used · {spend} of {budget}
          </div>
          <ProgressBar
            value={budgetPct}
            height={10}
            label="Budget used"
            valueText={`${spend} of ${budget} (${Math.round(budgetPct)}%)`}
          />
        </div>
        <section className={styles.phRequests} aria-labelledby="brand-requests-phone">
          <Eyebrow as="h2" id="brand-requests-phone" className={styles.phRequestsLabel}>
            Requests · {loading ? '—' : formatCount(requests.pendingCount)}
          </Eyebrow>
          <CreatorRequestList
            variant="phone"
            labelledBy="brand-requests-phone"
            requests={requests.pending}
            ready={requests.ready}
            onApprove={requests.approve}
            onDecline={requests.decline}
            emptyAction={{ label: 'View creators', href: ws.href('/brand/creators') }}
          />
        </section>
      </div>
    </>
  );
}
