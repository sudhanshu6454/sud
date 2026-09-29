'use client';

/*
 * Admin · Brands (listed in the handover, not drawn): plan, wallet and
 * status per brand, in the 2e style. TEST demo data (lib/demo/admin.ts); no
 * v1 endpoint lists brands. A brand in review (its first offer) follows the
 * queue decision and can be reviewed from here.
 */

import { useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Button, KpiCell, KpiStrip, Tag, statusTag, type DataTableColumn } from '@/components/ui';
import {
  DEMO_ADMIN_BRAND_COUNTS,
  DEMO_ADMIN_BRANDS,
  DEMO_ADMIN_PERIOD,
  DEMO_ADMIN_WALLETS_MINOR,
  adminReviewItem,
  type AdminBrand,
} from '@/lib/demo/admin';
import { formatCount, formatINRCompactFromMinor, formatINRFromMinor } from '@/lib/format';
import { PRICING } from '@/lib/site-copy';
import { AdminLive } from './AdminLive';
import { AdminNote, AdminSection } from './AdminSection';
import {
  BRAND_FILTERS,
  brandCounts,
  brandInFilter,
  brandStatus,
  liveOffersLabel,
  type BrandFilter,
  type BrandStatusShown,
} from './adminModel';
import { FilterTags } from './FilterTags';
import { ResponsiveTable, StackRow } from './ResponsiveTable';
import { ReviewDialog } from './ReviewDialog';
import { useReviewPanel } from './useReviewPanel';
import { useReviewQueue } from './useReviewQueue';
import styles from './AdminPage.module.css';

const PLAN_FEE: Record<AdminBrand['plan'], number> = {
  Starter: PRICING.starter.networkFeePct,
  Network: PRICING.network.networkFeePct,
};

const BASE_COUNTS: Record<BrandFilter, number> = {
  all: DEMO_ADMIN_BRAND_COUNTS.all,
  Active: DEMO_ADMIN_BRAND_COUNTS.Active,
  'In review': DEMO_ADMIN_BRAND_COUNTS['In review'],
  Paused: DEMO_ADMIN_BRAND_COUNTS.Paused,
};

export function AdminBrands() {
  const queue = useReviewQueue();
  const panel = useReviewPanel(queue);
  const [filter, setFilter] = useState<BrandFilter>('all');
  const counts = brandCounts(BASE_COUNTS, DEMO_ADMIN_BRANDS, queue.decisions);
  const status = (b: AdminBrand): BrandStatusShown => brandStatus(b, queue.decisions);
  const rows = DEMO_ADMIN_BRANDS.filter((b) => brandInFilter(status(b), filter));
  const month = DEMO_ADMIN_PERIOD.monthShort;

  const statusTagCell = (b: AdminBrand) => {
    const shown = status(b);
    return <Tag variant={shown === 'Rejected' ? 'neutral' : statusTag(shown)}>{shown}</Tag>;
  };

  // Review / View sits in its own trailing Action column, as in 2e.
  const actionCell = (b: AdminBrand) => {
    const shown = status(b);
    const item = b.reviewItemId ? adminReviewItem(b.reviewItemId) : undefined;
    if (!item || !queue.ready) return null;
    return (
      <Button
        size="xs"
        variant={shown === 'In review' ? 'secondary' : 'ghost'}
        data-review-action={item.id}
        aria-label={`${shown === 'In review' ? 'Review' : 'View decision'}: ${item.subject}`}
        onClick={() => panel.open(item)}
      >
        {shown === 'In review' ? 'Review' : 'View'}
      </Button>
    );
  };

  const columns: ReadonlyArray<DataTableColumn<AdminBrand>> = [
    { key: 'name', header: 'Brand', tone: 'strong', width: '19%', cell: (b) => b.name },
    { key: 'category', header: 'Category', tone: 'muted', width: '13%', cell: (b) => b.category },
    { key: 'plan', header: 'Plan', width: '14%', cell: (b) => `${b.plan} · ${PLAN_FEE[b.plan]}% fee` },
    { key: 'wallet', header: 'Wallet', width: '11%', cell: (b) => formatINRFromMinor(b.walletMinor) },
    { key: 'spend', header: `Spend · ${month}`, width: '12%', cell: (b) => formatINRFromMinor(b.spendMinor) },
    { key: 'offers', header: 'Live offers', width: '9%', cell: (b) => formatCount(b.liveOffers) },
    { key: 'status', header: 'Status', width: '12%', cell: statusTagCell },
    { key: 'action', header: 'Action', cell: actionCell },
  ];

  return (
    <>
      <h1 className="sr-only">Admin: brands</h1>
      <KpiStrip columns={4}>
        <KpiCell size={32} label="Brands" value={formatCount(counts.all)} meta={`${formatCount(counts.Active)} active`} />
        <KpiCell
          size={32}
          label="Network plan"
          value={formatCount(DEMO_ADMIN_BRAND_COUNTS.network)}
          meta={`${PRICING.network.networkFeePct}% fee · Starter ${PRICING.starter.networkFeePct}%`}
        />
        <KpiCell size={32} label="Wallet balances" value={formatINRCompactFromMinor(DEMO_ADMIN_WALLETS_MINOR)} meta="Held for brands’ payouts" />
        <KpiCell size={32} label="In review" value={formatCount(counts['In review'])} meta="New brands’ first offers" />
      </KpiStrip>

      <AdminSection
        title="Brands"
        titleId="admin-brands-title"
        badge={<DemoBadge variant="mock" />}
        aside={<FilterTags options={BRAND_FILTERS} value={filter} counts={counts} onChange={setFilter} label="Filter brands" />}
      >
        <ResponsiveTable
          caption="Brands"
          columns={columns}
          rows={rows}
          rowKey={(b) => b.id}
          empty="No brand in this sample has this status."
          phoneRow={(b) => (
            <StackRow
              title={b.name}
              aside={formatINRFromMinor(b.walletMinor)}
              meta={`${b.category} · ${b.plan} · ${formatINRFromMinor(b.spendMinor)} spend in ${month} · ${liveOffersLabel(b.liveOffers)}`}
              actions={
                <span className={styles.inline}>
                  {statusTagCell(b)}
                  {actionCell(b)}
                </span>
              }
            />
          )}
        />
        <AdminNote>
          Demo sample: {formatCount(rows.length)} of {formatCount(counts[filter])} brands. Plan fees are the pricing
          placeholders. Wallet is the brand’s prepaid balance; spend is this month’s creator payouts on every conversion,
          pending ones included (the brand’s own Spend figure); the network fee is billed on approved conversions only.
        </AdminNote>
      </AdminSection>

      <AdminLive message={queue.announcement} />
      <ReviewDialog item={panel.item} record={panel.record} onClose={panel.close} onDecide={panel.onDecide} onReopen={panel.onReopen} />
    </>
  );
}
