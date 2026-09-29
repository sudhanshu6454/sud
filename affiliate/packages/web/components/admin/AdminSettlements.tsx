/*
 * Admin · Settlements (listed in the handover, not drawn): weekly settlement
 * batches (period, gross, network fee, net, status) in the 2e style. TEST
 * demo data (lib/demo/admin.ts). Read-only on purpose: real payout batches
 * run through the finance maker-checker flow in the API
 * (POST /v1/payout-batches → /approve by a different user → /disburse),
 * which this page does not call. Hook-free (a server component).
 */

import DemoBadge from '@/components/DemoBadge';
import { PageNote } from '@/components/shell/PageBody';
import { KpiCell, KpiStrip, Tag, type DataTableColumn, type TagVariant } from '@/components/ui';
import { DEMO_ADMIN_KPIS, DEMO_ADMIN_PERIOD, DEMO_SETTLEMENT_BATCHES, type SettlementBatch, type SettlementStatus } from '@/lib/demo/admin';
import { formatCount, formatDayMonth, formatINRCompactFromMinor, formatINRFromMinor } from '@/lib/format';
import { TDS } from '@/lib/site-copy';
import { AdminNote, AdminSection } from './AdminSection';
import { periodLabel } from './adminModel';
import { ResponsiveTable, StackRow } from './ResponsiveTable';
import styles from './AdminPage.module.css';

const STATUS_TAG: Record<SettlementStatus, TagVariant> = {
  Paid: 'accent',
  'Awaiting approval': 'outline',
  Open: 'neutral',
};

function statusLine(b: SettlementBatch): string {
  const day = formatDayMonth(b.date, { weekday: true });
  if (b.status === 'Paid') return `Paid ${day}`;
  if (b.status === 'Awaiting approval') return `Prepared ${day} · needs a second approver`;
  return `Closes ${day}`;
}

function StatusCell({ batch }: { batch: SettlementBatch }) {
  return (
    <span className={styles.stack}>
      <span>
        <Tag variant={STATUS_TAG[batch.status]}>{batch.status}</Tag>
      </span>
      <span className={`${styles.muted} ${styles.small}`}>{statusLine(batch)}</span>
    </span>
  );
}

const COLUMNS: ReadonlyArray<DataTableColumn<SettlementBatch>> = [
  { key: 'id', header: 'Batch', tone: 'mono', width: '15%', cell: (b) => b.id },
  { key: 'period', header: 'Period', tone: 'strong', width: '13%', cell: (b) => periodLabel(b) },
  { key: 'conversions', header: 'Conversions', width: '11%', cell: (b) => formatCount(b.conversions) },
  { key: 'gross', header: 'Gross', width: '13%', cell: (b) => formatINRFromMinor(b.grossMinor) },
  { key: 'fee', header: 'Network fee', width: '12%', cell: (b) => formatINRFromMinor(b.feeMinor) },
  { key: 'net', header: 'Net to creators', width: '14%', className: styles.strongCell, cell: (b) => formatINRFromMinor(b.netMinor) },
  { key: 'status', header: 'Status', cell: (b) => <StatusCell batch={b} /> },
];

export function AdminSettlements() {
  const paid = DEMO_SETTLEMENT_BATCHES.filter((b) => b.status === 'Paid');
  const awaiting = DEMO_SETTLEMENT_BATCHES.filter((b) => b.status === 'Awaiting approval');
  const open = DEMO_SETTLEMENT_BATCHES.find((b) => b.status === 'Open');
  const sum = (list: ReadonlyArray<SettlementBatch>, key: 'netMinor' | 'grossMinor') => list.reduce((n, b) => n + b[key], 0);
  const month = DEMO_ADMIN_PERIOD.monthShort;

  return (
    <>
      <h1 className="sr-only">Admin: settlements</h1>
      <KpiStrip columns={4}>
        <KpiCell
          size={32}
          label={`Paid to creators · ${month}`}
          value={formatINRCompactFromMinor(sum(paid, 'netMinor'))}
          meta={`${formatCount(paid.length)} weekly batches`}
        />
        <KpiCell
          size={32}
          label="Awaiting approval"
          value={formatINRCompactFromMinor(sum(awaiting, 'netMinor'))}
          meta={`${formatCount(awaiting.length)} batch · maker-checker`}
        />
        <KpiCell size={32} label={`Network fee · ${month}`} value={formatINRCompactFromMinor(DEMO_ADMIN_KPIS.networkFeeMinor)} />
        <KpiCell
          size={32}
          label="Open batch"
          value={open ? formatINRCompactFromMinor(open.netMinor) : '—'}
          meta={open ? `Closes ${formatDayMonth(open.date, { weekday: true })}` : undefined}
        />
      </KpiStrip>

      <div className={styles.noteWrap}>
        <PageNote>
          This page is read-only demo data. Real payout batches run through the finance maker-checker flow in the API:
          a finance user prepares a batch (POST /v1/payout-batches), a different user approves it (…/approve; the
          preparer can never approve their own batch), and only then is it disbursed (…/disburse). An unknown transfer
          outcome is checked with a status query before any retry.
        </PageNote>
      </div>

      <AdminSection title="Weekly batches" titleId="admin-settlements-title" badge={<DemoBadge variant="mock" />}>
        <ResponsiveTable
          caption="Weekly settlement batches"
          columns={COLUMNS}
          rows={DEMO_SETTLEMENT_BATCHES}
          rowKey={(b) => b.id}
          phoneRow={(b) => (
            <StackRow
              title={periodLabel(b)}
              aside={formatINRFromMinor(b.netMinor)}
              meta={`${b.id} · ${formatCount(b.conversions)} conversions · gross ${formatINRFromMinor(b.grossMinor)} · fee ${formatINRFromMinor(b.feeMinor)}`}
              actions={<StatusCell batch={b} />}
            />
          )}
        />
        <AdminNote>
          Gross is the brands’ approved payouts for the week; net is gross minus the network fee, owed to creators
          before TDS ({TDS.ratePct}% under {TDS.section}, a placeholder rate).
        </AdminNote>
      </AdminSection>
    </>
  );
}
