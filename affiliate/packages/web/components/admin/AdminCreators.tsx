'use client';

/*
 * Admin · Creators (listed in the handover, not drawn): reach and KYC status
 * per creator, in the 2e style. TEST demo data (lib/demo/admin.ts); no v1
 * endpoint lists creators and no KYC or PAN check exists in this build. A
 * creator whose KYC is in review follows the queue decision and can be
 * reviewed from here.
 */

import { useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Button, KpiCell, KpiStrip, Tag, type DataTableColumn, type TagVariant } from '@/components/ui';
import {
  DEMO_ADMIN_ACTIVE_CREATORS,
  DEMO_ADMIN_CREATOR_COUNTS,
  DEMO_ADMIN_CREATORS,
  adminReviewItem,
  type AdminCreator,
} from '@/lib/demo/admin';
import { platformList } from '@/lib/demo/afflino';
import { formatCount, formatCountCompact, formatPct } from '@/lib/format';
import { AdminLive } from './AdminLive';
import { AdminNote, AdminSection } from './AdminSection';
import { CREATOR_FILTERS, creatorCounts, creatorKyc, kycBucket, type CreatorFilter, type KycShown } from './adminModel';
import { FilterTags } from './FilterTags';
import { ResponsiveTable, StackRow } from './ResponsiveTable';
import { ReviewDialog } from './ReviewDialog';
import { useReviewPanel } from './useReviewPanel';
import { useReviewQueue } from './useReviewQueue';
import styles from './AdminPage.module.css';

const KYC_TAG: Record<KycShown, TagVariant> = {
  Verified: 'accent',
  'In review': 'outline',
  'Info requested': 'outline',
  'Not started': 'neutral',
  Rejected: 'neutral',
};

export function AdminCreators() {
  const queue = useReviewQueue();
  const panel = useReviewPanel(queue);
  const [filter, setFilter] = useState<CreatorFilter>('all');
  const counts = creatorCounts(DEMO_ADMIN_CREATOR_COUNTS, DEMO_ADMIN_CREATORS, queue.decisions);
  const kyc = (c: AdminCreator) => creatorKyc(c, queue.decisions);
  const rows = DEMO_ADMIN_CREATORS.filter((c) => filter === 'all' || kycBucket(kyc(c)) === filter);

  const kycCell = (c: AdminCreator) => {
    const shown = kyc(c);
    const item = c.reviewItemId ? adminReviewItem(c.reviewItemId) : undefined;
    const open = shown === 'In review';
    return (
      <span className={styles.inline}>
        <Tag variant={KYC_TAG[shown]}>{shown}</Tag>
        {c.kycNote && (open || shown === 'Info requested') ? <span className={`${styles.muted} ${styles.small}`}>{c.kycNote}</span> : null}
        {item && queue.ready ? (
          <Button
            size="xs"
            variant={open ? 'secondary' : 'ghost'}
            data-review-action={item.id}
            aria-label={`${open ? 'Review' : 'View decision'}: ${item.subject} KYC`}
            onClick={() => panel.open(item)}
          >
            {open ? 'Review' : 'View'}
          </Button>
        ) : null}
      </span>
    );
  };

  const columns: ReadonlyArray<DataTableColumn<AdminCreator>> = [
    { key: 'name', header: 'Creator', tone: 'strong', width: '22%', cell: (c) => c.name },
    { key: 'platforms', header: 'Platforms', tone: 'muted', width: '16%', cell: (c) => platformList(c.platforms) },
    { key: 'reach', header: 'Reach', width: '12%', cell: (c) => formatCountCompact(c.reach) },
    { key: 'offers', header: 'Live offers', width: '12%', cell: (c) => formatCount(c.liveOffers) },
    { key: 'kyc', header: 'KYC', cell: kycCell },
  ];

  return (
    <>
      <h1 className="sr-only">Admin: creators</h1>
      <KpiStrip columns={4}>
        <KpiCell
          size={32}
          label="Creators"
          value={formatCount(counts.all)}
          meta={`${formatCount(DEMO_ADMIN_ACTIVE_CREATORS)} with a live offer`}
        />
        <KpiCell
          size={32}
          label="KYC verified"
          value={formatCount(counts.Verified)}
          meta={`${formatPct((counts.Verified / counts.all) * 100, { decimals: 1 })} of creators`}
        />
        <KpiCell size={32} label="KYC in review" value={formatCount(counts['In review'])} meta="In the review queue" />
        <KpiCell size={32} label="Not verified" value={formatCount(counts['Not verified'])} meta="Payouts held until KYC" />
      </KpiStrip>

      <AdminSection
        title="Creators"
        titleId="admin-creators-title"
        badge={<DemoBadge variant="mock" />}
        aside={<FilterTags options={CREATOR_FILTERS} value={filter} counts={counts} onChange={setFilter} label="Filter creators by KYC" />}
      >
        <ResponsiveTable
          caption="Creators"
          columns={columns}
          rows={rows}
          rowKey={(c) => c.name}
          empty="No creator in this sample has this KYC status."
          phoneRow={(c) => (
            <StackRow
              title={c.name}
              aside={formatCountCompact(c.reach)}
              meta={`${platformList(c.platforms)} · ${formatCount(c.liveOffers)} live offers`}
              actions={kycCell(c)}
            />
          )}
        />
        <AdminNote>
          Demo sample: {formatCount(rows.length)} of {formatCount(counts[filter])} creators. KYC here is a demo status:
          this build has no KYC provider and verifies no PAN.
        </AdminNote>
      </AdminSection>

      <AdminLive message={queue.announcement} />
      <ReviewDialog item={panel.item} record={panel.record} onClose={panel.close} onDecide={panel.onDecide} onReopen={panel.onReopen} />
    </>
  );
}
