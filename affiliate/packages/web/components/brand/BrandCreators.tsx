'use client';

/*
 * Brand creators (not drawn; 2b patterns): the approved roster (the top
 * creators plus anyone approved here) and the pending requests with Approve
 * / Decline. TEST demo data; decisions are kept in this browser and shared
 * with the overview's request list.
 */

import Link from 'next/link';
import DemoBadge from '@/components/DemoBadge';
import { Button, Eyebrow, KpiCell, KpiStrip, PageHeader, StatusTag } from '@/components/ui';
import { DEMO_TOP_CREATORS, PLATFORM_NAME, type Platform } from '@/lib/demo/afflino';
import { DEMO_BRAND_PERIOD, DEMO_BRAND_SUMMARY } from '@/lib/demo/brand';
import { formatCount, formatCountCompact, formatINRFromMinor } from '@/lib/format';
import { CreatorRequestList } from './CreatorRequestList';
import { StackTable, type StackColumn } from './StackTable';
import { useCreatorRequests } from './useCreatorRequests';
import { useBrandWorkspace } from './workspace';
import shared from './shared.module.css';
import styles from './BrandCreators.module.css';

interface RosterRow {
  name: string;
  platform: Platform;
  reach?: number;
  clicks: number;
  signUps: number;
  payoutMinor: number;
  status: 'Active' | 'Approved';
}

const COLUMNS: ReadonlyArray<StackColumn<RosterRow>> = [
  { key: 'name', header: 'Creator', primary: true, tone: 'strong', width: '28%', cell: (r) => r.name },
  { key: 'platform', header: 'Platform', tone: 'muted', cell: (r) => PLATFORM_NAME[r.platform] },
  { key: 'clicks', header: 'Clicks', numeric: true, cell: (r) => formatCount(r.clicks) },
  { key: 'signUps', header: 'Sign-ups', numeric: true, cell: (r) => formatCount(r.signUps) },
  { key: 'payout', header: 'Payout', numeric: true, nowrap: true, cell: (r) => formatINRFromMinor(r.payoutMinor) },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => (
      <span className={styles.status}>
        <StatusTag status={r.status} />
        {r.reach ? <span className={styles.reach}>{formatCountCompact(r.reach)} reach</span> : null}
      </span>
    ),
  },
];

export function BrandCreators() {
  const ws = useBrandWorkspace();
  const requests = useCreatorRequests(ws.key);
  const loading = !requests.ready;

  const roster: RosterRow[] = [
    ...requests.approved.map((r) => ({
      name: r.name,
      platform: r.platform,
      reach: r.reach,
      clicks: 0,
      signUps: 0,
      payoutMinor: 0,
      status: 'Approved' as const,
    })),
    ...DEMO_TOP_CREATORS.map((c) => ({ ...c, status: 'Active' as const })),
  ];

  return (
    <>
      <PageHeader
        eyebrow={`${ws.name} · Creators`}
        title="Creators"
        actions={<DemoBadge variant="mock" className={shared.badge} />}
      />
      <KpiStrip columns={3} className={shared.kpis}>
        <KpiCell label="Active creators" value={formatCount(requests.activeCreators)} meta={`Promoting in ${DEMO_BRAND_PERIOD.month}`} loading={loading} />
        <KpiCell label="Pending approval" value={formatCount(requests.pendingCount)} meta="Requests to promote your offers" loading={loading} />
        <KpiCell
          label="Sign-ups from creators"
          value={formatCount(DEMO_BRAND_SUMMARY.signUps)}
          meta={`${DEMO_BRAND_PERIOD.month}, all offers`}
          loading={loading}
        />
      </KpiStrip>
      <div className={styles.row}>
        <section className={styles.roster} aria-labelledby="brand-roster">
          <div className={shared.sectionHead}>
            <Eyebrow as="h2" id="brand-roster">
              Approved creators
            </Eyebrow>
            <span className={styles.meta}>
              {loading ? '—' : `${roster.length} of ${formatCount(requests.activeCreators)} shown · top by sign-ups`}
            </span>
          </div>
          {loading ? (
            <div className={styles.skeleton} aria-busy="true" aria-label="Loading creators">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={styles.skelRow} />
              ))}
            </div>
          ) : (
            <StackTable columns={COLUMNS} rows={roster} rowKey={(r) => r.name} caption={`Approved creators, ${DEMO_BRAND_PERIOD.month}`} />
          )}
        </section>
        <section className={styles.requests} aria-labelledby="brand-creator-requests">
          <Eyebrow as="h2" id="brand-creator-requests">
            Requests · {loading ? '—' : formatCount(requests.pendingCount)}
          </Eyebrow>
          <CreatorRequestList
            variant="desktop"
            labelledBy="brand-creator-requests"
            requests={requests.pending}
            ready={requests.ready}
            onApprove={requests.approve}
            onDecline={requests.decline}
            pendingCount={requests.pendingCount}
            emptyAction={{ label: 'New offer', href: ws.href('/brand/offers/new') }}
          />
          <p className={shared.demoNote}>
            Demo: {requests.pending.length} of {formatCount(requests.pendingCount)} pending requests are in the demo
            data. Decisions stay in this browser; no creator is notified.
          </p>
          <p className={styles.more}>
            <Link href={ws.href('/brand/conversions')}>
              Review conversions<span aria-hidden="true"> →</span>
            </Link>
          </p>
          <div>
            <Button variant="ghost" onClick={requests.reset} className={styles.touch}>
              Reset decisions
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
