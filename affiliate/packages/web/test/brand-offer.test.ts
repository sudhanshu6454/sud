import { describe, expect, it } from 'vitest';
import {
  FIELD_STEP,
  OFFER_STEPS,
  STATUS_ACTIONS,
  blankOffer,
  costBreakdown,
  domainOf,
  errorsByStep,
  estimateReach,
  feeMinor,
  firstError,
  formToRow,
  formatBps,
  formatReach,
  networkFeePct,
  nextStatus,
  parsePercentToBps,
  parseRupeesToMinor,
  payoutLabel,
  payoutValue,
  percentPayoutMinor,
  rowPayoutLabel,
  rowToForm,
  validateDraft,
  validateOffer,
  type OfferForm,
} from '../components/brand/offerModel';
import { DEMO_BRAND_OFFERS, DEMO_OFFER_DRAFT, DEMO_REACH_MILLIONS } from '../lib/demo/brand';
import { PRICING } from '../lib/site-copy';

const CTX = { allowedDomain: 'shop.example.com' };

/** The 3b artboard's filled form. */
function drawn(): OfferForm {
  return {
    ...blankOffer(),
    name: DEMO_OFFER_DRAFT.name,
    model: DEMO_OFFER_DRAFT.model,
    payout: DEMO_OFFER_DRAFT.payout,
    unit: DEMO_OFFER_DRAFT.unit,
    event: DEMO_OFFER_DRAFT.event,
    budget: DEMO_OFFER_DRAFT.budget,
    platforms: [...DEMO_OFFER_DRAFT.platforms],
    validationDays: DEMO_OFFER_DRAFT.validationDays,
    brief: DEMO_OFFER_DRAFT.brief,
    landingPage: DEMO_OFFER_DRAFT.landingPage,
  };
}

describe('parsing amounts (integer paise, no floats, no rounding)', () => {
  it('reads rupees as typed', () => {
    expect(parseRupeesToMinor('₹25,00,000')).toEqual({ ok: true, value: 250_000_000 });
    expect(parseRupeesToMinor('180')).toEqual({ ok: true, value: 18_000 });
    expect(parseRupeesToMinor(' ₹ 180 ')).toEqual({ ok: true, value: 18_000 });
    expect(parseRupeesToMinor('Rs 180.5')).toEqual({ ok: true, value: 18_050 });
    expect(parseRupeesToMinor('INR 0.07')).toEqual({ ok: true, value: 7 });
    expect(parseRupeesToMinor('007')).toEqual({ ok: true, value: 700 });
  });

  it('rejects more than two decimals, signs, words and empty input', () => {
    for (const bad of ['180.505', '-180', '+180', '1e5', 'abc', '', '₹', '18 0.5.1', '0x10']) {
      expect(parseRupeesToMinor(bad).ok).toBe(false);
    }
  });

  it('reads percentages as basis points', () => {
    expect(parsePercentToBps('12%')).toEqual({ ok: true, value: 1200 });
    expect(parsePercentToBps('12.5')).toEqual({ ok: true, value: 1250 });
    expect(parsePercentToBps('0.25 %')).toEqual({ ok: true, value: 25 });
    expect(parsePercentToBps('12.345').ok).toBe(false);
    expect(parsePercentToBps('-4').ok).toBe(false);
    expect(formatBps(1200)).toBe('12%');
    expect(formatBps(1250)).toBe('12.5%');
    expect(formatBps(1225)).toBe('12.25%');
    expect(formatBps(5)).toBe('0.05%');
  });

  it('labels the payout as creators see it', () => {
    expect(payoutLabel(drawn())).toBe('₹180 / sign-up');
    expect(payoutLabel({ model: 'CPS', payout: '12%', unit: 'sale' })).toBe('12% / sale');
    expect(payoutLabel({ model: 'CPS', payout: '12.5', unit: '' })).toBe('12.5% / sale');
    expect(payoutLabel({ model: 'CPA', payout: '₹0', unit: 'sign-up' })).toBeNull();
    expect(payoutLabel({ model: 'CPS', payout: '₹180', unit: 'sale' })).toBeNull();
    expect(payoutValue({ model: 'CPS', payout: '100.01' })).toBeNull();
  });
});

