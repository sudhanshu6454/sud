import { describe, expect, it } from 'vitest';
import {
  buildClicksCsv,
  buildConversionsCsv,
  buildPayoutsCsv,
  conversionRatePct,
  csvField,
  minorToRupees,
  payoutsCsvFilename,
  toCsv,
} from '../components/creator/payouts/csv';
import { disputeStatusTag, formatLongDate, humanise, shortTicketId } from '../components/creator/payouts/labels';
import {
  computeTdsMinor,
  mapEarningsToBalances,
  minWithdrawalMinor,
  rateToBps,
  tdsLabel,
  validateWithdrawAmount,
  withdrawEligibility,
  withdrawalBreakdown,
} from '../components/creator/payouts/model';
import type { EarningsResponse } from '../lib/api';
import { DEMO_CREATOR_SUMMARY, DEMO_OFFERS, DEMO_PAYOUTS } from '../lib/demo/afflino';
import { DEMO_CLICK_ROWS, DEMO_CONVERSION_ROWS } from '../lib/demo/payouts';
import { formatINRFromMinor } from '../lib/format';
import { MIN_WITHDRAWAL_RUPEES, TDS } from '../lib/site-copy';

const rupees = (r: number) => r * 100;

describe('TDS and net on a payout', () => {
  it('reproduces every designed 2c row from the site-copy rate', () => {
    for (const row of DEMO_PAYOUTS) {
      const b = withdrawalBreakdown(row.grossMinor);
      expect(b.tdsMinor).toBe(row.tdsMinor);
      expect(b.netMinor).toBe(row.netMinor);
      expect(b.grossMinor - b.tdsMinor).toBe(b.netMinor);
    }
    expect(DEMO_PAYOUTS.map((r) => formatINRFromMinor(withdrawalBreakdown(r.grossMinor).netMinor))).toEqual([
      '₹38,016',
      '₹50,737',
      '₹29,502',
      '₹43,659',
      '₹42,471',
    ]);
  });

  it('rounds the tax to the whole rupee, half up (₹51,250 at 1% → ₹513)', () => {
    expect(computeTdsMinor(rupees(51_250), 1)).toBe(rupees(513));
    expect(computeTdsMinor(rupees(38_450), 1)).toBe(rupees(385)); // ₹384.50 → ₹385
    expect(computeTdsMinor(rupees(38_449), 1)).toBe(rupees(384)); // ₹384.49 → ₹384
    expect(computeTdsMinor(12_345, 1)).toBe(rupees(1)); // ₹1.2345 → ₹1
    expect(computeTdsMinor(rupees(149), 1)).toBe(rupees(1)); // ₹1.49 → ₹1
    expect(computeTdsMinor(rupees(150), 1)).toBe(rupees(2)); // ₹1.50 → ₹2
    expect(computeTdsMinor(0, 1)).toBe(0);
  });

  it('works for other (placeholder) rates, including fractional ones, in integer maths', () => {
    expect(rateToBps(1)).toBe(100);
    expect(rateToBps(0.1)).toBe(10);
    expect(computeTdsMinor(rupees(42_900), 0.1)).toBe(rupees(43)); // ₹42.90 → ₹43
    expect(computeTdsMinor(rupees(42_900), 5)).toBe(rupees(2_145));
    expect(computeTdsMinor(rupees(42_900), 0)).toBe(0);
    const big = withdrawalBreakdown(rupees(999_999_999), 1); // ₹99,99,99,999
    expect(Number.isSafeInteger(big.tdsMinor)).toBe(true);
    expect(big.tdsMinor).toBe(rupees(10_000_000)); // × 1% = ₹99,99,999.99 → ₹1,00,00,000
    expect(big.netMinor).toBe(big.grossMinor - big.tdsMinor);
  });

  it('rejects money that is not integer paise and rates outside 0–100%', () => {
    expect(() => computeTdsMinor(100.5, 1)).toThrow(RangeError);
    expect(() => computeTdsMinor(-100, 1)).toThrow(RangeError);
    expect(() => computeTdsMinor(100, -1)).toThrow(RangeError);
    expect(() => computeTdsMinor(100, 101)).toThrow(RangeError);
    expect(() => computeTdsMinor(100, Number.NaN)).toThrow(RangeError);
  });

  it('labels the deduction from site-copy', () => {
    expect(tdsLabel()).toBe(`TDS ${TDS.ratePct}% (${TDS.section})`);
    expect(tdsLabel(1, '194-O')).toBe('TDS 1% (194-O)');
    expect(withdrawalBreakdown(rupees(1_000)).section).toBe(TDS.section);
  });
});

