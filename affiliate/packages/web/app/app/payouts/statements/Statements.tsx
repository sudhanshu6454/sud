'use client';

/*
 * Statements — the ledger drilldown that was /portal/statements. No v1
 * statement / ledger endpoint exists yet, so the page is TEST demo data
 * (lib/portal-demo.ts) with <DemoBadge />; the logic (cascading filters,
 * running balance, per-currency totals, dispute history) is the HEAD page
 * unchanged, set in the app shell with the Afflino primitives.
 */

import { useMemo, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { PageBody, PageNote, PageSection } from '@/components/shell/PageBody';
import { DataTable, Field, KpiCell, KpiStrip, PageHeader, Select, StatusTag, type DataTableColumn } from '@/components/ui';
import { formatCount, formatINR } from '@/lib/format';
import {
  DEMO_DISPUTES,
  DEMO_LEDGER,
  DEMO_PLACEMENTS,
  DEMO_PROGRAMMES,
  DEMO_PROPERTIES,
  type DemoLedgerEntry,
} from '@/lib/portal-demo';
import styles from './page.module.css';

type Row = DemoLedgerEntry & { running: number };

const COLUMNS: ReadonlyArray<DataTableColumn<Row>> = [
  { key: 'date', header: 'Date', className: styles.cell, numeric: true },
  {
    key: 'entry',
    header: 'Entry',
    className: styles.cell,
    cell: (e) => (
      <>
        <span className={styles.entryLabel}>{e.label}</span>
        <span className={styles.entryMeta}>
          {e.programme} · {e.property} · {e.placement}
        </span>
      </>
    ),
  },
  { key: 'kind', header: 'Kind', className: styles.cell, tone: 'muted' },
  {
    key: 'amount',
    header: 'Amount',
    numeric: true,
    className: styles.cell,
    cell: (e) => (
      <span className={e.amount_minor < 0 ? styles.negative : undefined}>
        {e.amount_minor < 0 ? '−' : '+'}
        {formatINR(Math.abs(e.amount_minor))}
      </span>
    ),
  },
  { key: 'balance', header: 'Balance', numeric: true, tone: 'strong', className: styles.cell, cell: (e) => formatINR(e.running) },
];

export function Statements() {
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
  const rows = useMemo<Row[]>(() => {
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
    <>
      <PageHeader
        eyebrow="Payouts"
        title="Statements"
        description="Ledger drilldown — conversions and adjustments with a running balance."
        actions={<DemoBadge variant="mock" className={styles.badge} />}
      />
      <KpiStrip columns={totals.length + 1}>
        {totals.map(([currency, total]) => (
          <KpiCell key={currency} label={`${currency} total`} value={formatINR(total)} size={32} />
        ))}
        <KpiCell label="Entries" value={formatCount(filtered.length)} size={32} />
      </KpiStrip>
      <PageBody>
        <PageNote>TEST demo data only — no statement or ledger endpoint exists in the v1 surface yet.</PageNote>

        <div className={styles.filters}>
          <Field label="Programme">
            <Select
              compact
              value={programme}
              onChange={(e) => {
                setProgramme(e.target.value);
                setProperty('');
                setPlacement('');
              }}
              options={[{ value: '', label: 'All programmes' }, ...DEMO_PROGRAMMES.map((p) => ({ value: p.label, label: p.label }))]}
            />
          </Field>
          <Field label="Property">
            <Select
              compact
              value={property}
              onChange={(e) => {
                setProperty(e.target.value);
                setPlacement('');
              }}
              disabled={programme === ''}
              options={[{ value: '', label: 'All properties' }, ...DEMO_PROPERTIES.map((p) => ({ value: p.label, label: p.label }))]}
            />
          </Field>
          <Field label="Placement">
            <Select
              compact
              value={placement}
              onChange={(e) => setPlacement(e.target.value)}
              disabled={property === ''}
              options={[{ value: '', label: 'All placements' }, ...DEMO_PLACEMENTS.map((p) => ({ value: p.label, label: p.label }))]}
            />
          </Field>
        </div>

        <DataTable
          className={styles.table}
          caption="Ledger entries"
          columns={COLUMNS}
          rows={rows}
          rowKey={(e) => e.id}
          empty="No entries match these filters."
        />

        <PageSection>Dispute history</PageSection>
        <ul className={styles.disputes}>
          {DEMO_DISPUTES.map((d) => (
            <li key={d.id} className={styles.dispute}>
              <div className={styles.disputeHead}>
                <strong>{d.id}</strong>
                <StatusTag status={d.status} />
              </div>
              <p className={styles.disputeText}>
                Conversion {d.conversion} — {d.reason}
              </p>
              <p className={styles.disputeMeta}>Filed {d.filed}</p>
            </li>
          ))}
        </ul>
        <PageNote>
          A screenshot alone does not create a payable sale. Disputes are decided against click, conversion and
          ledger evidence — attach the relevant evidence when filing.
        </PageNote>
      </PageBody>
    </>
  );
}