describe('offer builder validation', () => {
  it('accepts the drawn 3b offer', () => {
    expect(validateOffer(drawn(), CTX)).toEqual({});
  });

  it('flags every required field on a blank form, each on its step', () => {
    const errors = validateOffer(blankOffer(), CTX);
    expect(Object.keys(errors).sort()).toEqual(['brief', 'budget', 'event', 'landingPage', 'name', 'payout', 'platforms'].sort());
    expect(firstError(errors)).toBe('name');
    expect(errorsByStep(errors)).toEqual({ basics: 6, payout: 0, audience: 0, creative: 1 });
    for (const field of Object.keys(errors) as Array<keyof OfferForm>) {
      expect(OFFER_STEPS.map((s) => s.id)).toContain(FIELD_STEP[field]);
    }
  });

  it('checks name length', () => {
    expect(validateOffer({ ...drawn(), name: 'ab' }, CTX).name).toMatch(/at least 3/);
    expect(validateOffer({ ...drawn(), name: 'x'.repeat(81) }, CTX).name).toMatch(/80/);
    expect(validateOffer({ ...drawn(), name: '   Diwali   ' }, CTX).name).toBeUndefined();
  });

  it('checks the payout by model: rupees for CPA / CPL / CPI, a percentage for CPS', () => {
    expect(validateOffer({ ...drawn(), payout: '₹0' }, CTX).payout).toMatch(/more than ₹0/);
    expect(validateOffer({ ...drawn(), payout: '180.555' }, CTX).payout).toMatch(/2 decimals/);
    expect(validateOffer({ ...drawn(), model: 'CPL', payout: '₹150' }, CTX).payout).toBeUndefined();
    expect(validateOffer({ ...drawn(), model: 'CPS', payout: '12%' }, CTX).payout).toBeUndefined();
    expect(validateOffer({ ...drawn(), model: 'CPS', payout: '₹180' }, CTX).payout).toMatch(/percentage/);
    expect(validateOffer({ ...drawn(), model: 'CPS', payout: '0%' }, CTX).payout).toMatch(/above 0/);
    expect(validateOffer({ ...drawn(), model: 'CPS', payout: '101' }, CTX).payout).toMatch(/at most 100/);
  });

  it('needs a budget that covers at least one flat payout', () => {
    expect(validateOffer({ ...drawn(), budget: '₹179' }, CTX).budget).toMatch(/at least one payout/);
    expect(validateOffer({ ...drawn(), budget: '₹180' }, CTX).budget).toBeUndefined();
    expect(validateOffer({ ...drawn(), budget: 'lots' }, CTX).budget).toMatch(/rupees/);
    // CPS: the payout per sale depends on the order value, so any positive cap is accepted.
    expect(validateOffer({ ...drawn(), model: 'CPS', payout: '12%', budget: '₹100' }, CTX).budget).toBeUndefined();
  });

  it('needs a platform, a listed validation window and a brief', () => {
    expect(validateOffer({ ...drawn(), platforms: [] }, CTX).platforms).toMatch(/at least one/);
    expect(validateOffer({ ...drawn(), platforms: ['web'] }, CTX).platforms).toMatch(/listed/);
    expect(validateOffer({ ...drawn(), validationDays: 5 }, CTX).validationDays).toBeDefined();
    for (const d of [3, 7, 14]) expect(validateOffer({ ...drawn(), validationDays: d }, CTX).validationDays).toBeUndefined();
    expect(validateOffer({ ...drawn(), brief: '  ' }, CTX).brief).toBeDefined();
    expect(validateOffer({ ...drawn(), brief: 'x'.repeat(1001) }, CTX).brief).toMatch(/1,000/);
  });

  it('keeps the landing page on the brand website (https only; subdomains allowed)', () => {
    const at = (landingPage: string, allowedDomain = 'shop.example.com') =>
      validateOffer({ ...drawn(), landingPage }, { allowedDomain }).landingPage;
    expect(at('https://shop.example.com/diwali-sale')).toBeUndefined();
    expect(at('https://www.shop.example.com/x')).toBeUndefined();
    expect(at('https://m.shop.example.com/x')).toBeUndefined();
    expect(at('http://shop.example.com/x')).toMatch(/https/);
    expect(at('https://shop.example.com.evil.test/x')).toMatch(/shop\.example\.com/);
    expect(at('https://notshop.example.com/x')).toMatch(/shop\.example\.com/);
    expect(at('shop.example.com/x')).toMatch(/https:\/\//);
    expect(at('https://shop.example.com/x', '')).toMatch(/Settings/);
  });

  it('checks the optional creative-kit fields', () => {
    expect(validateOffer({ ...drawn(), promoCode: 'DEMO12' }, CTX).promoCode).toBeUndefined();
    expect(validateOffer({ ...drawn(), promoCode: 'demo12' }, CTX).promoCode).toBeUndefined();
    expect(validateOffer({ ...drawn(), promoCode: 'AB1' }, CTX).promoCode).toBeDefined();
    expect(validateOffer({ ...drawn(), promoCode: 'DEMO-12' }, CTX).promoCode).toBeDefined();
    expect(validateOffer({ ...drawn(), assetsUrl: 'https://assets.example.com/kit' }, CTX).assetsUrl).toBeUndefined();
    expect(validateOffer({ ...drawn(), assetsUrl: 'ftp://assets.example.com' }, CTX).assetsUrl).toBeDefined();
    expect(validateOffer({ ...drawn(), model: 'CPS', payout: '12%', averageOrderValue: 'x' }, CTX).averageOrderValue).toBeDefined();
    expect(validateOffer({ ...drawn(), rules: 'x'.repeat(601) }, CTX).rules).toBeDefined();
  });

  it('saves a draft with only a name', () => {
    expect(validateDraft({ name: '' }).name).toMatch(/name/);
    expect(validateDraft({ name: 'Draft' })).toEqual({});
  });

  it('reads the allowed domain from the website setting', () => {
    expect(domainOf('https://shop.example.com')).toBe('shop.example.com');
    expect(domainOf('www.Example.com/path')).toBe('example.com');
    expect(domainOf('')).toBe('');
  });
});

describe('payout and fee maths (integer paise)', () => {
  it('uses the plan fee from site-copy', () => {
    expect(networkFeePct('network')).toBe(PRICING.network.networkFeePct);
    expect(networkFeePct('starter')).toBe(PRICING.starter.networkFeePct);
  });

  it('prices the drawn offer: ₹180 + 8% fee, ₹25L cap', () => {
    const b = costBreakdown(drawn(), 'network');
    expect(b).toEqual({
      payoutMinor: 18_000,
      feeMinor: 1_440, // ₹14.40
      costMinor: 19_440, // ₹194.40
      feePct: 8,
      conversionsInBudget: 13_888, // ₹25,00,000 ÷ ₹180, floored
      feeAtCapMinor: 20_000_000, // ₹2,00,000
    });
    expect(costBreakdown(drawn(), 'starter')?.feeMinor).toBe(2_700); // 15%
  });

  it('rounds the fee half up to the paisa and never uses floats for money', () => {
    expect(feeMinor(18_000, 8)).toBe(1_440);
    expect(feeMinor(1_006, 8)).toBe(80); // 80.48
    expect(feeMinor(1_025, 8)).toBe(82); // 82.0
    expect(feeMinor(1_031, 8)).toBe(82); // 82.48
    expect(feeMinor(1_032, 8)).toBe(83); // 82.56
    for (const n of [1, 999, 18_000, 250_000_000]) expect(Number.isInteger(feeMinor(n, 8))).toBe(true);
  });

  it('prices CPS at the average order value, or not at all', () => {
    const cps: OfferForm = { ...drawn(), model: 'CPS', payout: '12%', unit: 'sale', averageOrderValue: '' };
    expect(costBreakdown(cps, 'network')).toBeNull();
    const b = costBreakdown({ ...cps, averageOrderValue: '₹1,500' }, 'network');
    expect(b?.payoutMinor).toBe(18_000);
    expect(b?.feeMinor).toBe(1_440);
    expect(b?.conversionsInBudget).toBe(13_888);
    expect(percentPayoutMinor(99_999, 1_250)).toBe(12_500); // 12,499.875 paise → 12,500
    expect(percentPayoutMinor(100_000, 1_225)).toBe(12_250);
  });

  it('has no breakdown without a payout, and no cap figures without a budget', () => {
    expect(costBreakdown({ ...drawn(), payout: '' }, 'network')).toBeNull();
    const noBudget = costBreakdown({ ...drawn(), budget: '' }, 'network');
    expect(noBudget?.conversionsInBudget).toBeNull();
    expect(noBudget?.feeAtCapMinor).toBeNull();
  });

  it('estimates reach from the allowed platforms (the drawn 38–52M)', () => {
    const r = estimateReach(['meta', 'youtube', 'snapchat'], DEMO_REACH_MILLIONS);
    expect(r).toEqual([38, 52]);
    expect(formatReach(r!)).toBe('38–52M');
    expect(estimateReach([], DEMO_REACH_MILLIONS)).toBeNull();
    expect(estimateReach(['meta', 'youtube', 'snapchat', 'telegram'], DEMO_REACH_MILLIONS)).toEqual([40, 55]);
  });
});

describe('offer status flow: Draft → In review → Live → Paused / Ended (or Rejected)', () => {
  it('moves only along the flow', () => {
    expect(nextStatus('In review', 'withdraw')).toBe('Draft');
    expect(nextStatus('Live', 'pause')).toBe('Paused');
    expect(nextStatus('Paused', 'resume')).toBe('Live');
    expect(nextStatus('Live', 'end')).toBe('Ended');
    expect(nextStatus('Paused', 'end')).toBe('Ended');
    // not allowed
    expect(nextStatus('Draft', 'resume')).toBeNull();
    expect(nextStatus('Ended', 'resume')).toBeNull();
    expect(nextStatus('Rejected', 'pause')).toBeNull();
    expect(nextStatus('In review', 'pause')).toBeNull();
    expect(nextStatus('Live', 'withdraw')).toBeNull();
  });

  it('offers the brand no way to publish its own offer (review decides Live / Rejected)', () => {
    for (const [status, actions] of Object.entries(STATUS_ACTIONS)) {
      for (const a of actions) {
        const to = nextStatus(status as keyof typeof STATUS_ACTIONS, a);
        if (status !== 'Paused') expect(to).not.toBe('Live');
        expect(to).not.toBe('In review');
        expect(to).not.toBe('Rejected');
      }
    }
  });

  it('turns a builder form into a list row and back', () => {
    const row = formToRow('local-offer-1', drawn(), 'In review', '2026-09-29');
    expect(row).toMatchObject({
      name: 'Diwali UPI cashback',
      model: 'CPA',
      payoutType: 'flat',
      payoutValue: 18_000,
      budgetMinor: 250_000_000,
      status: 'In review',
    });
    expect(rowPayoutLabel(row)).toBe('₹180 / sign-up');
    const back = rowToForm(row, DEMO_OFFER_DRAFT.landingPage);
    expect(back.payout).toBe('₹180');
    expect(back.budget).toBe('₹25,00,000');
    expect(validateOffer({ ...back, brief: DEMO_OFFER_DRAFT.brief }, CTX)).toEqual({});
    expect(rowPayoutLabel(formToRow('x', { ...blankOffer(), name: 'Empty' }, 'Draft', '2026-09-29'))).toBe('—');
    const cps = formToRow('y', { ...drawn(), model: 'CPS', payout: '12.5%', unit: 'sale' }, 'Draft', '2026-09-29');
    expect(cps.payoutValue).toBe(1_250);
    expect(rowPayoutLabel(cps)).toBe('12.5% / sale');
  });

  it('every seed offer prints its payout', () => {
    expect(DEMO_BRAND_OFFERS.map(rowPayoutLabel)).toEqual([
      '₹180 / sign-up',
      '₹120 / sign-up',
      '₹90 / lead',
      '₹250 / lead',
      '₹60 / payment',
    ]);
  });
});
