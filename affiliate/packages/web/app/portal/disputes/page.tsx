'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import DemoBadge from '../../../components/DemoBadge';
import {
  ApiError,
  apiFetch,
  withDemoFallback,
  type Dispute,
  type DisputeKind,
  type OpenDisputeBody,
} from '../../../lib/api';
import { DEMO_DISPUTES } from '../../../lib/portal-demo';
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

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [demo, setDemo] = useState(false);
  const [kind, setKind] = useState<DisputeKind>('missing_commission');
  const [subject, setSubject] = useState('');
  const [claimRef, setClaimRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState(false);

  async function load() {
    const { value, demo: isDemo } = await withDemoFallback(
      () => apiFetch<Dispute[]>('/v1/disputes'),
      demoDisputes(),
    );
    setDisputes(value);
    setDemo(isDemo);
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormOk(false);
    if (subject.trim().length === 0) {
      setFormError('Describe the missing commission first.');
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
      setFormError(
        err instanceof ApiError ? err.message : 'Could not file the ticket — try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className={styles.heading}>Disputes</h1>
      <p className={styles.sub}>Missing-commission tickets and support claims.</p>
      {demo && <DemoBadge variant="fallback" />}

      <p className={styles.policyNote}>
        A ticket alone never creates a payable sale. Resolving one requires the
        network team to verify the claim against provider records — screenshots
        alone are not enough.
      </p>

      <h2 className={styles.sectionTitle}>Open a ticket</h2>
      <form onSubmit={onSubmit} className={styles.form}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as DisputeKind)}
            className={styles.select}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>What happened</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={styles.input}
            placeholder="e.g. Order #48210 on 2026-09-20 never appeared in earnings"
            maxLength={300}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Merchant order reference (optional)</span>
          <input
            value={claimRef}
            onChange={(e) => setClaimRef(e.target.value)}
            className={styles.input}
            placeholder="claim_ref — helps the network team match provider records"
            maxLength={200}
          />
        </label>
        {formError && <p className={styles.error}>{formError}</p>}
        {formOk && <p className={styles.ok}>Ticket filed — the network team will review it.</p>}
        <button type="submit" className={styles.button} disabled={submitting || demo}>
          {submitting ? 'Filing…' : 'File ticket'}
        </button>
        {demo && (
          <p className={styles.hint}>
            Filing is disabled in demo mode — connect the API to file real tickets.
          </p>
        )}
      </form>

      <h2 className={styles.sectionTitle}>Tickets</h2>
      {disputes.length === 0 ? (
        <p className={styles.empty}>No tickets yet.</p>
      ) : (
        <div className={styles.list}>
          {disputes.map((d) => (
            <div key={d.id} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={`${styles.status} ${styles[d.status]}`}>{d.status}</span>
                <span className={styles.kind}>{d.kind.replace(/_/g, ' ')}</span>
              </div>
              <p className={styles.subject}>{d.subject}</p>
              <p className={styles.meta}>
                {d.claim_ref ? `ref ${d.claim_ref} · ` : ''}
                filed {new Date(d.created_at).toLocaleDateString('en-IN')}
                {d.resolution_note ? ` · resolution: ${d.resolution_note}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className={styles.back}>
        <Link href="/portal">← Back to portal</Link>
      </p>
    </div>
  );
}
