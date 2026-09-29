import { describe, expect, it } from 'vitest';
import {
  LedgerImbalanceError,
  assertEntriesBalanced,
  buildAdjustmentEntries,
  buildConversionEntries,
  checkBooksBalanced,
  type CurrencyBalance,
} from './ledger.js';

/**
 * Pure unit tests for the double-entry ledger math. No database involved:
 * these pin down the money invariants (split math, balance enforcement,
 * reversal netting) that the API and workers build on.
 */

const BASE = {
  org_id: 'org-1',
  currency: 'INR',
  conversion_id: 'conv-1',
  contract_version_id: 'cv-1',
  publisher_id: 'pub-1',
};

describe('buildConversionEntries', () => {
  it('splits a 16000-minor commission 70/30 into publisher 11200 / platform 4800', () => {
    const entries = buildConversionEntries({ ...BASE, commission_minor: 16000, publisher_share_bps: 7000 });

    expect(entries).toHaveLength(3);
    const byAccount = Object.fromEntries(entries.map((e) => [e.account, e]));

    expect(byAccount.merchant_receivable?.debit_minor).toBe(16000);
    expect(byAccount.merchant_receivable?.credit_minor).toBe(0);

    expect(byAccount.publisher_liability?.debit_minor).toBe(0);
    expect(byAccount.publisher_liability?.credit_minor).toBe(11200);

    expect(byAccount.platform_commission?.debit_minor).toBe(0);
    expect(byAccount.platform_commission?.credit_minor).toBe(4800);

    // The drafts balance by construction — no throw.
    expect(() => assertEntriesBalanced(entries)).not.toThrow();
  });

  it('gives the rounding remainder to the platform: 1 minor @7000bps -> 0/1, still balanced', () => {
    const entries = buildConversionEntries({ ...BASE, commission_minor: 1, publisher_share_bps: 7000 });
    const byAccount = Object.fromEntries(entries.map((e) => [e.account, e]));

    // floor(1 * 7000 / 10000) = 0 for the publisher; platform keeps the 1.
    expect(byAccount.publisher_liability?.credit_minor).toBe(0);
    expect(byAccount.platform_commission?.credit_minor).toBe(1);

    expect(() => assertEntriesBalanced(entries)).not.toThrow();
  });

  it('all drafts share one idempotency key so re-posts are no-ops', () => {
    const entries = buildConversionEntries({ ...BASE, commission_minor: 16000, publisher_share_bps: 7000 });
    const keys = new Set(entries.map((e) => e.idempotency_key));
    expect(keys.size).toBe(1);
    expect(entries[0]!.idempotency_key).toContain(BASE.conversion_id);
  });
});

describe('buildAdjustmentEntries', () => {
  it('is the exact mirror of a same-size conversion: nets to zero per account', () => {
    const original = buildConversionEntries({ ...BASE, commission_minor: 8000, publisher_share_bps: 7000 });
    const reversal = buildAdjustmentEntries({
      org_id: BASE.org_id,
      currency: BASE.currency,
      adjustment_id: 'adj-1',
      contract_version_id: BASE.contract_version_id,
      reversal_commission_minor: 8000,
      publisher_share_bps: 7000,
      publisher_id: BASE.publisher_id,
    });

    expect(() => assertEntriesBalanced(reversal)).not.toThrow();

    const netByAccount = new Map<string, number>();
    for (const e of [...original, ...reversal]) {
      netByAccount.set(e.account, (netByAccount.get(e.account) ?? 0) + (e.debit_minor - e.credit_minor));
    }
    for (const [account, net] of netByAccount) {
      expect(net, `account ${account} should net to zero`).toBe(0);
    }
  });

  it('reverses the correct split for a partial reversal (4000 of 8000 @7000bps)', () => {
    const reversal = buildAdjustmentEntries({
      org_id: BASE.org_id,
      currency: BASE.currency,
      adjustment_id: 'adj-1',
      contract_version_id: BASE.contract_version_id,
      reversal_commission_minor: 4000,
      publisher_share_bps: 7000,
    });
    const byAccount: Record<string, (typeof reversal)[number]> = Object.fromEntries(
      reversal.map((e) => [e.account, e]),
    );

    expect(byAccount.merchant_receivable?.credit_minor).toBe(4000);
    expect(byAccount.publisher_liability?.debit_minor).toBe(2800);
    expect(byAccount.platform_commission?.debit_minor).toBe(1200);
  });

  it('never produces negative amounts', () => {
    const reversal = buildAdjustmentEntries({
      org_id: BASE.org_id,
      currency: BASE.currency,
      adjustment_id: 'adj-1',
      contract_version_id: BASE.contract_version_id,
      reversal_commission_minor: 3,
      publisher_share_bps: 7000,
    });
    for (const e of reversal) {
      expect(e.debit_minor).toBeGreaterThanOrEqual(0);
      expect(e.credit_minor).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('assertEntriesBalanced', () => {
  it('throws LedgerImbalanceError on unbalanced input', () => {
    const bad = [
      { debit_minor: 100, credit_minor: 0 },
      { debit_minor: 0, credit_minor: 99 },
    ];
    let caught: unknown;
    try {
      assertEntriesBalanced(bad);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LedgerImbalanceError);
    const err = caught as LedgerImbalanceError;
    expect(err.code).toBe('LEDGER_IMBALANCE');
    expect(err.debit).toBe(100);
    expect(err.credit).toBe(99);
  });

  it('accepts an empty set (0 == 0)', () => {
    expect(() => assertEntriesBalanced([])).not.toThrow();
  });
});

describe('checkBooksBalanced', () => {
  function stubQuery(rows: CurrencyBalance[]) {
    return async (_sql: string, _params: unknown[]) => ({ rows });
  }

  it('reports balanced when debit == credit per currency', async () => {
    const report = await checkBooksBalanced(
      stubQuery([
        { currency: 'INR', debit: '16000', credit: '16000' },
        { currency: 'USD', debit: '0', credit: '0' },
      ]),
      'org-1',
    );
    expect(report.balanced).toBe(true);
    expect(report.imbalances).toHaveLength(0);
  });

  it('detects an imbalance and names the offending currency', async () => {
    const report = await checkBooksBalanced(
      stubQuery([
        { currency: 'INR', debit: '16000', credit: '15999' },
        { currency: 'USD', debit: '5', credit: '5' },
      ]),
      'org-1',
    );
    expect(report.balanced).toBe(false);
    expect(report.imbalances).toHaveLength(1);
    expect(report.imbalances[0]!.currency).toBe('INR');
  });

  it('treats bigint-as-string values numerically (pg returns bigint as text)', async () => {
    const report = await checkBooksBalanced(
      stubQuery([{ currency: 'INR', debit: '9007199254740993', credit: '9007199254740993' }]),
      'org-1',
    );
    expect(report.balanced).toBe(true);
  });
});
