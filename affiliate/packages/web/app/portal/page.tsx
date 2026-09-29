'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import DemoBadge from '../../components/DemoBadge';
import {
  apiFetch,
  getPublisherId,
  withDemoFallback,
  type EarningsResponse,
} from '../../lib/api';
import { formatINR } from '../../lib/format';
import { DEMO_CONVERSIONS, DEMO_EARNINGS, DEMO_STATS } from '../../lib/portal-demo';
import styles from './page.module.css';

const ZERO = { pending: 0, approved: 0, collected: 0, payable: 0 };

export default function PortalDashboard() {
  const [earnings, setEarnings] = useState<EarningsResponse | null>(null);
  const [demoEarnings, setDemoEarnings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pid = getPublisherId();
    withDemoFallback(
      () => apiFetch<EarningsResponse>(`/v1/publisher/earnings?publisher_id=${pid}`),
      DEMO_EARNINGS,
    ).then(({ value, demo }) => {
      if (cancelled) return;
      if (!demo && value.publisher_id !== pid) {
        // Defensive: tenant mismatch between stored id and returned data.
        setError('Publisher id mismatch in API response.');
        setEarnings(DEMO_EARNINGS);
        setDemoEarnings(true);
      } else {
        setEarnings(value);
        setDemoEarnings(demo);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const bucket = earnings?.balances['INR'] ?? ZERO;

  const cards = [
    { label: 'Clicks', value: DEMO_STATS.clicks.toLocaleString('en-IN'), demo: true },
    { label: 'Matched transactions', value: DEMO_STATS.matchedTransactions.toLocaleString('en-IN'), demo: true },
    { label: 'Pending commission', value: formatINR(bucket.pending), demo: demoEarnings },
    { label: 'Approved commission', value: formatINR(bucket.approved), demo: demoEarnings },
    { label: 'Collected commission', value: formatINR(bucket.collected), demo: demoEarnings },
    { label: 'Payable', value: formatINR(bucket.payable), demo: demoEarnings },
    { label: 'Paid', value: formatINR(DEMO_STATS.paid_minor), demo: true },
  ];

  return (
    <div>
      <h1 className={styles.heading}>Publisher portal</h1>
      <p className={styles.sub}>Earnings, links and statements for your properties.</p>
      {(demoEarnings || error) && <DemoBadge variant="fallback" />}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.cardGrid}>
        {cards.map((c) => (
          <div key={c.label} className={styles.card}>
            <p className={styles.cardLabel}>{c.label}</p>
            <p className={styles.cardValue}>{c.value}</p>
            {c.demo && <p className={styles.cardDemo}>demo</p>}
          </div>
        ))}
      </div>

      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Recent conversions</h2>
        <DemoBadge variant="mock" />
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Date</th>
              <th>Product</th>
              <th>Commission</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {DEMO_CONVERSIONS.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>{c.date}</td>
                <td>{c.product}</td>
                <td>{formatINR(c.commission_minor)}</td>
                <td>
                  <span className={`${styles.status} ${styles[c.status]}`}>{c.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.hint}>
        No conversions endpoint in the v1 surface yet — this table is demo data.
      </p>

      <div className={styles.navRow}>
        <Link href="/portal/links" className={styles.navCard}>
          <strong>Link builder</strong>
          <span>Create tracked /r/ links</span>
        </Link>
        <Link href="/portal/statements" className={styles.navCard}>
          <strong>Statements</strong>
          <span>Ledger drilldown &amp; disputes</span>
        </Link>
        <Link href="/portal/disputes" className={styles.navCard}>
          <strong>Disputes</strong>
          <span>Missing-commission tickets</span>
        </Link>
      </div>
    </div>
  );
}