describe('the minimum withdrawal', () => {
  const min = minWithdrawalMinor();

  it('is the site-copy figure in paise', () => {
    expect(min).toBe(MIN_WITHDRAWAL_RUPEES * 100);
    expect(minWithdrawalMinor(500)).toBe(50_000);
  });

  it('enables Withdraw from the minimum up and disables it below, with the reason', () => {
    expect(withdrawEligibility(DEMO_CREATOR_SUMMARY.availableMinor)).toEqual({ ok: true, reason: '' });
    expect(withdrawEligibility(min).ok).toBe(true);
    const below = withdrawEligibility(min - 1);
    expect(below.ok).toBe(false);
    expect(below.reason).toContain(formatINRFromMinor(min));
    expect(withdrawEligibility(rupees(320))).toEqual({
      ok: false,
      reason: `The minimum withdrawal is ${formatINRFromMinor(min)}; ₹320 is available.`,
    });
    expect(withdrawEligibility(0).reason).toBe(`Nothing to withdraw yet. The minimum withdrawal is ${formatINRFromMinor(min)}.`);
  });

  it('checks the amount typed in the dialog: whole rupees, minimum to available', () => {
    const available = DEMO_CREATOR_SUMMARY.availableMinor; // ₹42,900
    expect(validateWithdrawAmount('42900', available)).toEqual({ ok: true, message: '', grossMinor: available });
    expect(validateWithdrawAmount(' ₹42,900 ', available).grossMinor).toBe(available);
    expect(validateWithdrawAmount(String(MIN_WITHDRAWAL_RUPEES), available).ok).toBe(true);
    expect(validateWithdrawAmount(String(MIN_WITHDRAWAL_RUPEES - 1), available).message).toBe(
      `The minimum withdrawal is ${formatINRFromMinor(min)}.`,
    );
    expect(validateWithdrawAmount('42901', available).message).toBe('You can withdraw up to ₹42,900.');
    expect(validateWithdrawAmount('', available).message).toBe('Enter an amount.');
    expect(validateWithdrawAmount('500.50', available).ok).toBe(false);
    expect(validateWithdrawAmount('-500', available).ok).toBe(false);
    expect(validateWithdrawAmount('5e3', available).ok).toBe(false);
    expect(validateWithdrawAmount('9'.repeat(20), available).message).toBe('That amount is too large.');
  });
});

describe('GET /v1/publisher/earnings → the balance cells', () => {
  const response = (inr: Partial<Record<'pending' | 'approved' | 'collected' | 'payable', number>> | null): EarningsResponse => ({
    publisher_id: '11111111-1111-4111-8111-111111111111',
    balances: inr ? { INR: { pending: 0, approved: 0, collected: 0, payable: 0, ...inr } } : {},
  });

  it('available = collected − already batched; pending = pending', () => {
    expect(mapEarningsToBalances(response({ pending: 11_248_000, approved: 9_000_000, collected: 20_000_000, payable: 15_710_000 }))).toEqual({
      availableMinor: 4_290_000,
      pendingMinor: 11_248_000,
    });
  });

  it('never goes negative and ignores approved earnings the brand has not paid for', () => {
    expect(mapEarningsToBalances(response({ approved: 5_000_000, collected: 100, payable: 900 })).availableMinor).toBe(0);
    expect(mapEarningsToBalances(response({ approved: 5_000_000 })).availableMinor).toBe(0);
  });

  it('reads a missing currency bucket (or another currency only) as zero', () => {
    expect(mapEarningsToBalances(response(null))).toEqual({ availableMinor: 0, pendingMinor: 0 });
    const usdOnly: EarningsResponse = { publisher_id: 'x', balances: { USD: { pending: 5, approved: 5, collected: 5, payable: 0 } } };
    expect(mapEarningsToBalances(usdOnly)).toEqual({ availableMinor: 0, pendingMinor: 0 });
  });

  it('tolerates numeric strings from the wire', () => {
    const wire = { publisher_id: 'x', balances: { INR: { pending: '1200', approved: '0', collected: '5000', payable: '1000' } } };
    expect(mapEarningsToBalances(wire as unknown as EarningsResponse)).toEqual({ availableMinor: 4000, pendingMinor: 1200 });
  });
});

