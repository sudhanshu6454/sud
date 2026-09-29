import { describe, expect, it } from 'vitest';
import * as brandCsv from '../components/brand/conversionsModel';
import * as payoutsCsv from '../components/creator/payouts/csv';
import * as reportsCsv from '../components/creator/reports/csv';
import { DEMO_CSV_LABEL, csvField, minorToRupees, ratePct, toCsv, toDemoCsv } from '../lib/csv';
import { earningsBalances } from '../lib/earnings';
import { DEMO_EARNINGS } from '../lib/portal-demo';
import { validateBankAccount, validateIfsc } from '../lib/validators';

describe('lib/csv (shared by every Export CSV)', () => {
  it('is the one implementation behind the three exports', () => {
    for (const mod of [brandCsv, payoutsCsv, reportsCsv]) {
      expect(mod.csvField).toBe(csvField);
      expect(mod.minorToRupees).toBe(minorToRupees);
    }
    expect(payoutsCsv.DEMO_CSV_LABEL).toBe(DEMO_CSV_LABEL);
    expect(brandCsv.DEMO_CSV_LABEL).toBe(DEMO_CSV_LABEL);
  });

  it('writes the TEST label row, a blank row, then the table, CRLF-terminated', () => {
    expect(toDemoCsv([['a', 1]])).toBe(`"${DEMO_CSV_LABEL}"\r\n\r\na,1\r\n`);
    expect(toCsv([])).toBe('\r\n');
  });

  it('keeps money integer-exact and guards formula-looking text', () => {
    expect(minorToRupees(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
    expect(() => minorToRupees(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('-500.00')).toBe('-500.00');
    expect(ratePct(4102, 312_880)).toBe(1.31);
    expect(ratePct(1, 0)).toBeNull();
  });
});

describe('lib/earnings (1c Next payout and 2c Available to withdraw)', () => {
  it('next batch = max(collected − payable, 0), never negative', () => {
    expect(earningsBalances(DEMO_EARNINGS)).toEqual({
      pendingMinor: 1_845_000,
      approvedMinor: 2_264_000,
      collectedMinor: 0,
      payableMinor: 960_000,
      nextBatchMinor: 0,
    });
    const b = earningsBalances({ publisher_id: 'x', balances: { INR: { pending: 1, approved: 2, collected: 900, payable: 300 } } });
    expect(b.nextBatchMinor).toBe(600);
  });

  it('reads a missing currency or a non-numeric bucket value as zero', () => {
    expect(earningsBalances({ publisher_id: 'x', balances: {} }).nextBatchMinor).toBe(0);
    const odd = { publisher_id: 'x', balances: { INR: { pending: Number.NaN, approved: 0, collected: 5, payable: 0 } } };
    expect(earningsBalances(odd)).toMatchObject({ pendingMinor: 0, nextBatchMinor: 5 });
  });
});

describe('lib/validators bank fields (onboarding 3a and settings 2d)', () => {
  it('keeps each screen\'s empty-field wording', () => {
    expect(validateIfsc('').message).toBe('Enter the branch IFSC.');
    expect(validateIfsc('', 'Enter the IFSC.').message).toBe('Enter the IFSC.');
    expect(validateBankAccount('').message).toBe('Enter your account number.');
    expect(validateBankAccount('', 'Enter the account number.').message).toBe('Enter the account number.');
  });

  it('normalises the same way for both screens', () => {
    expect(validateIfsc(' demo0a1b2c3 ').value).toBe('DEMO0A1B2C3');
    expect(validateBankAccount('0000-1234 5678').value).toBe('000012345678');
    expect(validateBankAccount('12345678x').message).toBe('Use digits only.');
  });
});
