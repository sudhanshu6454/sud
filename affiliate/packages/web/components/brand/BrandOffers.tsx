'use client';

/*
 * Brand offers (not drawn): every offer with its status in the flow
 * Draft → In review → Live → Paused / Ended (or Rejected), the builder's
 * local drafts and submissions first. Row actions follow the status
 * (offerModel STATUS_ACTIONS). TEST demo: no brand-offer endpoint exists, so
 * the list and every action live in this browser.
 */

import { useMemo, useRef, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Button, Dialog, EmptyState, PageHeader, StatusTag, Tag, TagButton, cx } from '@/components/ui';
import { platformList } from '@/lib/demo/afflino';
import type { BrandOfferStatus } from '@/lib/demo/brand';
import { formatCount, formatDayMonth, formatINRFromMinor } from '@/lib/format';
import { ACTION_LABEL, MODEL_TAG, OFFER_PLATFORMS, STATUS_ACTIONS, STATUS_ORDER, rowPayoutLabel, type OfferAction } from './offerModel';
import { StackTable, type StackColumn } from './StackTable';
import { useBrandOffers, type OfferRow } from './useBrandOffers';
import { useBrandWorkspace } from './workspace';
import shared from './shared.module.css';
import styles from './BrandOffers.module.css';

type Filter = 'All' | BrandOfferStatus;

type Pending = { row: OfferRow; action: 'end' | 'delete' } | null;

const DONE: Record<'withdraw' | 'pause' | 'resume' | 'end', (name: string) => string> = {
  withdraw: (n) => `${n} is back in Draft. Submit it again when it is ready.`,
  pause: (n) => `${n} is paused. Resume it to put it back in front of creators.`,
  resume: (n) => `${n} is live again.`,
  end: (n) => `${n} has ended. Duplicate it to run it again.`,
};