describe('Export CSV', () => {
  it('escapes fields and guards formulas', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('Sale ₹2,450')).toBe('"Sale ₹2,450"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('-500.00')).toBe('-500.00');
    expect(csvField(' lead')).toBe('" lead"');
    expect(csvField(12)).toBe('12');
    expect(csvField(null)).toBe('');
    expect(csvField(Number.NaN)).toBe('');
    expect(toCsv([['a', 'b'], [1, 2]])).toBe('a,b\r\n1,2\r\n');
  });

  it('writes money as rupees from integer paise', () => {
    expect(minorToRupees(3_801_600)).toBe('38016.00');
    expect(minorToRupees(610)).toBe('6.10');
    expect(minorToRupees(5)).toBe('0.05');
    expect(minorToRupees(-9_100)).toBe('-91.00');
    expect(() => minorToRupees(1.5)).toThrow(RangeError);
  });

  it('builds the payouts table as drawn, labelled TEST demo data', () => {
    const csv = buildPayoutsCsv(DEMO_PAYOUTS);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"TEST demo data, not real figures"');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Date,Reference,Method,Gross (INR),TDS (INR),Net (INR),Status');
    expect(lines[3]).toBe('2026-09-26,PO-20926-118,UPI,38400.00,384.00,38016.00,Paid');
    expect(lines[6]).toBe('2026-09-05,PO-20905-042,Bank · Demo Bank,44100.00,441.00,43659.00,Paid');
    expect(lines[7]).toBe('2026-10-03,Scheduled,UPI,42900.00,429.00,42471.00,Scheduled');
    expect(lines).toHaveLength(3 + DEMO_PAYOUTS.length + 1); // label, blank, header, rows, trailing ''
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('builds the conversions and clicks tables', () => {
    const conv = buildConversionsCsv(DEMO_CONVERSION_ROWS).split('\r\n');
    expect(conv[2]).toBe('Date,Offer,Sub-ID,Platform,Event,Commission (INR),Status');
    expect(conv[3]).toBe('2026-09-29,Demo PayUPI,reel-oct-01,Meta,Sign-up,180.00,Pending');
    expect(conv[4]).toBe('2026-09-29,Demo Style Festive,short-diwali-02,YouTube,"Sale ₹2,450",294.00,Pending');
    const clicks = buildClicksCsv(DEMO_CLICK_ROWS).split('\r\n');
    expect(clicks[2]).toBe('Date,Offer,Sub-ID,Platform,Clicks,Conversions,CR (%)');
    expect(clicks[3]).toBe('2026-09-29,Demo PayUPI,reel-oct-01,Meta,2914,48,1.65');
    expect(buildClicksCsv([]).split('\r\n')).toEqual(['"TEST demo data, not real figures"', '', 'Date,Offer,Sub-ID,Platform,Clicks,Conversions,CR (%)', '']);
  });

  it('computes CR with two decimals, empty without clicks', () => {
    expect(conversionRatePct(48, 2914)).toBe(1.65);
    expect(conversionRatePct(0, 10)).toBe(0);
    expect(conversionRatePct(3, 0)).toBeNull();
  });

  it('names the file after the table and the period', () => {
    expect(payoutsCsvFilename('payouts', '2026-09')).toBe('afflino-demo-payouts-2026-09.csv');
    expect(payoutsCsvFilename('clicks', '2026-09')).toBe('afflino-demo-clicks-2026-09.csv');
  });
});

describe('the Conversions / Clicks demo rows', () => {
  it('are TEST-labelled, integer paise, and follow each offer’s payout', () => {
    const byId = new Map(DEMO_OFFERS.map((o) => [o.id, o]));
    for (const row of DEMO_CONVERSION_ROWS) {
      expect(row.offer).toMatch(/^Demo /);
      expect(row.id).toMatch(/^cv-demo-/);
      expect(Number.isInteger(row.commissionMinor)).toBe(true);
      const offer = byId.get(row.offerId);
      expect(offer?.name).toBe(row.offer);
      if (offer?.payout.type === 'flat') expect(row.commissionMinor).toBe(offer.payout.amountMinor);
      if (offer?.payout.type === 'percent') {
        const sale = Number(/₹([\d,]+)/.exec(row.event)?.[1]?.replace(/,/g, ''));
        expect(row.commissionMinor).toBe((sale * 100 * offer.payout.percent) / 100);
      }
    }
    for (const row of DEMO_CLICK_ROWS) {
      expect(row.offer).toMatch(/^Demo /);
      expect(row.conversions).toBeLessThanOrEqual(row.clicks);
    }
    expect(JSON.stringify([DEMO_CONVERSION_ROWS, DEMO_CLICK_ROWS]).toLowerCase()).not.toContain('cookie');
  });
});

describe('disputes / statements labels', () => {
  it('formats dates the way the tables print them', () => {
    expect(formatLongDate('2026-09-19')).toBe('19 Sep 2026');
    expect(formatLongDate('2026-09-18T20:00:00.000Z')).toBe('19 Sep 2026'); // 01:30 IST
    expect(formatLongDate('not a date')).toBe('—');
  });

  it('humanises codes and maps dispute statuses to tags', () => {
    expect(humanise('under_review')).toBe('Under review');
    expect(humanise('open')).toBe('Open');
    expect(disputeStatusTag('open')).toBe('outline');
    expect(disputeStatusTag('under_review')).toBe('outline');
    expect(disputeStatusTag('resolved')).toBe('accent');
    expect(disputeStatusTag('rejected')).toBe('neutral');
  });

  it('shortens live uuids, keeps demo ids', () => {
    expect(shortTicketId('3f2a9c1b-0000-4000-8000-000000000000')).toBe('#3f2a9c1b');
    expect(shortTicketId('d-14')).toBe('d-14');
  });
});
