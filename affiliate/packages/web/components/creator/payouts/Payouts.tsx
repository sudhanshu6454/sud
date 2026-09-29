'use client';

/*
 * Creator Payouts — 2c (desktop) and the 3f middle composition (phone,
 * ≤760px). The two balance cells come from GET /v1/publisher/earnings when
 * it answers (mapping in model.ts); the payout method, the payout history
 * and the Conversions / Clicks tables have no v1 endpoint and are TEST demo
 * data, so the page always carries <DemoBadge /> ("fallback" when the call
 * failed). The payout method follows what Settings saved in this browser.
 */

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Banner, Button, DataTable, Eyebrow, Segmented, StatusTag, Tag, type DataTableColumn } from '@/components/ui';
import { DEMO_PAYOUTS, PLATFORM_NAME, type DemoPayout } from '@/lib/demo/afflino';
import {
  DEMO_CLICK_ROWS,
  DEMO_CONVERSION_ROWS,
  DEMO_PAYOUT_PERIOD,
  DEMO_TODAY,
  type DemoClickRow,
  type DemoConversionRow,
} from '@/lib/demo/payouts';
import { downloadCsv } from '@/lib/download';
import { formatCount, formatDayMonth, formatINRFromMinor, formatRate } from '@/lib/format';
import { VALIDATION_WINDOW_DAYS } from '@/lib/site-copy';
import { defaultSettings, loadSettings, payoutMethodSummary, type CreatorSettings } from '../settings/model';
import {
  buildClicksCsv,
  buildConversionsCsv,
  buildPayoutsCsv,
  payoutsCsvFilename,
  type PayoutTable,
} from './csv';
import { loadBalances, type BalancesLoad } from './data';
import { tdsLabel, withdrawEligibility, type WithdrawalBreakdown } from './model';
import { WithdrawDialog } from './WithdrawDialog';
import styles from './Payouts.module.css';

const TABLE_OPTIONS: ReadonlyArray<{ value: PayoutTable; label: string }> = [
  { value: 'payouts', label: 'Payouts' },
  { value: 'conversions', label: 'Conversions' },
  { value: 'clicks', label: 'Clicks' },
];

const day = (date: string) => formatDayMonth(date, { pad: true });

/* Column widths as drawn (share of the 1216px table in 2c). */
const PAYOUT_COLUMNS: ReadonlyArray<DataTableColumn<DemoPayout>> = [
  { key: 'date', header: 'Date', width: '10.03%', cell: (r) => day(r.date) },
  { key: 'reference', header: 'Reference', width: '22.12%', tone: 'muted', cell: (r) => r.reference },
  { key: 'method', header: 'Method', width: '19%', cell: (r) => r.method },
  { key: 'gross', header: 'Gross', width: '12.09%', cell: (r) => formatINRFromMinor(r.grossMinor) },
  { key: 'tds', header: 'TDS', width: '7.57%', cell: (r) => formatINRFromMinor(r.tdsMinor) },
  { key: 'net', header: 'Net', width: '12.09%', tone: 'strong', cell: (r) => formatINRFromMinor(r.netMinor) },
  { key: 'status', header: 'Status', width: '17.1%', cell: (r) => <StatusTag status={r.status} /> },
];

const CONVERSION_COLUMNS: ReadonlyArray<DataTableColumn<DemoConversionRow>> = [
  { key: 'date', header: 'Date', width: '10.03%', cell: (r) => day(r.date) },
  { key: 'offer', header: 'Offer', width: '19%', cell: (r) => r.offer },
  { key: 'subId', header: 'Sub-ID', width: '17%', tone: 'mono', cell: (r) => r.subId },
  { key: 'platform', header: 'Platform', width: '11%', cell: (r) => PLATFORM_NAME[r.platform] },
  { key: 'event', header: 'Event', width: '14%', tone: 'muted', cell: (r) => r.event },
  { key: 'commission', header: 'Commission', width: '11.87%', tone: 'strong', cell: (r) => formatINRFromMinor(r.commissionMinor) },
  { key: 'status', header: 'Status', width: '17.1%', cell: (r) => <StatusTag status={r.status} /> },
];

