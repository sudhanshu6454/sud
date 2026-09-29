'use client';

/*
 * Suspense queue — the live finance-ops page (was /console/suspense). No
 * design artboard: the logic is the HEAD page unchanged (GET /v1/suspense
 * with filters, POST retry / review, demo fallback with <DemoBadge />), set
 * in the admin shell with the Afflino primitives.
 */

import { useEffect, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { PageBody, PageNote } from '@/components/shell/PageBody';
import {
  Banner,
  Button,
  DataTable,
  Field,
  Input,
  PageHeader,
  Select,
  Tag,
  Textarea,
  type DataTableColumn,
} from '@/components/ui';
import {
  ApiError,
  apiFetch,
  withDemoFallback,
  type SuspenseItem,
  type SuspenseListResponse,
  type SuspenseReasonCode,
  type SuspenseRetryResponse,
  type SuspenseReviewResponse,
} from '@/lib/api';
import { formatINR } from '@/lib/format';
import { DEMO_SUSPENSE_ITEMS } from '@/lib/portal-demo';
import styles from './page.module.css';

const REASON_LABELS: Record<SuspenseReasonCode, string> = {
  CLICK_REF_UNMATCHED: 'click ref unmatched',
  NO_CLICK_REF: 'no click ref',
};

interface Filters {
  connector: string;
  programmeId: string;
  from: string;
  to: string;
  reviewed: '' | 'true' | 'false';
}

const EMPTY_FILTERS: Filters = { connector: '', programmeId: '', from: '', to: '', reviewed: '' };

function buildQuery(f: Filters): string {
  const params = new URLSearchParams();
  if (f.connector.trim()) params.set('connector', f.connector.trim());
  if (f.programmeId.trim()) params.set('programme_id', f.programmeId.trim());
  if (f.from) params.set('received_from', new Date(f.from).toISOString());
  if (f.to) params.set('received_to', new Date(f.to).toISOString());
  if (f.reviewed) params.set('reviewed', f.reviewed);
  params.set('limit', '100');
  const qs = params.toString();
  return qs ? `/v1/suspense?${qs}` : '/v1/suspense';
}

export function SuspenseQueue() {
  const [items, setItems] = useState<SuspenseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [demo, setDemo] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowOk, setRowOk] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  async function load(f: Filters) {
    setLoading(true);
    const { value, demo: isDemo } = await withDemoFallback(
      () => apiFetch<SuspenseListResponse>(buildQuery(f)),
      { items: DEMO_SUSPENSE_ITEMS, limit: 100, offset: 0, total: DEMO_SUSPENSE_ITEMS.length },
    );
    setItems(value.items);
    setTotal(value.total);
    setDemo(isDemo);
    setLoading(false);
  }

  useEffect(() => {
    load(EMPTY_FILTERS);
  }, []);

  function flash(msg: string | null, isError: boolean) {
    if (isError) {
      setRowError(msg);
      setRowOk(null);
    } else {
      setRowOk(msg);
      setRowError(null);
    }
  }

  async function onRetry(item: SuspenseItem) {
    setBusyId(item.id);
    try {
      const res = await apiFetch<SuspenseRetryResponse>(`/v1/suspense/${item.id}/retry`, {
        method: 'POST',
      });
      if (res.attributed) {
        flash(`Attributed to click ${res.click_id}.`, false);
      } else {
        flash('Still no matching click — row stays in suspense.', false);
      }
      await load(filters);
    } catch (err) {
      flash(err instanceof ApiError ? err.message : 'Retry failed — try again.', true);
    } finally {
      setBusyId(null);
    }
  }

  async function onReview(item: SuspenseItem) {
    if (reviewNote.trim().length < 10) {
      flash('Review note must be at least 10 characters.', true);
      return;
    }
    setBusyId(item.id);
    try {
      await apiFetch<SuspenseReviewResponse>(`/v1/suspense/${item.id}/review`, {
        method: 'POST',
        body: { note: reviewNote.trim() },
      });
      flash('Marked reviewed.', false);
      setReviewId(null);
      setReviewNote('');
      await load(filters);
    } catch (err) {
      flash(err instanceof ApiError ? err.message : 'Review failed — try again.', true);
    } finally {
      setBusyId(null);
    }
  }

  const columns: ReadonlyArray<DataTableColumn<SuspenseItem>> = [
    {
      key: 'txn',
      header: 'Transaction',
      className: styles.cell,
      cell: (item) => (
        <>
          <div className={styles.txn}>{item.source_transaction_id}</div>
          <div className={styles.muted}>{item.provider_account_id}</div>
          <div className={styles.muted}>
            ref: <span className={styles.mono}>{item.returned_click_ref ?? <em>none</em>}</span>
          </div>
          <button
            className={styles.linkButton}
            type="button"
            aria-expanded={expanded === item.id}
            onClick={() => setExpanded(expanded === item.id ? null : item.id)}
          >
            {expanded === item.id ? 'Hide raw payload' : 'Show raw payload'}
          </button>
          {expanded === item.id && <pre className={styles.raw}>{JSON.stringify(item.raw, null, 2)}</pre>}
        </>
      ),
    },
    {
      key: 'programme',
      header: 'Programme',
      className: styles.cell,
      cell: (item) => (
        <>
          <div>{item.programme_name}</div>
          <div className={styles.muted}>{item.provider_status}</div>
        </>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      className: styles.cell,
      cell: (item) => <Tag variant="outline">{REASON_LABELS[item.reason_code]}</Tag>,
    },
    {
      key: 'order',
      header: 'Order',
      numeric: true,
      className: styles.cell,
      cell: (item) => formatINR(item.eligible_value_minor),
    },
    {
      key: 'commission',
      header: 'Commission',
      numeric: true,
      className: styles.cell,
      cell: (item) => formatINR(item.commission_minor),
    },
    {
      key: 'received',
      header: 'Received',
      className: styles.cell,
      cell: (item) => new Date(item.received_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    },
    {
      key: 'reviewed',
      header: 'Reviewed',
      className: styles.cell,
      cell: (item) =>
        item.reviewed_at ? (
          <>
            <Tag variant="accent">yes</Tag>
            <div className={styles.muted}>{item.review_note}</div>
          </>
        ) : (
          <span className={styles.muted}>no</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: styles.cell,
      cell: (item) => (
        <>
          <div className={styles.actions}>
            <Button
              size="xs"
              disabled={demo || busyId === item.id}
              title={
                item.returned_click_ref
                  ? 'Re-check the click reference against clicks'
                  : 'No click reference on this row — nothing deterministic to retry against'
              }
              onClick={() => onRetry(item)}
            >
              {busyId === item.id ? '…' : 'Retry attribution'}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={demo || busyId === item.id}
              aria-expanded={reviewId === item.id}
              onClick={() => {
                setReviewId(reviewId === item.id ? null : item.id);
                setReviewNote('');
              }}
            >
              Mark reviewed
            </Button>
          </div>
          {reviewId === item.id && (
            <div className={styles.reviewBox}>
              <Field label="Evidence note" hint="What was checked, why it stays unknown (min 10 characters).">
                <Textarea rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
              </Field>
              <Button size="xs" variant="primary" disabled={demo || busyId === item.id} onClick={() => onReview(item)}>
                Save review
              </Button>
            </div>
          )}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Admin · Operations"
        title="Suspense queue"
        description={`Conversions whose provider-returned click reference matched no click (click_id NULL). Finance operations review only — ${total} item${total === 1 ? '' : 's'}.`}
        actions={demo ? <DemoBadge variant="fallback" className={styles.badge} /> : undefined}
      />
      {rowError && <Banner>{rowError}</Banner>}
      {rowOk && <Banner tone="info">{rowOk}</Banner>}
      <PageBody>
        <PageNote>
          Never auto-attribute: unknown attribution stays unknown. Retry binds a click only on an exact
          click-reference match; it never guesses a publisher. Review records a human note and never posts
          ledger entries.{demo && ' Actions are disabled while showing demo data.'}
        </PageNote>

        <form
          className={styles.filters}
          onSubmit={(e) => {
            e.preventDefault();
            load(filters);
          }}
        >
          <Field label="Connector">
            <Input
              compact
              value={filters.connector}
              onChange={(e) => setFilters({ ...filters, connector: e.target.value })}
              placeholder="e.g. stub-network"
            />
          </Field>
          <Field label="Programme ID">
            <Input
              compact
              mono
              value={filters.programmeId}
              onChange={(e) => setFilters({ ...filters, programmeId: e.target.value })}
              placeholder="uuid"
            />
          </Field>
          <Field label="Received from">
            <Input
              compact
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </Field>
          <Field label="Received to">
            <Input compact type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </Field>
          <Field label="Reviewed">
            <Select
              compact
              value={filters.reviewed}
              onChange={(e) => setFilters({ ...filters, reviewed: e.target.value as Filters['reviewed'] })}
              options={[
                { value: '', label: 'All' },
                { value: 'true', label: 'Reviewed' },
                { value: 'false', label: 'Not reviewed' },
              ]}
            />
          </Field>
          <div className={styles.filterActions}>
            <Button variant="primary" type="submit" disabled={loading}>
              {loading ? 'Loading…' : 'Apply filters'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                load(EMPTY_FILTERS);
              }}
            >
              Clear
            </Button>
          </div>
        </form>

        <DataTable
          className={styles.table}
          caption="Suspense items"
          columns={columns}
          rows={items}
          rowKey={(item) => item.id}
          empty={loading ? 'Loading…' : 'No suspense items match these filters.'}
        />
      </PageBody>
    </>
  );
}