export function BrandOffers() {
  const ws = useBrandWorkspace();
  const offers = useBrandOffers(ws.key);
  const [filter, setFilter] = useState<Filter>('All');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const counts = useMemo(() => {
    const c: Record<BrandOfferStatus, number> = { Draft: 0, 'In review': 0, Live: 0, Paused: 0, Ended: 0, Rejected: 0 };
    for (const r of offers.rows) c[r.status] += 1;
    return c;
  }, [offers.rows]);

  const visible = filter === 'All' ? offers.rows : offers.rows.filter((r) => r.status === filter);

  const run = (row: OfferRow, action: OfferAction) => {
    if (action === 'end' || action === 'delete') {
      setPending({ row, action });
      return;
    }
    if (action === 'withdraw' || action === 'pause' || action === 'resume') {
      if (offers.act(row, action)) setNotice(DONE[action](row.name));
    }
  };

  const confirm = () => {
    if (!pending) return;
    const { row, action } = pending;
    if (action === 'end') {
      if (offers.act(row, 'end')) setNotice(DONE.end(row.name));
    } else {
      offers.remove(row);
      setNotice(`${row.name} was deleted.`);
    }
    setPending(null);
  };

  const actionCell = (row: OfferRow) => (
    <div className={styles.rowActions}>
      {STATUS_ACTIONS[row.status].map((action) => {
        const label = ACTION_LABEL[action];
        const name = `${label} ${row.name}`;
        if (action === 'edit') {
          return (
            <Button key={action} size="xs" variant="secondary" href={ws.href(`/brand/offers/new?draft=${encodeURIComponent(row.id)}`)} aria-label={name}>
              {label}
            </Button>
          );
        }
        if (action === 'duplicate') {
          return (
            <Button key={action} size="xs" variant="secondary" href={ws.href(`/brand/offers/new?duplicate=${encodeURIComponent(row.id)}`)} aria-label={name}>
              {label}
            </Button>
          );
        }
        return (
          <Button
            key={action}
            size="xs"
            variant={action === 'delete' || action === 'end' ? 'ghost' : 'secondary'}
            onClick={() => run(row, action)}
            aria-label={name}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );

  const columns: ReadonlyArray<StackColumn<OfferRow>> = [
    {
      key: 'offer',
      header: 'Offer',
      primary: true,
      width: '26%',
      cell: (r) => (
        <div className={styles.offerCell}>
          <span className={styles.offerName}>{r.name}</span>
          <span className={styles.offerEvent}>{r.event || 'No conversion event yet'}</span>
          {r.status === 'Rejected' && r.rejectionReason ? (
            <span className={styles.reason}>Rejected: {r.rejectionReason}</span>
          ) : null}
        </div>
      ),
    },
    { key: 'model', header: 'Model', cell: (r) => <Tag variant={MODEL_TAG[r.model]}>{r.model}</Tag> },
    { key: 'payout', header: 'Payout', nowrap: true, cell: (r) => rowPayoutLabel(r) },
    {
      key: 'budget',
      header: 'Budget cap',
      numeric: true,
      nowrap: true,
      cell: (r) => (r.budgetMinor > 0 ? formatINRFromMinor(r.budgetMinor) : '—'),
    },
    { key: 'platforms', header: 'Platforms', tone: 'muted', hideMd: true, cell: (r) => platformList(OFFER_PLATFORMS.filter((p) => r.platforms.includes(p))) || '—' },
    { key: 'window', header: 'Window', nowrap: true, hideMd: true, cell: (r) => `${r.validationDays} days` },
    { key: 'status', header: 'Status', cell: (r) => <StatusTag status={r.status} /> },
    { key: 'updated', header: 'Updated', tone: 'muted', nowrap: true, hideMd: true, cell: (r) => formatDayMonth(r.updated, { pad: true }) },
    { key: 'actions', header: <span className="sr-only">Actions</span>, actions: true, cell: actionCell },
  ];

  const filters: Filter[] = ['All', ...STATUS_ORDER];

  return (
    <>
      <PageHeader
        eyebrow={`${ws.name} · Offers`}
        title={offers.ready ? `${formatCount(counts.Live)} live · ${formatCount(offers.rows.length)} offers` : 'Offers'}
        actions={
          <>
            <DemoBadge variant="mock" className={shared.badge} />
            <Button variant="primary" arrow href={ws.href('/brand/offers/new')} className={styles.touch}>
              New offer
            </Button>
          </>
        }
      />
      <div className={shared.filters} role="group" aria-label="Filter by status">
        {filters.map((f) => (
          <TagButton key={f} selected={filter === f} onClick={() => setFilter(f)} className={styles.filterTag}>
            {f} · {offers.ready ? (f === 'All' ? offers.rows.length : counts[f]) : '—'}
          </TagButton>
        ))}
        <div className={shared.filtersEnd}>
          <Button
            variant="ghost"
            className={styles.touch}
            onClick={() => {
              offers.reset();
              setFilter('All');
              setNotice('Demo offers reset: this browser’s drafts and submissions were removed.');
            }}
          >
            Reset demo
          </Button>
        </div>
      </div>
      <p role="status" aria-live="polite" className={cx(shared.notice, styles.notice, !notice && shared.noticeEmpty)}>
        {notice}
      </p>
      <div className={styles.body}>
        {!offers.ready ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="Loading offers">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={styles.skelRow} />
            ))}
          </div>
        ) : offers.rows.length === 0 ? (
          <EmptyState title="No offers yet." action={{ label: 'New offer', href: ws.href('/brand/offers/new') }}>
            List your first offer and creators can start promoting it once it is approved.
          </EmptyState>
        ) : (
          <StackTable
            columns={columns}
            rows={visible}
            rowKey={(r) => r.id}
            caption={`Offers${filter === 'All' ? '' : `, ${filter}`}`}
            empty={
              <EmptyState action={{ label: 'New offer', href: ws.href('/brand/offers/new') }}>
                No offers are {filter === 'All' ? 'listed' : `in ${filter}`}.
              </EmptyState>
            }
          />
        )}
        <p className={shared.demoNote}>
          Demo: offers you create are kept in this browser. Admin review (In review → Live or Rejected) is not
          simulated.
        </p>
      </div>

      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        alert
        initialFocusRef={confirmRef}
        title={pending?.action === 'end' ? `End ${pending.row.name}?` : `Delete ${pending?.row.name ?? ''}?`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button ref={confirmRef} variant="primary" onClick={confirm}>
              {pending?.action === 'end' ? 'End offer' : 'Delete'}
            </Button>
          </>
        }
      >
        {pending?.action === 'end'
          ? 'An ended offer cannot be resumed. Duplicate it to run it again.'
          : 'This removes the offer from this browser. It cannot be undone.'}
      </Dialog>
    </>
  );
}
