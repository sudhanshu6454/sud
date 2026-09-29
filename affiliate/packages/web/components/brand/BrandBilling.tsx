'use client';

/*
 * Brand billing (not drawn; README: Brand { plan, walletBalance, gstin }).
 * Wallet balance with a demo top-up dialog (no payment is taken), the
 * month's spend and network fee, the plan, and the billing history. TEST
 * demo data; plan price and fee from lib/site-copy.ts (placeholders).
 * /brand/billing#top-up (the overview's "Top up wallet") opens the dialog.
 */

import { useEffect, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Button, Eyebrow, KpiCell, KpiStrip, PageHeader, StatusTag } from '@/components/ui';
import { DEMO_BRAND } from '@/lib/demo/afflino';
import { DEMO_BILLING_HISTORY, DEMO_BRAND_PERIOD, DEMO_BRAND_SUMMARY, type DemoBillingRow } from '@/lib/demo/brand';
import { formatDayMonth, formatINRCompactFromMinor, formatINRFromMinor, formatINRWhole } from '@/lib/format';
import { PRICING } from '@/lib/site-copy';
import { feeMinor } from './offerModel';
import { StackTable, type StackColumn } from './StackTable';
import { TopUpDialog } from './TopUpDialog';
import { useBrandSettings } from './useBrandSettings';
import { useBrandWorkspace } from './workspace';
import shared from './shared.module.css';
import styles from './BrandBilling.module.css';

const PLAN = PRICING.network;

const COLUMNS: ReadonlyArray<StackColumn<DemoBillingRow>> = [
  { key: 'date', header: 'Date', primary: true, nowrap: true, cell: (r) => formatDayMonth(r.date, { pad: true }) },
  { key: 'reference', header: 'Reference', tone: 'mono', nowrap: true, cell: (r) => <span className={styles.ref}>{r.reference}</span> },
  { key: 'description', header: 'Description', cell: (r) => r.description },
  { key: 'amount', header: 'Amount', numeric: true, nowrap: true, cell: (r) => formatINRFromMinor(r.amountMinor, { paise: r.amountMinor % 100 !== 0 }) },
  { key: 'status', header: 'Status', cell: (r) => <StatusTag status={r.status} /> },
];

export function BrandBilling() {
  const ws = useBrandWorkspace();
  const { settings } = useBrandSettings(ws);
  const [topUpOpen, setTopUpOpen] = useState(false);

  // The overview's "Top up wallet" lands on #top-up: open the dialog.
  useEffect(() => {
    const check = () => {
      if (window.location.hash === '#top-up') setTopUpOpen(true);
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);

  const closeTopUp = () => {
    setTopUpOpen(false);
    if (window.location.hash === '#top-up') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  const walletMinor = DEMO_BRAND.walletMinor;
  const spend = DEMO_BRAND_SUMMARY.spendMinor;
  const feeToDate = feeMinor(spend, PLAN.networkFeePct);
  const history: DemoBillingRow[] = [
    {
      date: '2026-09-30',
      reference: 'INV-DEMO-0930',
      description: `Network fee · ${DEMO_BRAND_PERIOD.month} (to date)`,
      amountMinor: feeToDate,
      status: 'Due',
    },
    ...DEMO_BILLING_HISTORY,
  ];

  return (
    <>
      <PageHeader
        eyebrow={`${ws.name} · Billing`}
        title="Wallet and invoices"
        actions={<DemoBadge variant="mock" className={shared.badge} />}
      />
      <section id="top-up" aria-label="Wallet" className={styles.anchor}>
        <KpiStrip columns={3} className={shared.kpis}>
          <KpiCell
            label="Wallet balance"
            value={formatINRCompactFromMinor(walletMinor)}
            meta="Prepaid. Approved conversions are paid from it."
            extraSpacing="loose"
          >
            <Button variant="primary" arrow onClick={() => setTopUpOpen(true)} className={styles.touch}>
              Top up wallet
            </Button>
          </KpiCell>
          <KpiCell
            label={`Spend · ${DEMO_BRAND_PERIOD.month}`}
            value={formatINRCompactFromMinor(spend)}
            meta={`of ${formatINRCompactFromMinor(DEMO_BRAND_SUMMARY.budgetMinor)} budget`}
          />
          <KpiCell
            label="Network fee due"
            value={formatINRFromMinor(feeToDate)}
            meta={`${PLAN.networkFeePct}% of ${DEMO_BRAND_PERIOD.month} spend so far`}
          />
        </KpiStrip>
      </section>

      <div className={styles.row}>
        <section className={styles.history} aria-labelledby="billing-history">
          <div className={shared.sectionHead}>
            <Eyebrow as="h2" id="billing-history">
              Billing history
            </Eyebrow>
            <span className={styles.meta}>Invoices to {settings.billingEmail}</span>
          </div>
          <StackTable columns={COLUMNS} rows={history} rowKey={(r) => r.reference} caption="Billing history" />
        </section>
        <section className={styles.plan} aria-labelledby="billing-plan">
          <Eyebrow as="h2" id="billing-plan">
            Plan
          </Eyebrow>
          <div className={styles.planName}>{PLAN.name}</div>
          <div className={styles.planPrice}>
            {formatINRWhole(PLAN.monthlyRupees)}
            <span className={styles.planPer}>/month</span>
          </div>
          <p className={styles.planFee}>{PLAN.networkFeePct}% network fee on approved conversions</p>
          <ul className={styles.features}>
            {PLAN.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div className={styles.planActions}>
            <Button variant="secondary" href="/#pricing" className={styles.touch}>
              Compare plans
            </Button>
            <Button variant="ghost" href="/contact" className={styles.touch}>
              Talk to sales
            </Button>
          </div>
          <p className={shared.demoNote}>
            GSTIN on invoices: {settings.gstin || 'not added yet'} (Settings).
          </p>
        </section>
      </div>

      <TopUpDialog open={topUpOpen} onClose={closeTopUp} walletMinor={walletMinor} />
    </>
  );
}
