'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import DemoBadge from '../../../components/DemoBadge';
import { formatINR } from '../../../lib/format';
import {
  DEMO_DISPUTES,
  DEMO_LEDGER,
  DEMO_PLACEMENTS,
  DEMO_PROGRAMMES,
  DEMO_PROPERTIES,
} from '../../../lib/portal-demo';
import styles from './page.module.css';

export default function StatementsPage() {
  const [programme, setProgramme] = useState('');
  const [property, setProperty] = useState('');
  const [placement, setPlacement] = useState('');

  const filtered = useMemo(
    () =>
      DEMO_LEDGER.filter(
        (e) =>
          (programme === '' || e.programme === programme) &&
          (property === '' || e.property === property) &&
          (placement === '' || e.placement === placement),
      ),
    [programme, property, placement],
  );

  // Running balance: entries are newest-first; reverse for chronological accrual.
  const rows = useMemo(() => {
    let running = 0;
    const chronological = [...filtered].reverse();
    const withBalance = chronological.map((e) => {
      running += e.amount_minor;
      return { ...e, running };
    });
    return withBalance.reverse();
  }, [filtered]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filtered) {
      map.set(e.currency, (map.get(e.currency) ?? 0) + e.amount_minor);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div>
      <h1 className={styles.heading}>Statements</h1>
      <p className={styles.sub}>
        Ledger drilldown — conversions and adjustments with a running balance.
      </p>
      <DemoBadge variant="mock" />
      <p className={styles.hint}>
        Demo data only — no statement/ledger endpoint exists in the v1 surface yet.
      </p>

      <div className={styles.filters}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Programme</span>
          <select
            value={programme}
            onChange={(e) => {
              setProgramme(e.target.value);
              setProperty('');
              setPlacement('');
            }}
            className={styles.select}
          >
            <option value="">All programmes</option>
            {DEMO_PROGRAMMES.map((p) => (
              <option key={p.id} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Property</span>
          <select
            value={property}
            onChange={(e) => {
              setProperty(e.target.value);
              setPlacement('');
            }}
            className={styles.select}
            disabled={programme === ''}
          >
            <option value="">All properties</option>
            {DEMO_PROPERTIES.map((p) => (
              <option key={p.id} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Placement</span>
          <select
            value={placement}
            onChange={(e) => setPlacement(e.target.value)}
            className={styles.select}
            disabled={property === ''}
          >
            <option value="">All placements</option>
            {DEMO_PLACEMENTS.map((p) => (
              <option key={p.id} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.totals}>
        {totals.map(([currency, total]) => (
          <div key={currency} className={styles.totalCard}>
            <p className={styles.totalLabel}>{currency} total</p>
            <p className={styles.totalValue}>{formatINR(total)}</p>
          </div>
        ))}
        {totals.length === 0 && (
          <p className={styles.empty}>No entries match these filters.</p>
        )}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Entry</th>
              <th>Kind</th>
              <th>Amount</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td>
                  <span className={styles.entryLabel}>{e.label}</span>
                  <span className={styles.entryMeta}>
                    {e.programme} · {e.property} · {e.placement}
                  </span>
                </td>
                <td className={styles.kind}>{e.kind}</td>
                <td className={e.amount_minor < 0 ? styles.negative : styles.positive}>
                  {e.amount_minor < 0 ? '−' : '+'}
                  {formatINR(Math.abs(e.amount_minor))}
                </td>
                <td>{formatINR(e.running)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className={styles.sectionTitle}>Dispute history</h2>
      <DemoBadge variant="mock" />
      <div className={styles.disputes}>
        {DEMO_DISPUTES.map((d) => (
          <div key={d.id} className={styles.dispute}>
            <div className={styles.disputeHead}>
              <strong>{d.id}</strong>
              <span className={`${styles.disputeStatus} ${styles[d.status]}`}>
                {d.status}
              </span>
            </div>
            <p className={styles.disputeText}>
              Conversion {d.conversion} — {d.reason}
            </p>
            <p className={styles.disputeMeta}>Filed {d.filed}</p>
          </div>
        ))}
      </div>
      <p className={styles.disputeNote}>
        Note: a screenshot alone does not create a payable sale. Disputes are
        decided against click, conversion and ledger evidence — attach the
        relevant evidence when filing.
      </p>

      <p className={styles.back}>
        <Link href="/portal">← Back to dashboard</Link>
      </p>
    </div>
  );
}
