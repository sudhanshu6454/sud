'use client';

/*
 * Disputes — the live missing-commission tickets page that was
 * /portal/disputes. No design artboard: the logic is the HEAD page unchanged
 * (GET /v1/disputes with a demo fallback and <DemoBadge />, POST /v1/disputes
 * to file; filing is disabled on demo data), set in the app shell with the
 * Afflino primitives. A ticket never creates a payable sale (platform
 * invariant 10).
 */

import { useEffect, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { PageBody, PageNote, PageSection } from '@/components/shell/PageBody';
import { Button, EmptyState, Field, Input, PageHeader, Select, StatusTag } from '@/components/ui';
import { ApiError, apiFetch, withDemoFallback, type Dispute, type DisputeKind, type OpenDisputeBody } from '@/lib/api';
import { DEMO_DISPUTES } from '@/lib/portal-demo';
import styles from './page.module.css';

const KINDS: { value: DisputeKind; label: string }[] = [
  { value: 'missing_commission', label: 'Missing commission (sale never reported)' },
  { value: 'wrong_amount', label: 'Wrong commission amount' },
  { value: 'unattributed_click', label: 'Click not attributed' },
  { value: 'other', label: 'Other' },
];

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
        actions={demo ? <DemoBadge variant="fallback" className={styles.badge} /> : undefined}
      />
      <PageBody>
        <PageNote>
          A ticket alone never creates a payable sale. Resolving one requires the network team to verify the claim
          against provider records — screenshots alone are not enough.
        </PageNote>

        <PageSection>Open a ticket</PageSection>
        <form onSubmit={onSubmit} className={styles.form}>
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

        <PageSection>Tickets</PageSection>
        {!loaded ? null : disputes.length === 0 ? (
          <EmptyState>No tickets yet.</EmptyState>
        ) : (
          <ul className={styles.list}>
            {disputes.map((d) => (
              <li key={d.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <StatusTag status={d.status.replace(/_/g, ' ')} />
                  <span className={styles.kind}>{d.kind.replace(/_/g, ' ')}</span>
                </div>
                <p className={styles.subject}>{d.subject}</p>
                <p className={styles.meta}>
                  {d.claim_ref ? `ref ${d.claim_ref} · ` : ''}
                  filed {new Date(d.created_at).toLocaleDateString('en-IN')}
                  {d.resolution_note ? ` · resolution: ${d.resolution_note}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </>
  );
}
