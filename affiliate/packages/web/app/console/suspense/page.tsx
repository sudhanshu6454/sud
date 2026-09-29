'use client';

import { useEffect, useState } from 'react';
import DemoBadge from '../../../components/DemoBadge';
import {
  ApiError,
  apiFetch,
  withDemoFallback,
  type SuspenseItem,
  type SuspenseListResponse,
  type SuspenseReasonCode,
  type SuspenseRetryResponse,
  type SuspenseReviewResponse,
} from '../../../lib/api';
import { DEMO_SUSPENSE_ITEMS } from '../../../lib/portal-demo';
import { formatINR } from '../../../lib/format';
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

export default function SuspenseQueuePage() {
  const [items, setItems] = useState<SuspenseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [demo, setDemo] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowOk, setRowOk] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  async function load(f: Filters) {
    setLoading(true);
    setPageError(null);
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
      flash(
        err instanceof ApiError ? err.message : 'Retry failed — try again.',
        true,
      );
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
      flash(
        err instanceof ApiError ? err.message : 'Review failed — try again.',
        true,
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className={styles.heading}>Suspense queue</h1>
      <p className={styles.sub}>
        Conversions whose provider-returned click reference matched no click
        (click_id NULL). Finance operations review only — {total} item{total === 1 ? '' : 's'}.
      </p>
      {demo && <DemoBadge variant="fallback" />}

      <p className={styles.policyNote}>
        Never auto-attribute: unknown attribution stays unknown. Retry binds a
        click only on an exact click-reference match; it never guesses a
        publisher. Review records a human note and never posts ledger entries.
        {demo && ' Actions are disabled while showing demo data.'}
      </p>

      <form
        className={styles.filters}
        onSubmit={(e) => {
          e.preventDefault();
          load(filters);
        }}
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Connector</span>
          <input
            className={styles.input}
            value={filters.connector}
            onChange={(e) => setFilters({ ...filters, connector: e.target.value })}
            placeholder="e.g. stub-network"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Programme ID</span>
          <input
            className={styles.input}
            value={filters.programmeId}
            onChange={(e) => setFilters({ ...filters, programmeId: e.target.value })}
            placeholder="uuid"
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Received from</span>
          <input
            className={styles.input}
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Received to</span>
          <input
            className={styles.input}
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ ...filters, to: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Reviewed</span>
          <select
            className={styles.input}
            value={filters.reviewed}
            onChange={(e) =>
              setFilters({ ...filters, reviewed: e.target.value as Filters['reviewed'] })
            }
          >
            <option value="">All</option>
            <option value="true">Reviewed</option>
            <option value="false">Not reviewed</option>
          </select>
        </label>
        <div className={styles.filterActions}>
          <button className={styles.button} type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Apply filters'}
          </button>
          <button
            className={styles.buttonSecondary}
            type="button"
            onClick={() => {
              setFilters(EMPTY_FILTERS);
              load(EMPTY_FILTERS);
            }}
          >
            Clear
          </button>
        </div>
      </form>

      {pageError && <p className={styles.error}>{pageError}</p>}
      {rowError && <p className={styles.error}>{rowError}</p>}
      {rowOk && <p className={styles.ok}>{rowOk}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Transaction</th>
              <th>Programme</th>
              <th>Reason</th>
              <th>Order</th>
              <th>Commission</th>
              <th>Received</th>
              <th>Reviewed</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className={styles.txn}>{item.source_transaction_id}</div>
                  <div className={styles.muted}>{item.provider_account_id}</div>
                  <div className={styles.muted}>
                    ref: {item.returned_click_ref ?? <em>none</em>}
                  </div>
                  <button
                    className={styles.linkButton}
                    type="button"
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  >
                    {expanded === item.id ? 'hide raw payload' : 'show raw payload'}
                  </button>
                  {expanded === item.id && (
                    <pre className={styles.raw}>
                      {JSON.stringify(item.raw, null, 2)}
                    </pre>
                  )}
                </td>
                <td>
                  <div>{item.programme_name}</div>
                  <div className={styles.muted}>{item.provider_status}</div>
                </td>
                <td>
                  <span className={styles.reason}>{REASON_LABELS[item.reason_code]}</span>
                </td>
                <td>{formatINR(item.eligible_value_minor)}</td>
                <td>{formatINR(item.commission_minor)}</td>
                <td>
                  {new Date(item.received_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </td>
                <td>
                  {item.reviewed_at ? (
                    <div>
                      <span className={styles.reviewedYes}>yes</span>
                      <div className={styles.muted}>{item.review_note}</div>
                    </div>
                  ) : (
                    <span className={styles.muted}>no</span>
                  )}
                </td>
                <td>
                  <div className={styles.actions}>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={demo || busyId === item.id}
                      title={
                        item.returned_click_ref
                          ? 'Re-check the click reference against clicks'
                          : 'No click reference on this row — nothing deterministic to retry against'
                      }
                      onClick={() => onRetry(item)}
                    >
                      {busyId === item.id ? '…' : 'Retry attribution'}
                    </button>
                    <button
                      className={styles.buttonSecondary}
                      type="button"
                      disabled={demo || busyId === item.id}
                      onClick={() => {
                        setReviewId(reviewId === item.id ? null : item.id);
                        setReviewNote('');
                      }}
                    >
                      Mark reviewed
                    </button>
                  </div>
                  {reviewId === item.id && (
                    <div className={styles.reviewBox}>
                      <textarea
                        className={styles.input}
                        rows={3}
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        placeholder="Evidence note — what was checked, why it stays unknown (min 10 chars)"
                      />
                      <button
                        className={styles.button}
                        type="button"
                        disabled={demo || busyId === item.id}
                        onClick={() => onReview(item)}
                      >
                        Save review
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className={styles.empty}>
                  No suspense items match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
