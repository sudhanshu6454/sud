'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  RIGHTS_GATES,
  getLook,
  loadLooks,
  saveLooks,
  stateLabel,
  type ConsoleLook,
} from '../../../../lib/console';
import { getProduct } from '../../../../lib/mock-data';
import styles from './page.module.css';

export default function MatchReviewPage({ params }: { params: { id: string } }) {
  const [looks, setLooks] = useState<ConsoleLook[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLooks(loadLooks());
    setLoaded(true);
  }, []);

  const look = useMemo(
    () => (loaded ? getLook(params.id, looks) : undefined),
    [loaded, looks, params.id],
  );

  function update(next: ConsoleLook[]) {
    setLooks(next);
    saveLooks(next);
  }

  function setVerdict(productId: string, verdict: 'exact' | 'similar') {
    if (!look) return;
    update(
      looks.map((l) =>
        l.id === look.id
          ? {
              ...l,
              candidates: l.candidates.map((c) =>
                c.productId === productId ? { ...c, verdict } : c,
              ),
            }
          : l,
      ),
    );
  }

  function setEvidence(productId: string, evidence: string) {
    if (!look) return;
    update(
      looks.map((l) =>
        l.id === look.id
          ? {
              ...l,
              candidates: l.candidates.map((c) =>
                c.productId === productId ? { ...c, evidence } : c,
              ),
            }
          : l,
      ),
    );
  }

  function toggleRight(gateId: string) {
    if (!look) return;
    update(
      looks.map((l) =>
        l.id === look.id
          ? { ...l, rights: { ...l.rights, [gateId]: !l.rights[gateId] } }
          : l,
      ),
    );
  }

  function setState(state: ConsoleLook['state']) {
    if (!look) return;
    update(
      looks.map((l) =>
        l.id === look.id ? { ...l, state, updatedAt: new Date().toISOString() } : l,
      ),
    );
  }

  if (!loaded) return <p className={styles.loading}>Loading…</p>;
  if (!look) {
    return (
      <div>
        <h1 className={styles.heading}>Look not found</h1>
        <p>
          <Link href="/console">← Back to console</Link>
        </p>
      </div>
    );
  }

  const allDecided = look.candidates.every((c) => c.verdict !== null);
  // ENFORCED: "exact" verdicts require non-empty evidence before approval.
  const exactMissingEvidence = look.candidates.some(
    (c) => c.verdict === 'exact' && c.evidence.trim() === '',
  );
  const rightsDone = RIGHTS_GATES.every((g) => look.rights[g.id]);
  const canApprove = allDecided && !exactMissingEvidence && rightsDone;

  return (
    <div>
      <p className={styles.back}>
        <Link href="/console">← Pipeline</Link>
      </p>
      <h1 className={styles.heading}>Product match review</h1>
      <p className={styles.sub}>
        <strong>{look.title}</strong> — {look.sourcePage} · {stateLabel(look.state)}
      </p>

      <h2 className={styles.sectionTitle}>Candidate products</h2>
      <div className={styles.candidates}>
        {look.candidates.map((c) => {
          const product = getProduct(c.productId);
          const needsEvidence = c.verdict === 'exact' && c.evidence.trim() === '';
          return (
            <div key={c.productId} className={styles.candidate}>
              <p className={styles.productName}>
                {product ? `${product.brand} — ${product.model}` : c.productId}
              </p>
              {product && (
                <p className={styles.productMeta}>
                  {product.merchant} · {product.match}
                </p>
              )}
              <div className={styles.radios} role="radiogroup" aria-label="Match verdict">
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name={`verdict-${c.productId}`}
                    checked={c.verdict === 'exact'}
                    onChange={() => setVerdict(c.productId, 'exact')}
                  />
                  Exact item
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name={`verdict-${c.productId}`}
                    checked={c.verdict === 'similar'}
                    onChange={() => setVerdict(c.productId, 'similar')}
                  />
                  Similar style
                </label>
              </div>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  Evidence {c.verdict === 'exact' && '(required for exact)'}
                </span>
                <textarea
                  value={c.evidence}
                  onChange={(e) => setEvidence(c.productId, e.target.value)}
                  className={styles.textarea}
                  rows={2}
                  placeholder="What proves this is the exact item?"
                />
              </label>
              {needsEvidence && (
                <p className={styles.warning} role="alert">
                  Evidence is required for an “exact” verdict.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <h2 className={styles.sectionTitle}>Rights checklist</h2>
      <div className={styles.rights}>
        {RIGHTS_GATES.map((g) => (
          <label key={g.id} className={styles.gate}>
            <input
              type="checkbox"
              checked={!!look.rights[g.id]}
              onChange={() => toggleRight(g.id)}
            />
            <span>{g.label}</span>
          </label>
        ))}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.approve}
          disabled={!canApprove}
          title={
            canApprove
              ? 'Move to commercial review'
              : 'Decide every candidate, add evidence for exact matches, and complete the rights checklist'
          }
          onClick={() => setState('commercial_review')}
        >
          Approve — send to commercial review
        </button>
        <button
          type="button"
          className={styles.reject}
          onClick={() => setState('draft')}
        >
          Reject — back to draft
        </button>
      </div>
      {!canApprove && (
        <p className={styles.blocked}>
          Approval is blocked until every candidate has a verdict, every “exact”
          verdict has evidence, and the rights checklist is complete.
        </p>
      )}
    </div>
  );
}
