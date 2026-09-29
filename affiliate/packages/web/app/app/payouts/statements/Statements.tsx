'use client';

/*
 * Statements — the ledger drilldown that was /portal/statements. No v1
 * statement / ledger endpoint exists yet, so the page is TEST demo data
 * (lib/portal-demo.ts) with <DemoBadge />; the logic (cascading filters,
 * running balance, per-currency totals, dispute history) is the HEAD page
 * unchanged, set in the app shell with the Afflino primitives (dates as
 * the 2c table prints them in both tables, dispute history in the standard
 * table; amounts exact, as a ledger prints them). On phones both tables are
 * stacked rows (components/admin/ResponsiveTable), like the brand and admin
 * lists, so no figure scrolls off-screen.
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { ResponsiveTable, StackRow } from '@/components/admin/ResponsiveTable';
import { disputeStatusTag, humanise } from '@/components/creator/payouts/labels';
import { PageBody, PageNote } from '@/components/shell/PageBody';
import {
  Button,
  Eyebrow,
  Field,
  KpiCell,
  KpiStrip,
  PageHeader,
  Select,
  Tag,
  type DataTableColumn,
} from '@/components/ui';
import { formatCount, formatDayMonth, formatINRExact } from '@/lib/format';
import {
  DEMO_DISPUTES,
  type DemoDispute,
  DEMO_LEDGER,
  DEMO_PLACEMENTS,
  DEMO_PROGRAMMES,
  DEMO_PROPERTIES,
  type DemoLedgerEntry,
} from '@/lib/portal-demo';
import styles from './page.module.css';

type Row = DemoLedgerEntry & { running: number };

const day = (date: string) => formatDayMonth(date, { pad: true });

function signedAmount(minor: number) {
  return (
    <span className={minor < 0 ? styles.negative : undefined}>
      {minor < 0 ? '−' : '+'}
      {formatINRExact(Math.abs(minor))}
    </span>
  );
}

const COLUMNS: ReadonlyArray<DataTableColumn<Row>> = [
  { key: 'date', header: 'Date', width: '12%', className: styles.cell, cell: (e) => day(e.date) },
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
  { key: 'kind', header: 'Kind', width: '14%', className: styles.cell, tone: 'muted', cell: (e) => humanise(e.kind) },
  {
    key: 'amount',
    header: 'Amount',
    width: '13%',
    numeric: true,
    className: styles.cell,
    cell: (e) => signedAmount(e.amount_minor),
  },
  { key: 'balance', header: 'Balance', width: '13%', numeric: true, tone: 'strong', className: styles.cell, cell: (e) => formatINRExact(e.running) },
];

/* Phones: the entry is the heading line, the amount beside it, kind and balance under it. */
const ledgerPhoneRow = (e: Row) => (
  <StackRow
    title={e.label}
    aside={signedAmount(e.amount_minor)}
    meta={
      <>
        <div>
          {humanise(e.kind)} · Balance {formatINRExact(e.running)}
        </div>
        <div>
          {day(e.date)} · {e.programme} · {e.property} · {e.placement}
        </div>
      </>
    }
  />
);

const DISPUTE_COLUMNS: ReadonlyArray<DataTableColumn<DemoDispute>> = [
  { key: 'filed', header: 'Filed', width: '14%', className: styles.cell, cell: (d) => day(d.filed) },
  { key: 'id', header: 'Ticket', width: '10%', tone: 'strong', className: styles.cell, cell: (d) => d.id },
  { key: 'conversion', header: 'Conversion', width: '13%', tone: 'strong', className: styles.cell, cell: (d) => d.conversion },
  { key: 'reason', header: 'Reason', tone: 'body', className: styles.cell, cell: (d) => d.reason },
  {
    key: 'status',
    header: 'Status',
    width: '12%',
    className: styles.cell,
    cell: (d) => <Tag variant={disputeStatusTag(d.status)}>{humanise(d.status)}</Tag>,
  },
];

const disputePhoneRow = (d: DemoDispute) => (
  <StackRow
    title={d.id}
    aside={<Tag variant={disputeStatusTag(d.status)}>{humanise(d.status)}</Tag>}
    meta={
      <>
        <div>
          Filed {day(d.filed)} · conversion {d.conversion}
        </div>
        <div>{d.reason}</div>
      </>
    }
  />
);

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
        actions={
          <>
            <DemoBadge variant="mock" className={styles.badge} />
            <Button href="/app/payouts" arrow="left">
              Payouts
            </Button>
          </>
        }
      />
      <KpiStrip columns={totals.length + 1}>
        {totals.map(([currency, total]) => (
          <KpiCell
            key={currency}
            label={totals.length > 1 ? `Balance · ${currency}` : 'Balance'}
            value={formatINRExact(total)}
            size={32}
          />
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

        <ResponsiveTable
          className={styles.table}
          caption="Ledger entries"
          columns={COLUMNS}
          rows={rows}
          rowKey={(e) => e.id}
          empty="No entries match these filters."
          phoneRow={ledgerPhoneRow}
        />

        <section className={styles.history} aria-labelledby="statements-disputes-title">
          <div className={styles.historyHead}>
            <Eyebrow as="h2" id="statements-disputes-title">
              Dispute history
            </Eyebrow>
            <Link href="/app/payouts/disputes" className={styles.historyLink}>
              Raise a ticket<span aria-hidden="true"> →</span>
            </Link>
          </div>
          <ResponsiveTable
            className={styles.table}
            caption="Dispute history: filed date, ticket, conversion, reason and status"
            columns={DISPUTE_COLUMNS}
            rows={DEMO_DISPUTES}
            rowKey={(d) => d.id}
            empty="No disputes filed."
            phoneRow={disputePhoneRow}
          />
        </section>
        <PageNote>
          A screenshot alone does not create a payable sale. Disputes are decided against click, conversion and
          ledger evidence — attach the relevant evidence when filing.
        </PageNote>
      </PageBody>
    </>
  );
}
