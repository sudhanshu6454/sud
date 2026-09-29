'use client';

/*
 * Disputes — the live missing-commission tickets page that was
 * /portal/disputes. No design artboard: the logic is the HEAD page unchanged
 * (GET /v1/disputes with a demo fallback and <DemoBadge />, POST /v1/disputes
 * to file; filing is disabled on demo data), laid out on the system's
 * 5fr / 7fr grid (as 3c) with the tickets in the standard table. A ticket
 * never creates a payable sale (platform invariant 10).
 */

import { useEffect, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { formatLongDate, disputeStatusTag, humanise, shortTicketId } from '@/components/creator/payouts/labels';
import { PageNote } from '@/components/shell/PageBody';
import {
  Button,
  DataTable,
  EmptyState,
  Eyebrow,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Tag,
  cx,
  type DataTableColumn,
} from '@/components/ui';
import { ApiError, apiFetch, withDemoFallback, type Dispute, type DisputeKind, type OpenDisputeBody } from '@/lib/api';
import { DEMO_DISPUTES } from '@/lib/portal-demo';
import styles from './page.module.css';

const KINDS: { value: DisputeKind; label: string }[] = [
  { value: 'missing_commission', label: 'Missing commission (sale never reported)' },
  { value: 'wrong_amount', label: 'Wrong commission amount' },
  { value: 'unattributed_click', label: 'Click not attributed' },
  { value: 'other', label: 'Other' },
];

const KIND_SHORT: Record<DisputeKind, string> = {
  missing_commission: 'Missing commission',
  wrong_amount: 'Wrong amount',
  unattributed_click: 'Click not attributed',
  other: 'Other',
};

/** Demo fallback rows reshaped onto the v1 Dispute type. */
function demoDisputes(): Dispute[] {
  return DEMO_DISPUTES.map((d) => ({
    id: d.id,
    conversion_id: d.conversion,
    publisher_id: null,
    kind: 'other' as DisputeKind,
    subject: d.reason,
    claim_ref: null,
    status: d.status,
    evidence: null,
    resolution_note: null,
    created_at: d.filed,
  }));
}

const COLUMNS: ReadonlyArray<DataTableColumn<Dispute>> = [
  { key: 'filed', header: 'Filed', width: '17%', className: cx(styles.top, styles.filed), cell: (d) => formatLongDate(d.created_at) },
  {
    key: 'ticket',
    header: 'Ticket',
    className: styles.top,
    cell: (d) => (
      <>
        <span className={styles.subject}>{d.subject}</span>
        <span className={styles.meta}>
          {shortTicketId(d.id)}
          <span className={styles.phoneKind}> · {KIND_SHORT[d.kind] ?? humanise(d.kind)}</span>
          {d.claim_ref ? ` · ref ${d.claim_ref}` : ''}
          {d.conversion_id ? ` · conversion ${d.conversion_id}` : ''}
        </span>
        {d.resolution_note ? <span className={styles.meta}>Resolution: {d.resolution_note}</span> : null}
      </>
    ),
  },
  { key: 'kind', header: 'Kind', width: '19%', tone: 'muted', className: styles.top, cell: (d) => KIND_SHORT[d.kind] ?? humanise(d.kind) },
  {
    key: 'status',
    header: 'Status',
    width: '14%',
    className: styles.top,
    cell: (d) => <Tag variant={disputeStatusTag(d.status)}>{humanise(d.status)}</Tag>,
  },
];

const SKELETON_COLUMNS: ReadonlyArray<DataTableColumn<number>> = COLUMNS.map((c) => ({
  key: c.key,
  header: c.header,
  width: c.width,
  cell: () => <Skeleton width={c.key === 'ticket' ? '80%' : '60%'} height={14} inline />,
}));

export function Disputes() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [demo, setDemo] = useState(false);
  const [kind, setKind] = useState<DisputeKind>('missing_commission');
  const [subject, setSubject] = useState('');
  const [claimRef, setClaimRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState(false);

  async function load() {
    const { value, demo: isDemo } = await withDemoFallback(() => apiFetch<Dispute[]>('/v1/disputes'), demoDisputes());
    setDisputes(value);
    setDemo(isDemo);
    setLoaded(true);
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubjectError(null);
    setFormOk(false);
    if (subject.trim().length === 0) {
      setSubjectError('Describe the missing commission first.');
      return;
    }
    setSubmitting(true);
    try {
      const body: OpenDisputeBody = {
        kind,
        subject: subject.trim(),
        ...(claimRef.trim() ? { claim_ref: claimRef.trim() } : {}),
      };
      await apiFetch<Dispute>('/v1/disputes', { method: 'POST', body });
      setSubject('');
      setClaimRef('');
      setFormOk(true);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not file the ticket — try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Payouts"
        title="Disputes"
        description="Missing-commission tickets and support claims."
        actions={
          <>
            {demo ? <DemoBadge variant="fallback" className={styles.badge} /> : null}
            <Button href="/app/payouts" arrow="left">
              Payouts
            </Button>
          </>
        }
      />

      <div className={styles.grid}>
        <section className={styles.formCell} aria-labelledby="disputes-form-title">
          <Eyebrow as="h2" id="disputes-form-title" className={styles.cellLabel}>
            Open a ticket
          </Eyebrow>
          <form onSubmit={onSubmit} className={styles.form} noValidate>
            <Field label="Kind">
              <Select value={kind} onChange={(e) => setKind(e.target.value as DisputeKind)} options={KINDS} />
            </Field>
            <Field label="What happened" error={subjectError ?? undefined}>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Order #48210 on 2026-09-20 never appeared in earnings"
                maxLength={300}
              />
            </Field>
            <Field
              label="Merchant order reference"
              labelSuffix="(optional)"
              hint="claim_ref — helps the network team match provider records."
            >
              <Input mono value={claimRef} onChange={(e) => setClaimRef(e.target.value)} maxLength={200} />
            </Field>
            {formError && (
              <p className={styles.error} role="alert">
                {formError}
              </p>
            )}
            {formOk && (
              <p className={styles.ok} role="status">
                Ticket filed — the network team will review it.
              </p>
            )}
            <div>
              <Button type="submit" variant="primary" arrow disabled={submitting || demo}>
                {submitting ? 'Filing…' : 'File ticket'}
              </Button>
            </div>
            {demo && <p className={styles.hint}>Filing is disabled in demo mode — connect the API to file real tickets.</p>}
          </form>
          <PageNote className={styles.note}>
            A ticket alone never creates a payable sale. Resolving one requires the network team to verify the claim
            against provider records — screenshots alone are not enough.
          </PageNote>
        </section>

        <section className={styles.listCell} aria-labelledby="disputes-list-title">
          <Eyebrow as="h2" id="disputes-list-title" className={styles.cellLabel}>
            Tickets{loaded ? ` · ${disputes.length}` : ''}
          </Eyebrow>
          {!loaded ? (
            <DataTable
              className={styles.table}
              columns={SKELETON_COLUMNS}
              rows={[0, 1, 2]}
              rowKey={(r) => String(r)}
              caption="Tickets (loading)"
            />
          ) : disputes.length === 0 ? (
            <EmptyState action={{ label: 'Back to payouts', href: '/app/payouts' }}>No tickets yet.</EmptyState>
          ) : (
            <DataTable
              className={styles.table}
              columns={COLUMNS}
              rows={disputes}
              rowKey={(d) => d.id}
              caption="Tickets: filed date, subject, kind and status"
            />
          )}
        </section>
      </div>
    </>
  );
}
