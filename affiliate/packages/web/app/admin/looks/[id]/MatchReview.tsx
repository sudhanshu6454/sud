'use client';

/*
 * Product match review — was /console/looks/[id]. No design artboard: the
 * logic is the HEAD page unchanged (verdict per candidate, evidence required
 * for "exact", rights checklist, approve → commercial review / reject →
 * draft; local, lib/console.ts), set in the admin shell with the Afflino
 * primitives. TEST demo looks and products.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { PageBody, PageSection } from '@/components/shell/PageBody';
import { Button, Checkbox, EmptyState, Field, PageHeader, Segmented, Skeleton, Textarea } from '@/components/ui';
import { RIGHTS_GATES, getLook, loadLooks, saveLooks, stateLabel, type ConsoleLook } from '@/lib/console';
import { getProduct } from '@/lib/mock-data';
import styles from './page.module.css';

type Verdict = 'exact' | 'similar';

const VERDICTS = [
  { value: 'exact', label: 'Exact item' },
  { value: 'similar', label: 'Similar style' },
] as const;

export function MatchReview({ id }: { id: string }) {
  const [looks, setLooks] = useState<ConsoleLook[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLooks(loadLooks());
    setLoaded(true);
  }, []);

  const look = useMemo(() => (loaded ? getLook(id, looks) : undefined), [loaded, looks, id]);

  function update(next: ConsoleLook[]) {
    setLooks(next);
    saveLooks(next);
  }

  function setVerdict(productId: string, verdict: Verdict) {
    if (!look) return;
    update(
      looks.map((l) =>
        l.id === look.id
          ? { ...l, candidates: l.candidates.map((c) => (c.productId === productId ? { ...c, verdict } : c)) }
          : l,
      ),
    );
  }

  function setEvidence(productId: string, evidence: string) {
    if (!look) return;
    update(
      looks.map((l) =>
        l.id === look.id
          ? { ...l, candidates: l.candidates.map((c) => (c.productId === productId ? { ...c, evidence } : c)) }
          : l,
      ),
    );
  }

  function toggleRight(gateId: string) {
    if (!look) return;
    update(looks.map((l) => (l.id === look.id ? { ...l, rights: { ...l.rights, [gateId]: !l.rights[gateId] } } : l)));
  }

  function setState(state: ConsoleLook['state']) {
    if (!look) return;
    update(looks.map((l) => (l.id === look.id ? { ...l, state, updatedAt: new Date().toISOString() } : l)));
  }

  if (!loaded) {
    return (
      <>
        <PageHeader eyebrow="Admin · Editorial" title="Product match review" />
        <PageBody>
          <Skeleton height={120} />
        </PageBody>
      </>
    );
  }

  if (!look) {
    return (
      <>
        <PageHeader eyebrow="Admin · Editorial" title="Look not found" />
        <PageBody>
          <EmptyState action={{ label: 'Back to the pipeline', href: '/admin/looks' }}>
            No look with this id is saved in this browser.
          </EmptyState>
        </PageBody>
      </>
    );
  }

  const allDecided = look.candidates.every((c) => c.verdict !== null);
  // ENFORCED: "exact" verdicts require non-empty evidence before approval.
  const exactMissingEvidence = look.candidates.some((c) => c.verdict === 'exact' && c.evidence.trim() === '');
  const rightsDone = RIGHTS_GATES.every((g) => look.rights[g.id]);
  const canApprove = allDecided && !exactMissingEvidence && rightsDone;

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin/looks" className={styles.back}>
              ← Pipeline
            </Link>{' '}
            · Admin · Editorial
          </>
        }
        title="Product match review"
        description={
          <>
            <strong>{look.title}</strong> — {look.sourcePage} · {stateLabel(look.state)}
          </>
        }
        actions={<DemoBadge variant="mock" className={styles.badge} />}
      />
      <PageBody>
        <PageSection>Candidate products</PageSection>
        <div className={styles.candidates}>
          {look.candidates.map((c) => {
            const product = getProduct(c.productId);
            const needsEvidence = c.verdict === 'exact' && c.evidence.trim() === '';
            return (
              <div key={c.productId} className={styles.candidate}>
                <p className={styles.productName}>{product ? `${product.brand} — ${product.model}` : c.productId}</p>
                {product && (
                  <p className={styles.productMeta}>
                    {product.merchant} · {product.match}
                  </p>
                )}
                <Field label="Match verdict">
                  <Segmented<string>
                    block
                    name={`verdict-${c.productId}`}
                    value={c.verdict ?? ''}
                    options={VERDICTS}
                    onChange={(v) => setVerdict(c.productId, v as Verdict)}
                  />
                </Field>
                <Field
                  label="Evidence"
                  labelSuffix={c.verdict === 'exact' ? '(required for exact)' : undefined}
                  error={needsEvidence ? 'Evidence is required for an “exact” verdict.' : undefined}
                >
                  <Textarea
                    value={c.evidence}
                    onChange={(e) => setEvidence(c.productId, e.target.value)}
                    rows={2}
                    placeholder="What proves this is the exact item?"
                  />
                </Field>
              </div>
            );
          })}
        </div>

        <PageSection>Rights checklist</PageSection>
        <div className={styles.rights}>
          {RIGHTS_GATES.map((g) => (
            <Checkbox key={g.id} checked={!!look.rights[g.id]} onChange={() => toggleRight(g.id)}>
              {g.label}
            </Checkbox>
          ))}
        </div>

        <div className={styles.actions}>
          <Button
            variant="primary"
            arrow
            disabled={!canApprove}
            title={
              canApprove
                ? 'Move to commercial review'
                : 'Decide every candidate, add evidence for exact matches, and complete the rights checklist'
            }
            onClick={() => setState('commercial_review')}
          >
            Approve — send to commercial review
          </Button>
          <Button onClick={() => setState('draft')}>Reject — back to draft</Button>
        </div>
        {!canApprove && (
          <p className={styles.blocked}>
            Approval is blocked until every candidate has a verdict, every “exact” verdict has evidence, and the
            rights checklist is complete.
          </p>
        )}
      </PageBody>
    </>
  );
}
