'use client';

/*
 * Admin · Fraud (listed in the handover, not drawn): the design's four
 * signals (device-ID clustering, click-to-conversion under 4s, IP / ASN
 * concentration, install velocity), each with its counts and example
 * subjects, and the open fraud cases reviewed like the 2e queue. TEST demo
 * data (lib/demo/admin.ts). No fraud detection exists in the platform yet:
 * the signals, thresholds and figures are the design's examples.
 */

import type { CSSProperties } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { PageNote } from '@/components/shell/PageBody';
import { Eyebrow, KpiCell, KpiStrip, ProgressBar } from '@/components/ui';
import { ADMIN_QUEUE_TOTALS, ADMIN_REVIEW_ITEMS, DEMO_ADMIN_KPIS, DEMO_FRAUD_HELD_MINOR, DEMO_FRAUD_SIGNALS } from '@/lib/demo/admin';
import { formatCount, formatINRCompactFromMinor, formatPct } from '@/lib/format';
import { AdminLive } from './AdminLive';
import { AdminNote, AdminSection } from './AdminSection';
import { queueCounts, visibleItems } from './queueModel';
import { ReviewDialog } from './ReviewDialog';
import { ReviewQueueTable } from './ReviewQueueTable';
import { useReviewPanel } from './useReviewPanel';
import { useReviewQueue } from './useReviewQueue';
import styles from './AdminPage.module.css';

const FRAUD_ITEMS = visibleItems(ADMIN_REVIEW_ITEMS, 'Fraud');

export function AdminFraud() {
  const queue = useReviewQueue('Fraud');
  const panel = useReviewPanel(queue);
  const counts = queueCounts(ADMIN_QUEUE_TOTALS, FRAUD_ITEMS, queue.decisions);
  const flagged = DEMO_ADMIN_KPIS.flaggedConversions;

  return (
    <>
      <h1 className="sr-only">Admin: fraud</h1>
      <KpiStrip columns={4}>
        <KpiCell size={32} label="Flagged conversions" value={formatCount(flagged)} highlight />
        <KpiCell size={32} label="Open cases" value={formatCount(counts.Fraud)} meta="In the review queue" />
        <KpiCell size={32} label="Payout held" value={formatINRCompactFromMinor(DEMO_FRAUD_HELD_MINOR)} meta="On flagged conversions" />
        <KpiCell size={32} label="Signals" value={formatCount(DEMO_FRAUD_SIGNALS.length)} meta="The design’s example signals" />
      </KpiStrip>

      <section className={styles.band} aria-labelledby="admin-fraud-signals-title">
        <div className={styles.bandHead}>
          <div className={styles.bandLabel}>
            <Eyebrow as="h2" id="admin-fraud-signals-title">
              Signals
            </Eyebrow>
            <DemoBadge variant="mock" className={styles.badge} />
          </div>
          <PageNote className={styles.bandNote}>
            No fraud detection runs in the platform yet. These signals, their thresholds and every figure on this page
            are the design’s examples, shown as TEST demo data. Decisions are kept in this browser; nothing is sent.
          </PageNote>
        </div>
        <ul className={styles.cells} style={{ '--cells': DEMO_FRAUD_SIGNALS.length } as CSSProperties}>
          {DEMO_FRAUD_SIGNALS.map((s, i) => {
            const examples = FRAUD_ITEMS.filter((item) => item.signal === s.id);
            const share = (s.flaggedConversions / flagged) * 100;
            return (
              <li key={s.id} className={styles.cell}>
                <Eyebrow>Signal {String(i + 1).padStart(2, '0')}</Eyebrow>
                <h3 className={styles.cellTitle}>{s.name}</h3>
                <div className={styles.cellFigure}>{formatCount(s.flaggedConversions)}</div>
                <p className={styles.cellMeta}>flagged conversions · {formatCount(s.openCases)} open cases</p>
                <ProgressBar
                  className={styles.cellBar}
                  value={share}
                  label={`${s.name}: share of flagged conversions`}
                  valueText={`${formatPct(share, { decimals: 1 })} of flagged conversions`}
                />
                <p className={styles.cellRule}>{s.rule}</p>
                {examples.length > 0 ? (
                  <>
                    <Eyebrow as="h4" className={styles.examplesLabel}>
                      Example
                    </Eyebrow>
                    <ul className={styles.examples}>
                      {examples.map((e) => (
                        <li key={e.id}>
                          <span className={styles.exampleSubject}>{e.subject}</span>
                          <span className={styles.exampleReason}>{e.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <AdminSection title="Open cases" titleId="admin-fraud-cases-title">
        <ReviewQueueTable
          hideType
          caption="Open fraud cases"
          items={FRAUD_ITEMS}
          decisions={queue.decisions}
          ready={queue.ready}
          onReview={panel.open}
          empty="No fraud case is open."
        />
        <AdminNote>
          Demo sample: {formatCount(FRAUD_ITEMS.length)} shown, {formatCount(counts.Fraud)} open. Approve clears the
          flag; reject means the flagged conversions are never paid.
        </AdminNote>
      </AdminSection>

      <AdminLive message={queue.announcement} />
      <ReviewDialog item={panel.item} record={panel.record} onClose={panel.close} onDecide={panel.onDecide} onReopen={panel.onReopen} />
    </>
  );
}
