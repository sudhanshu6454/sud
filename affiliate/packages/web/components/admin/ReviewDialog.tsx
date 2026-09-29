'use client';

/*
 * The review panel (2e "Review"): the item's facts, what each decision
 * would do, a note, and Approve / Reject / Request info. Rejecting needs a
 * note (inline accent-700 error). A decided item shows its decision and can
 * be reopened. TEST demo: nothing is sent; decisions stay in this browser.
 */

import { useEffect, useRef, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Button, Dialog, Field, Textarea } from '@/components/ui';
import type { AdminReviewItem } from '@/lib/demo/admin';
import type { ReviewType } from '@/lib/demo/afflino';
import { NOTE_MAX_LENGTH, type Decision, type DecisionRecord } from './queueModel';
import { DecisionTag, TypeTag } from './ReviewQueueTable';
import type { DecideResult } from './useReviewQueue';
import styles from './ReviewDialog.module.css';

/** What a decision would do in the product, per item type. */
const EFFECT: Record<ReviewType, Record<Decision, string>> = {
  Offer: {
    approved: 'The offer (or the change) goes live for creators.',
    rejected: 'The offer stays off the network; the brand sees your note.',
    info_requested: 'The offer stays in review until the brand answers your note.',
  },
  KYC: {
    approved: 'The creator’s KYC is accepted and held payouts can be released.',
    rejected: 'KYC is refused; the creator is asked to submit again and payouts stay held.',
    info_requested: 'Payouts stay held until the creator answers your note.',
  },
  Fraud: {
    approved: 'The flag is cleared; the conversions go back to the brand’s validation.',
    rejected: 'The flagged conversions are rejected and never paid.',
    info_requested: 'The case stays open; the creator is asked to explain the traffic.',
  },
};

const ACTION_LABEL: Record<Decision, string> = {
  approved: 'Approve',
  rejected: 'Reject',
  info_requested: 'Request info',
};

export interface ReviewDialogProps {
  item: AdminReviewItem | null;
  record: DecisionRecord | undefined;
  onClose: () => void;
  onDecide: (item: AdminReviewItem, decision: Decision, note: string) => DecideResult;
  onReopen: (item: AdminReviewItem) => void;
}

function decidedAtLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ReviewDialog({ item, record, onClose, onDecide, onReopen }: ReviewDialogProps) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setNote('');
    setError(undefined);
    // Reopened: the Reopen button is gone, so the note takes focus.
    if (item && !record) noteRef.current?.focus();
  }, [item, record]);

  if (!item) return null;

  function decide(decision: Decision) {
    if (!item) return;
    const result = onDecide(item, decision, note);
    if (!result.ok) {
      setError(result.message);
      noteRef.current?.focus();
    }
  }

  const effects = EFFECT[item.type];

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`${item.type} review`}
      actions={
        record ? (
          <>
            <Button variant="secondary" className={styles.button} onClick={() => onReopen(item)}>
              Reopen
            </Button>
            <Button variant="primary" className={styles.button} onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" className={styles.button} onClick={() => decide('info_requested')}>
              {ACTION_LABEL.info_requested}
            </Button>
            <Button variant="secondary" className={styles.button} onClick={() => decide('rejected')}>
              {ACTION_LABEL.rejected}
            </Button>
            <Button variant="primary" className={styles.button} onClick={() => decide('approved')}>
              {ACTION_LABEL.approved}
            </Button>
          </>
        )
      }
    >
      <div className={styles.body}>
        <div className={styles.meta}>
          <TypeTag type={item.type} />
          <span className={styles.age}>In the queue for {item.age}</span>
          <DemoBadge variant="mock" className={styles.badge} />
        </div>
        <div>
          <p className={styles.subject}>{item.subject}</p>
          <p className={styles.reason}>{item.reason}</p>
        </div>

        {item.details.length > 0 ? (
          <dl className={styles.facts}>
            {item.details.map((d) => (
              <div key={d.label} className={styles.fact}>
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {record ? (
          <div className={styles.decision}>
            <div className={styles.decisionHead}>
              <DecisionTag decision={record.decision} />
              <span className={styles.age}>{decidedAtLabel(record.decidedAt)}</span>
            </div>
            <p className={styles.effect}>{effects[record.decision]}</p>
            {record.note ? <p className={styles.noteText}>“{record.note}”</p> : null}
          </div>
        ) : (
          <>
            <ul className={styles.effects} aria-label="What each decision does">
              {(['approved', 'rejected', 'info_requested'] as const).map((d) => (
                <li key={d}>
                  <span className={styles.effectLabel}>{ACTION_LABEL[d]}:</span> {effects[d]}
                </li>
              ))}
            </ul>
            <Field label="Note" labelSuffix="(required to reject)" error={error}>
              <Textarea
                ref={noteRef}
                rows={3}
                maxLength={NOTE_MAX_LENGTH}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (error) setError(undefined);
                }}
                placeholder="What you checked, and why"
              />
            </Field>
          </>
        )}
        <p className={styles.demo}>Demo: nothing is sent to the API. The decision is kept in this browser.</p>
      </div>
    </Dialog>
  );
}
