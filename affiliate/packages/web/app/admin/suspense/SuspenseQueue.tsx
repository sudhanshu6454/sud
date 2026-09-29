'use client';

/*
 * Suspense queue — the live finance-ops page (was /console/suspense). No
 * design artboard: GET /v1/suspense with filters, POST retry / review, demo
 * fallback with <DemoBadge />, set in the admin shell with the Afflino
 * primitives; on phones the table is a stacked list
 * (components/admin/ResponsiveTable).
 *
 * Signed out (no token) it shows the demo rows without calling the API. An
 * unreachable API is the "API unreachable" badge; an answer the API gave
 * (401, 403 for a role outside finance, 5xx) is a Banner. A filter the API
 * rejects (400) is an inline error that keeps the rows already shown.
 * Amounts print in each row's own currency, never rounded; the date filters
 * and the Received column are India time. Only the newest load writes the
 * table (a slower, older response is dropped).
 */

import { useEffect, useRef, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { FallbackBanner } from '@/components/FallbackBanner';
import { ResponsiveTable, StackRow } from '@/components/admin/ResponsiveTable';
import {
  EMPTY_SUSPENSE_FILTERS as EMPTY_FILTERS,
  retryBlockedReason,
  suspenseQuery as buildQuery,
  suspenseReasonLabel,
  type SuspenseFilters as Filters,
} from '@/components/admin/suspenseModel';
import { AdminSection } from '@/components/admin/AdminSection';
import { PageNote } from '@/components/shell/PageBody';
import {
  Banner,
  Button,
  Field,
  Input,
  Select,
  Tag,
  Textarea,
  type DataTableColumn,
} from '@/components/ui';
import {
  ApiError,
  apiFetch,
  fallbackKind,
  fallbackNotice,
  getToken,
  isUnreachable,
  withDemoFallback,
  type FallbackNotice,
  type SuspenseItem,
  type SuspenseListResponse,
  type SuspenseRetryResponse,
  type SuspenseReviewResponse,
} from '@/lib/api';
import { formatDayMonthTime, formatMoneyExact } from '@/lib/format';
import { DEMO_SUSPENSE_ITEMS } from '@/lib/portal-demo';
import styles from './page.module.css';

const DEMO_LIST: SuspenseListResponse = {
  items: DEMO_SUSPENSE_ITEMS,
  limit: 100,
  offset: 0,
  total: DEMO_SUSPENSE_ITEMS.length,
};

/** Why the page shows demo rows (null: live). */
type DemoCause = 'signed-out' | 'unreachable' | 'answered';

export function SuspenseQueue() {
  const [items, setItems] = useState<SuspenseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [demo, setDemo] = useState(false);
  const [demoCause, setDemoCause] = useState<DemoCause | null>(null);
  const [notice, setNotice] = useState<FallbackNotice | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const request = useRef(0);
  // True while the table shows live rows (a rejected filter then keeps them).
  const showingLive = useRef(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowOk, setRowOk] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  function showDemo(cause: DemoCause, why: FallbackNotice | null) {
    showingLive.current = false;
    setItems(DEMO_LIST.items);
    setTotal(DEMO_LIST.total);
    setDemo(true);
    setDemoCause(cause);
    setNotice(why);
  }

  async function load(f: Filters) {
    const id = ++request.current;
    setFilterError(null);
    if (!getToken()) {
      showDemo('signed-out', null);
      return;
    }
    setLoading(true);
    const { value, demo: isDemo, error } = await withDemoFallback(
      () => apiFetch<SuspenseListResponse>(buildQuery(f)),
      DEMO_LIST,
    );
    if (id !== request.current) return; // a newer load (filters, retry, review) was started meanwhile
    setLoading(false);
    if (!isDemo) {
      showingLive.current = true;
      setItems(value.items);
      setTotal(value.total);
      setDemo(false);
      setDemoCause(null);
      setNotice(null);
      return;
    }
    // A filter the API rejects keeps the live rows already on screen.
    if (fallbackKind(error) === 'invalid' && showingLive.current) {
      setFilterError(`The API rejected these filters: ${error?.message ?? 'invalid request'}. The rows below are unchanged.`);
      return;
    }
    showDemo(isUnreachable(error) ? 'unreachable' : 'answered', fallbackNotice(error, 'the suspense queue'));
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

  const rawToggle = (item: SuspenseItem) => (
    <>
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
  );

  const reviewed = (item: SuspenseItem) =>
    item.reviewed_at ? (
      <>
        <span>Yes</span>
        <div className={styles.muted}>{item.review_note}</div>
      </>
    ) : (
      <span>No</span>
    );

  const received = (item: SuspenseItem) => formatDayMonthTime(item.received_at);
  const money = (minor: number, item: SuspenseItem) => formatMoneyExact(minor, item.currency);

  const actions = (item: SuspenseItem) => {
    const blocked = retryBlockedReason(item.returned_click_ref);
    const blockedId = `retry-blocked-${item.id}`;
    return (
    <>
      <div className={styles.actions}>
        <Button
          size="xs"
          disabled={demo || busyId === item.id || Boolean(blocked)}
          aria-describedby={blocked ? blockedId : undefined}
          title={blocked ? undefined : 'Re-check the click reference against clicks'}
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
      {blocked ? (
        <p id={blockedId} className={styles.blocked}>
          {blocked}
        </p>
      ) : null}
    </>
    );
  };

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
          {rawToggle(item)}
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
      cell: (item) => <Tag>{suspenseReasonLabel(item.reason_code)}</Tag>,
    },
    {
      key: 'order',
      header: 'Order',
      numeric: true,
      className: styles.cell,
      cell: (item) => money(item.eligible_value_minor, item),
    },
    {
      key: 'commission',
      header: 'Commission',
      numeric: true,
      className: styles.cell,
      cell: (item) => money(item.commission_minor, item),
    },
    {
      key: 'received',
      header: 'Received',
      className: `${styles.cell} ${styles.nowrap}`,
      cell: received,
    },
    {
      key: 'reviewed',
      header: 'Reviewed',
      className: styles.cell,
      cell: reviewed,
    },
    {
      key: 'actions',
      header: 'Actions',
      className: styles.cell,
      cell: actions,
    },
  ];

  // Phones (≤760px): one stacked row per item instead of eight columns.
  const phoneRow = (item: SuspenseItem) => (
    <StackRow
      eyebrow={<Tag>{suspenseReasonLabel(item.reason_code)}</Tag>}
      title={item.source_transaction_id}
      aside={money(item.commission_minor, item)}
      meta={
        <>
          <div>
            {item.programme_name} · {item.provider_status} · order {money(item.eligible_value_minor, item)}
          </div>
          <div>
            {item.provider_account_id} · ref:{' '}
            <span className={styles.mono}>{item.returned_click_ref ?? <em>none</em>}</span>
          </div>
          <div>Received {received(item)}</div>
          <div className={styles.phoneReviewed}>Reviewed: {reviewed(item)}</div>
          {rawToggle(item)}
        </>
      }
      actions={<div className={styles.phoneActions}>{actions(item)}</div>}
    />
  );

  return (
    <>
      {/* The admin template (2e and its siblings): no page header, the badge
          by the section label, the page note directly under it. */}
      <h1 className="sr-only">Admin: suspense queue</h1>
      <FallbackBanner notice={notice} />
      {rowError && <Banner>{rowError}</Banner>}
      {rowOk && <Banner tone="info">{rowOk}</Banner>}
      <AdminSection
        title={`Suspense queue · ${total} item${total === 1 ? '' : 's'}`}
        titleId="admin-suspense-title"
        badge={
          demo ? (
            <DemoBadge variant={demoCause === 'unreachable' ? 'fallback' : 'mock'} className={styles.badge} />
          ) : undefined
        }
      >
        <div className={styles.stack}>
          <PageNote>
            Conversions whose provider-returned click reference matched no click (click_id NULL), for finance
            operations review. Never auto-attribute: unknown attribution stays unknown. Retry binds a click only on an
            exact click-reference match; it never guesses a publisher. Review records a human note and never posts
            ledger entries.
            {demoCause === 'signed-out'
              ? ' Actions are disabled while showing demo data: sign in with a finance token to work the live queue.'
              : demo
                ? ' Actions are disabled while showing demo data.'
                : ''}
          </PageNote>

          <form
            className={styles.filters}
            onSubmit={(e) => {
              e.preventDefault();
              // A new query: the last row action's message no longer applies.
              setRowOk(null);
              setRowError(null);
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
            {filterError ? (
              <p className={styles.filterError} role="alert">
                {filterError}
              </p>
            ) : null}
            <div className={styles.filterActions}>
              <Button variant="primary" type="submit" disabled={loading}>
                {loading ? 'Loading…' : 'Apply filters'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setRowOk(null);
                  setRowError(null);
                  load(EMPTY_FILTERS);
                }}
              >
                Clear
              </Button>
            </div>
          </form>

          <ResponsiveTable
            className={styles.table}
            caption="Suspense items"
            columns={columns}
            rows={items}
            rowKey={(item) => item.id}
            empty={loading ? 'Loading…' : 'No suspense items match these filters.'}
            phoneRow={phoneRow}
          />
        </div>
      </AdminSection>
    </>
  );
}