const CLICK_COLUMNS: ReadonlyArray<DataTableColumn<DemoClickRow>> = [
  { key: 'date', header: 'Date', width: '10.03%', cell: (r) => day(r.date) },
  { key: 'offer', header: 'Offer', width: '19%', cell: (r) => r.offer },
  { key: 'subId', header: 'Sub-ID', width: '17%', tone: 'mono', cell: (r) => r.subId },
  { key: 'platform', header: 'Platform', width: '11%', cell: (r) => PLATFORM_NAME[r.platform] },
  { key: 'clicks', header: 'Clicks', width: '14%', numeric: true, cell: (r) => formatCount(r.clicks) },
  { key: 'conversions', header: 'Conv.', width: '11.87%', numeric: true, cell: (r) => formatCount(r.conversions) },
  { key: 'cr', header: 'CR', width: '17.1%', numeric: true, cell: (r) => formatRate(r.conversions, r.clicks, 2) },
];

function Arrow() {
  return <span aria-hidden="true"> →</span>;
}

export function Payouts() {
  const [load, setLoad] = useState<BalancesLoad | null>(null);
  const [settings, setSettings] = useState<CreatorSettings>(defaultSettings);
  const [table, setTable] = useState<PayoutTable>('payouts');
  const [payouts, setPayouts] = useState<ReadonlyArray<DemoPayout>>(DEMO_PAYOUTS);
  const [withdrawnMinor, setWithdrawnMinor] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const reasonId = useId();
  const phoneReasonId = useId();
  const reasonRef = useRef<HTMLParagraphElement>(null);
  const phoneReasonRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let alive = true;
    setSettings(loadSettings());
    loadBalances().then((result) => {
      if (alive) setLoad(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  const method = payoutMethodSummary(settings);
  const live = load?.live === true;
  const availableMinor = load ? Math.max(load.balances.availableMinor - withdrawnMinor, 0) : null;
  const pendingMinor = load ? load.balances.pendingMinor : null;
  const eligibility = availableMinor === null ? null : withdrawEligibility(availableMinor);
  const canWithdraw = eligibility?.ok === true;
  const reason = eligibility && !eligibility.ok ? eligibility.reason : '';

  const panLine = `${method.panDemoVerified ? 'PAN verified' : 'PAN not verified'} · ${tdsLabel()} deducted`;
  const pendingLine = `Clears after the brand's ${VALIDATION_WINDOW_DAYS}-day validation window`;

  const badge = load ? <DemoBadge variant={live ? 'mock' : 'fallback'} className={styles.badge} /> : null;

  const onConfirm = useCallback(
    (b: WithdrawalBreakdown) => {
      setWithdrawnMinor((w) => w + b.grossMinor);
      setPayouts((rows) => [
        {
          date: DEMO_TODAY,
          reference: 'Requested (demo)',
          method: method.short === 'Bank' ? 'Bank' : 'UPI',
          grossMinor: b.grossMinor,
          tdsMinor: b.tdsMinor,
          netMinor: b.netMinor,
          status: 'Scheduled',
        },
        ...rows,
      ]);
      setTable('payouts');
      setAnnouncement(
        `Demo withdrawal requested: ${formatINRFromMinor(b.netMinor)} to ${method.label} after TDS. Nothing was sent.`,
      );
    },
    [method.label, method.short],
  );

  // The dialog returns focus to its opener; after a demo withdrawal empties
  // the balance that button is disabled, so focus goes to the reason line.
  const closeDialog = () => {
    setDialogOpen(false);
    window.setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const target = [reasonRef.current, phoneReasonRef.current].find((el) => el && el.offsetParent !== null);
      target?.focus();
    }, 0);
  };

  const onTable = (next: PayoutTable) => {
    setTable(next);
    const label = TABLE_OPTIONS.find((o) => o.value === next)?.label ?? next;
    setAnnouncement(`Showing ${label.toLowerCase()}, ${DEMO_PAYOUT_PERIOD.label}.`);
  };

  const onExport = () => {
    const text =
      table === 'payouts'
        ? buildPayoutsCsv(payouts)
        : table === 'conversions'
          ? buildConversionsCsv(DEMO_CONVERSION_ROWS)
          : buildClicksCsv(DEMO_CLICK_ROWS);
    const filename = payoutsCsvFilename(table, DEMO_PAYOUT_PERIOD.key);
    downloadCsv(filename, text);
    setAnnouncement(`Exported ${filename}.`);
  };

  const tableView = useMemo(() => {
    const caption = `${TABLE_OPTIONS.find((o) => o.value === table)?.label}, ${DEMO_PAYOUT_PERIOD.label}`;
    if (table === 'conversions') {
      return (
        <DataTable
          looseHeader
          className={styles.table}
          caption={caption}
          columns={CONVERSION_COLUMNS}
          rows={DEMO_CONVERSION_ROWS}
          rowKey={(r) => r.id}
          empty={`No conversions in ${DEMO_PAYOUT_PERIOD.label}.`}
        />
      );
    }
    if (table === 'clicks') {
      return (
        <DataTable
          looseHeader
          className={styles.table}
          caption={caption}
          columns={CLICK_COLUMNS}
          rows={DEMO_CLICK_ROWS}
          rowKey={(r) => r.id}
          empty={`No clicks in ${DEMO_PAYOUT_PERIOD.label}.`}
        />
      );
    }
    return (
      <DataTable
        looseHeader
        className={styles.table}
        caption={caption}
        columns={PAYOUT_COLUMNS}
        rows={payouts}
        rowKey={(r, i) => `${r.reference}-${r.date}-${i}`}
        empty={`No payouts in ${DEMO_PAYOUT_PERIOD.label} yet.`}
      />
    );
  }, [table, payouts]);

  const valueText = (minor: number | null) => (minor === null ? '—' : formatINRFromMinor(minor));

  return (
    <>
      {load?.mismatch ? (
        <Banner title="Balances unavailable.">
          The API answered for a different publisher than this account, so the page shows demo data.
        </Banner>
      ) : null}
      {live ? (
        <Banner tone="info">
          Balances are live. The payout method, payout history, conversions and clicks are demo data until their
          endpoints exist.
        </Banner>
      ) : null}

      {/* ---------- desktop / tablet (2c) ---------- */}
      <div className={styles.desktop}>
        <h1 className="sr-only">Payouts</h1>

        <div className={styles.cells}>
          <section className={styles.cell} aria-labelledby="payouts-available-label">
            <Eyebrow as="h2" id="payouts-available-label">
              Available to withdraw
            </Eyebrow>
            <p className={styles.value} aria-busy={load ? undefined : true}>
              {valueText(availableMinor)}
            </p>
            {live ? <p className={styles.liveMeta}>Collected from brands, not yet in a payout batch</p> : null}
            <Button
              variant="primary"
              arrow
              className={styles.withdraw}
              disabled={!canWithdraw}
              aria-describedby={reason ? reasonId : undefined}
              onClick={() => setDialogOpen(true)}
            >
              {method.withdrawLabel}
            </Button>
            {reason ? (
              <p id={reasonId} ref={reasonRef} tabIndex={-1} className={styles.reason}>
                {reason}
              </p>
            ) : null}
          </section>

          <section className={styles.cell} aria-labelledby="payouts-pending-label">
            <Eyebrow as="h2" id="payouts-pending-label">
              Pending approval
            </Eyebrow>
            <p className={styles.value} aria-busy={load ? undefined : true}>
              {valueText(pendingMinor)}
            </p>
            <p className={styles.pendingMeta}>{pendingLine}</p>
          </section>

          <section className={styles.cell} aria-labelledby="payouts-method-label">
            <Eyebrow as="h2" id="payouts-method-label">
              Payout method
            </Eyebrow>
            <p className={styles.method}>{method.label}</p>
            <p className={styles.methodMeta}>{panLine}</p>
            <Link href="/app/settings#payout" className={styles.change}>
              Change method<Arrow />
            </Link>
          </section>
        </div>

        <div className={styles.toolbar}>
          <Segmented aria-label="Show" options={TABLE_OPTIONS} value={table} onChange={onTable} />
          <div className={styles.toolbarEnd}>
            {badge}
            <Tag variant="outline" className={styles.period}>
              {DEMO_PAYOUT_PERIOD.label}
            </Tag>
            <Button variant="secondary" onClick={onExport}>
              Export CSV
            </Button>
          </div>
        </div>

        <section className={styles.tableArea} aria-label="Payout records">
          {tableView}
          <p className={styles.more}>
            <Link href="/app/payouts/disputes">
              Missing a commission? Raise a ticket<Arrow />
            </Link>
            <Link href="/app/payouts/statements">
              Statements<Arrow />
            </Link>
          </p>
        </section>
      </div>

      {/* ---------- phone (3f, middle) ---------- */}
      <div className={styles.phone}>
        <div className={styles.phoneHeader}>
          <h1 className={styles.phoneTitle}>Payouts</h1>
          {badge}
        </div>
        <section className={styles.panel} aria-labelledby="payouts-phone-available">
          <h2 id="payouts-phone-available" className={styles.panelLabel}>
            Available
          </h2>
          <p className={styles.panelValue} aria-busy={load ? undefined : true}>
            {valueText(availableMinor)}
          </p>
          <p className={styles.panelLine}>
            {pendingMinor === null ? '—' : formatINRFromMinor(pendingMinor)} pending · to {method.label}
          </p>
        </section>
        <div className={styles.phoneAction}>
          <Button
            variant="primary"
            block
            touch
            arrow
            disabled={!canWithdraw}
            aria-describedby={reason ? phoneReasonId : undefined}
            onClick={() => setDialogOpen(true)}
          >
            Withdraw now
          </Button>
          {reason ? (
            <p id={phoneReasonId} ref={phoneReasonRef} tabIndex={-1} className={styles.reason}>
              {reason}
            </p>
          ) : null}
        </div>
        <section className={styles.history} aria-labelledby="payouts-phone-history">
          <h2 id="payouts-phone-history" className="sr-only">
            Payout history, {DEMO_PAYOUT_PERIOD.label}
          </h2>
          <ul className={styles.historyList}>
            {payouts.map((p, i) => (
              <li key={`${p.reference}-${p.date}-${i}`} className={styles.historyRow}>
                <div>
                  <div className={styles.historyNet}>{formatINRFromMinor(p.netMinor)}</div>
                  <div className={styles.historyMeta}>
                    {day(p.date)} · {p.method}
                  </div>
                </div>
                <StatusTag status={p.status} />
              </li>
            ))}
          </ul>
          <p className={styles.phoneMore}>
            <Link href="/app/settings#payout">
              Change payout method<Arrow />
            </Link>
            <Link href="/app/payouts/statements">
              Statements<Arrow />
            </Link>
            <Link href="/app/payouts/disputes">
              Missing a commission? Raise a ticket<Arrow />
            </Link>
          </p>
        </section>
      </div>

      {availableMinor !== null ? (
        <WithdrawDialog
          open={dialogOpen}
          onClose={closeDialog}
          mode={live ? 'live' : 'demo'}
          availableMinor={availableMinor}
          destination={method.label}
          title={method.withdrawLabel}
          onConfirm={onConfirm}
        />
      ) : null}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
