'use client';

/*
 * Admin console — 2e: KPI strip (GMV, network fee, live offers, creators,
 * flagged conversions) and the review queue with its filter tags. TEST demo
 * data (lib/demo/admin.ts): no v1 endpoint serves the queue or takes a
 * decision, so the page carries <DemoBadge variant="mock" /> and decisions
 * stay in this browser.
 */

import DemoBadge from '@/components/DemoBadge';
import { KpiCell, KpiStrip } from '@/components/ui';
import { ADMIN_QUEUE_PAGE, ADMIN_QUEUE_TOTALS, DEMO_ADMIN_KPIS, DEMO_ADMIN_PERIOD } from '@/lib/demo/admin';
import { formatCount, formatINRCompactFromMinor } from '@/lib/format';
import { AdminLive } from './AdminLive';
import { AdminNote, AdminSection } from './AdminSection';
import { QUEUE_FILTERS, queueCounts, visibleItems } from './queueModel';
import { ReviewDialog } from './ReviewDialog';
import { QueueFilters, ReviewQueueTable } from './ReviewQueueTable';
import { useReviewPanel } from './useReviewPanel';
import { useReviewQueue } from './useReviewQueue';
import styles from './AdminPage.module.css';

const K = DEMO_ADMIN_KPIS;

export function AdminQueue() {
  const queue = useReviewQueue('all');
  const panel = useReviewPanel(queue);
  const counts = queueCounts(ADMIN_QUEUE_TOTALS, ADMIN_QUEUE_PAGE, queue.decisions);
  const rows = visibleItems(ADMIN_QUEUE_PAGE, queue.filter);
  const filterName = QUEUE_FILTERS.find((f) => f.value === queue.filter)?.label ?? 'All';
  const open = counts[queue.filter];

  return (
    <>
      <h1 className="sr-only">Admin console: review queue</h1>
      <KpiStrip columns={5} className={styles.kpis}>
        <KpiCell size={32} label={`GMV\u00a0·\u00a0${DEMO_ADMIN_PERIOD.monthShort}`} value={formatINRCompactFromMinor(K.gmvMinor)} />
        <KpiCell size={32} label="Network fee" value={formatINRCompactFromMinor(K.networkFeeMinor)} />
        <KpiCell size={32} label="Live offers" value={formatCount(K.liveOffers)} />
        <KpiCell size={32} label="Creators" value={formatCount(K.creators)} />
        <KpiCell size={32} label="Flagged conversions" value={formatCount(K.flaggedConversions)} highlight />
      </KpiStrip>

      <AdminSection
        title="Review queue"
        titleId="admin-queue-title"
        badge={<DemoBadge variant="mock" />}
        aside={<QueueFilters value={queue.filter} counts={counts} onChange={queue.setFilter} />}
      >
        <ReviewQueueTable
          caption={`Review queue, ${filterName.toLowerCase()}`}
          items={rows}
          decisions={queue.decisions}
          ready={queue.ready}
          onReview={panel.open}
        />
        <AdminNote>
          Demo sample: {formatCount(rows.length)} shown, {formatCount(open)} open in{' '}
          {queue.filter === 'all' ? 'the queue' : filterName}. Decisions are kept in this browser; nothing is sent to the
          API.
          {queue.saveFailed ? ' This browser refused to store them, so they last until you leave the page.' : ''}
        </AdminNote>
      </AdminSection>

      <AdminLive message={queue.announcement} />
      <ReviewDialog item={panel.item} record={panel.record} onClose={panel.close} onDecide={panel.onDecide} onReopen={panel.onReopen} />
    </>
  );
}
