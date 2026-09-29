'use client';

/*
 * Brand conversions (not drawn; README data model: pending / approved /
 * rejected / flagged). Month totals per status, a status filter, the latest
 * conversions with Approve / Reject on pending rows (a reason is mandatory
 * to reject) and "Export CSV" of the rows shown. TEST demo: no brand
 * conversions endpoint exists in v1; decisions are kept in this browser and
 * move no money.
 */

import { useRef, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import {
  Button,
  Dialog,
  Field,
  KpiCell,
  KpiStrip,
  PageHeader,
  Select,
  StatusTag,
  TagButton,
  Textarea,
  cx,
} from '@/components/ui';
import { PLATFORM_NAME } from '@/lib/demo/afflino';
import {
  DEMO_BRAND_PERIOD,
  DEMO_CONVERSION_COUNTS,
  DEMO_CONVERSIONS,
  type ConversionStatus,
  type DemoConversion,
} from '@/lib/demo/brand';
import { downloadCsv } from '@/lib/download';
import { formatCount, formatDayMonth, formatINRFromMinor } from '@/lib/format';
import { VALIDATION_WINDOW_DAYS } from '@/lib/site-copy';
import {
  REJECT_REASONS,
  adjustCounts,
  applyDecisions,
  buildConversionsCsv,
  canDecide,
  rejectionText,
  timeOfDay,
  validateBy,
  validateRejection,
  windowDays,
  type ConversionDecision,
} from './conversionsModel';
import { StackTable, type StackColumn } from './StackTable';
import { STORAGE_KEYS, usePartition } from './storage';
import { useBrandWorkspace } from './workspace';
import shared from './shared.module.css';
import styles from './BrandConversions.module.css';

type Filter = 'All' | ConversionStatus;
const FILTERS: Filter[] = ['All', 'Pending', 'Approved', 'Rejected', 'Flagged'];


export function BrandConversions() {
  const ws = useBrandWorkspace();
  const { value: decisions, ready, update } = usePartition<Record<string, ConversionDecision>>(STORAGE_KEYS.conversions, ws.key, {});
  const [filter, setFilter] = useState<Filter>('All');
  const [notice, setNotice] = useState('');
  const [rejecting, setRejecting] = useState<DemoConversion | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);

  const rows = applyDecisions(DEMO_CONVERSIONS, decisions);
  const counts = adjustCounts(DEMO_CONVERSION_COUNTS, DEMO_CONVERSIONS, decisions);
  const total = counts.Approved + counts.Pending + counts.Rejected + counts.Flagged;
  const visible = filter === 'All' ? rows : rows.filter((r) => r.status === filter);

  const approve = (row: DemoConversion) => {
    update((prev) => ({ ...prev, [row.id]: { status: 'Approved' } }));
    setNotice(`${row.id} approved.`);
  };

  const openReject = (row: DemoConversion) => {
    setRejecting(row);
    setReason('');
    setNote('');
    setRejectError(null);
  };

  const confirmReject = () => {
    if (!rejecting) return;
    const error = validateRejection(reason, note);
    if (error) {
      setRejectError(error);
      reasonRef.current?.focus();
      return;
    }
    const text = rejectionText(reason, note);
    update((prev) => ({ ...prev, [rejecting.id]: { status: 'Rejected', reason: text } }));
    setNotice(`${rejecting.id} rejected: ${text}.`);
    setRejecting(null);
  };

  const exportCsv = () => {
    downloadCsv(
      `afflino-demo-conversions${filter === 'All' ? '' : `-${filter.toLowerCase()}`}.csv`,
      buildConversionsCsv(visible),
    );
    setNotice(`Exported ${visible.length} ${visible.length === 1 ? 'row' : 'rows'} (TEST demo data).`);
  };

  const columns: ReadonlyArray<StackColumn<DemoConversion>> = [
    {
      key: 'at',
      header: 'Time',
      primary: true,
      nowrap: true,
      cell: (r) => (
        <span className={styles.time}>
          {formatDayMonth(r.at, { pad: true })}
          <span className={styles.muted}> · {timeOfDay(r.at)}</span>
        </span>
      ),
    },
    { key: 'id', header: 'Conversion', tone: 'mono', nowrap: true, hideMd: true, cell: (r) => <span className={styles.id}>{r.id}</span> },
    {
      key: 'creator',
      header: 'Creator',
      cell: (r) => (
        <span className={styles.stack}>
          <span className={styles.strong}>{r.creator}</span>
          <span className={styles.muted}>{PLATFORM_NAME[r.platform]}</span>
        </span>
      ),
    },
    {
      key: 'offer',
      header: 'Offer · sub-ID',
      label: 'Offer',
      cell: (r) => (
        <span className={styles.stack}>
          <span>{r.offer}</span>
          <span className={cx(styles.muted, styles.mono)}>{r.subId}</span>
        </span>
      ),
    },
    { key: 'payout', header: 'Payout', numeric: true, nowrap: true, cell: (r) => formatINRFromMinor(r.payoutMinor) },
    {
      key: 'status',
      header: 'Status',
      cell: (r) => (
        <span className={styles.status}>
          <StatusTag status={r.status} />
          {r.status === 'Pending' ? (
            <span className={styles.muted}>Validate by {formatDayMonth(validateBy(r.at, windowDays(r.offer)), { pad: true })}</span>
          ) : r.reason ? (
            <span className={r.status === 'Flagged' ? styles.flag : styles.muted}>{r.reason}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Action',
      actions: true,
      cell: (r) =>
        canDecide(r) ? (
          <div className={styles.rowActions}>
            <Button size="xs" variant="secondary" onClick={() => approve(r)} aria-label={`Approve ${r.id}`}>
              Approve
            </Button>
            <Button size="xs" variant="ghost" onClick={() => openReject(r)} aria-label={`Reject ${r.id}`}>
              Reject
            </Button>
          </div>
        ) : r.status === 'Flagged' ? (
          <span className={styles.muted}>Fraud review</span>
        ) : null,
    },
  ];

  const loading = !ready;

  return (
    <>
      <PageHeader
        eyebrow={`${ws.name} · ${DEMO_BRAND_PERIOD.month}`}
        title="Conversions"
        actions={
          <>
            <DemoBadge variant="mock" className={shared.badge} />
            <Button variant="secondary" onClick={exportCsv} className={styles.touch} disabled={loading}>
              Export CSV
            </Button>
          </>
        }
      />
      <KpiStrip columns={4} className={shared.kpis}>
        <KpiCell label="Approved" value={formatCount(counts.Approved)} meta="Billed at the offer’s payout" loading={loading} />
        <KpiCell
          label="Pending"
          value={formatCount(counts.Pending)}
          meta={`Inside the ${VALIDATION_WINDOW_DAYS}-day validation window`}
          loading={loading}
        />
        <KpiCell label="Rejected" value={formatCount(counts.Rejected)} meta="Not billed" loading={loading} />
        <KpiCell label="Flagged" value={formatCount(counts.Flagged)} meta="Held for fraud review" highlight loading={loading} />
      </KpiStrip>
      <div className={shared.filters} role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <TagButton key={f} selected={filter === f} onClick={() => setFilter(f)} className={styles.filterTag}>
            {f} · {loading ? '—' : formatCount(f === 'All' ? total : counts[f])}
          </TagButton>
        ))}
        <span className={cx(shared.filtersEnd, styles.showing)}>Latest {visible.length} shown</span>
      </div>
      <p role="status" aria-live="polite" className={cx(shared.notice, styles.notice, !notice && shared.noticeEmpty)}>
        {notice}
      </p>
      <div className={styles.body}>
        {loading ? (
          <div className={styles.skeleton} aria-busy="true" aria-label="Loading conversions">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={styles.skelRow} />
            ))}
          </div>
        ) : (
          <StackTable
            columns={columns}
            rows={visible}
            rowKey={(r) => r.id}
            caption={`Latest conversions${filter === 'All' ? '' : `, ${filter}`}`}
            empty={<span>No {filter.toLowerCase()} conversions among the latest rows.</span>}
          />
        )}
        <p className={shared.demoNote}>
          Demo: approvals and rejections are kept in this browser and move no money. The month totals above
          include them.
        </p>
      </div>

      <Dialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={`Reject ${rejecting?.id ?? ''}?`}
        initialFocusRef={reasonRef}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmReject}>
              Reject conversion
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <p className={styles.dialogCopy}>
            {rejecting ? `${rejecting.creator} · ${rejecting.offer} · ${formatINRFromMinor(rejecting.payoutMinor)}. ` : ''}
            A rejected conversion is not billed and the creator is not paid for it. The creator sees the reason.
          </p>
          <Field label="Reason" error={rejectError && !REJECT_REASONS.includes(reason) ? rejectError : undefined} required>
            <Select
              ref={reasonRef}
              value={reason}
              placeholder="Choose a reason"
              required
              onChange={(e) => {
                setReason(e.target.value);
                setRejectError(null);
              }}
              options={REJECT_REASONS.map((r) => ({ value: r, label: r }))}
            />
          </Field>
          <Field
            label="Note"
            labelSuffix={reason === 'Other' ? undefined : '(optional)'}
            error={rejectError && REJECT_REASONS.includes(reason) ? rejectError : undefined}
          >
            <Textarea value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
