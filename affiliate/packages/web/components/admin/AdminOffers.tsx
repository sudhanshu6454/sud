'use client';

/*
 * Admin · Offers (listed in the handover, not drawn): the offers in review,
 * reviewed exactly like the 2e queue (same panel, same decisions), and a
 * sample of the live offers. TEST demo data (lib/demo/admin.ts,
 * lib/demo/afflino.ts); no v1 endpoint serves the offer review.
 */

import DemoBadge from '@/components/DemoBadge';
import { KpiCell, KpiStrip, StatusTag, Tag, type DataTableColumn } from '@/components/ui';
import { ADMIN_QUEUE_TOTALS, ADMIN_REVIEW_ITEMS, DEMO_ADMIN_OFFER_COUNTS, DEMO_ADMIN_PERIOD } from '@/lib/demo/admin';
import { DEMO_OFFERS, platformList, type DemoOffer } from '@/lib/demo/afflino';
import { formatCount, formatPayout } from '@/lib/format';
import { AdminLive } from './AdminLive';
import { AdminNote, AdminSection } from './AdminSection';
import { queueCounts, visibleItems } from './queueModel';
import { ResponsiveTable, StackRow } from './ResponsiveTable';
import { ReviewDialog } from './ReviewDialog';
import { ReviewQueueTable } from './ReviewQueueTable';
import { useReviewPanel } from './useReviewPanel';
import { useReviewQueue } from './useReviewQueue';

const OFFER_ITEMS = visibleItems(ADMIN_REVIEW_ITEMS, 'Offer');

const LIVE_COLUMNS: ReadonlyArray<DataTableColumn<DemoOffer>> = [
  { key: 'name', header: 'Offer', tone: 'strong', width: '22%', cell: (o) => o.name },
  { key: 'category', header: 'Category', tone: 'muted', width: '15%', cell: (o) => o.category },
  { key: 'model', header: 'Model', width: '10%', cell: (o) => <Tag variant={o.modelTag}>{o.model}</Tag> },
  { key: 'payout', header: 'Payout', width: '17%', cell: (o) => formatPayout(o.payout) },
  { key: 'platforms', header: 'Platforms', tone: 'muted', width: '20%', cell: (o) => platformList(o.platforms) },
  { key: 'status', header: 'Status', cell: () => <StatusTag status="Live" /> },
];

export function AdminOffers() {
  const queue = useReviewQueue('Offer');
  const panel = useReviewPanel(queue);
  const counts = queueCounts(ADMIN_QUEUE_TOTALS, OFFER_ITEMS, queue.decisions);
  const rejectedHere = OFFER_ITEMS.filter((i) => queue.decisions[i.id]?.decision === 'rejected').length;

  return (
    <>
      <h1 className="sr-only">Admin: offers</h1>
      <KpiStrip columns={4}>
        <KpiCell size={32} label="Live offers" value={formatCount(DEMO_ADMIN_OFFER_COUNTS.live)} />
        <KpiCell size={32} label="In review" value={formatCount(counts.Offer)} meta="New offers and changes" />
        <KpiCell size={32} label="Paused" value={formatCount(DEMO_ADMIN_OFFER_COUNTS.paused)} meta="By the brand or by ops" />
        <KpiCell size={32} label={`Rejected · ${DEMO_ADMIN_PERIOD.monthShort}`} value={formatCount(DEMO_ADMIN_OFFER_COUNTS.rejected + rejectedHere)} />
      </KpiStrip>

      <AdminSection title="In review" titleId="admin-offers-review-title" badge={<DemoBadge variant="mock" />}>
        <ReviewQueueTable
          hideType
          caption="Offers in review"
          items={OFFER_ITEMS}
          decisions={queue.decisions}
          ready={queue.ready}
          onReview={panel.open}
          empty="No offer is waiting for review."
        />
        <AdminNote>
          Demo sample: {formatCount(OFFER_ITEMS.length)} shown, {formatCount(counts.Offer)} open. The same items and
          decisions as the review queue; decisions are kept in this browser and nothing is sent to the API.
        </AdminNote>
      </AdminSection>

      <AdminSection title="Live" titleId="admin-offers-live-title">
        <ResponsiveTable
          caption="Live offers"
          columns={LIVE_COLUMNS}
          rows={DEMO_OFFERS}
          rowKey={(o) => o.id}
          phoneRow={(o) => (
            <StackRow
              eyebrow={<Tag variant={o.modelTag}>{o.model}</Tag>}
              title={o.name}
              aside={formatPayout(o.payout)}
              meta={`${o.category} · ${platformList(o.platforms)}`}
            />
          )}
        />
        <AdminNote>
          Demo sample: {formatCount(DEMO_OFFERS.length)} of {formatCount(DEMO_ADMIN_OFFER_COUNTS.live)} live offers.
        </AdminNote>
      </AdminSection>

      <AdminLive message={queue.announcement} />
      <ReviewDialog item={panel.item} record={panel.record} onClose={panel.close} onDecide={panel.onDecide} onReopen={panel.onReopen} />
    </>
  );
}
