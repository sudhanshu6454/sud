import { describe, expect, it } from 'vitest';
import { DEMO_BILLED_PAYOUT_MINOR, approvedPayoutsMinor, networkFeeDueMinor, validateTopUp } from '../components/brand/billingModel';
import {
  DEMO_CSV_LABEL,
  adjustCounts,
  applyDecisions,
  buildConversionsCsv,
  canDecide,
  csvField,
  minorToRupees,
  rejectionText,
  validateBy,
  validateRejection,
  windowDays,
} from '../components/brand/conversionsModel';
import { feeMinor } from '../components/brand/offerModel';
import { allowedDomain, brandSettingsDirty, normaliseBrandSettings, validateBrandSettings } from '../components/brand/settingsModel';
import { emptyRequestsMessage } from '../components/brand/requestsModel';
import { hasSeedShape } from '../components/brand/storage';
import { DEMO_CREATOR_REQUESTS, DEMO_TOP_CREATORS } from '../lib/demo/afflino';
import * as brand from '../lib/demo/brand';
import { formatCount, formatINRCompactFromMinor, formatINRFromMinor, formatPct } from '../lib/format';
import { PRICING } from '../lib/site-copy';

const S = brand.DEMO_BRAND_SUMMARY;

describe('brand overview figures (2b / 3f) print as drawn', () => {
  it('KPI strip', () => {
    expect(formatINRCompactFromMinor(S.spendMinor)).toBe('₹18.4L');
    expect(formatINRCompactFromMinor(S.budgetMinor)).toBe('₹25L');
    expect(formatCount(S.signUps)).toBe('10,212');
    expect(formatPct(S.signUpsDeltaPct, { signed: true })).toBe('+31%');
    // Cost / sign-up is spend ÷ sign-ups: ₹180.18 → "₹180".
    expect(formatINRFromMinor(Math.round(S.spendMinor / S.signUps))).toBe('₹180');
    expect(formatCount(S.activeCreators)).toBe('642');
    expect(S.pendingRequests).toBe(38);
  });

  it('phone "Today" and the budget bar', () => {
    expect(formatCount(S.today.signUps)).toBe('412');
    expect(formatINRFromMinor(S.today.spendMinor)).toBe('₹74,160');
    expect(S.today.spendMinor).toBe(S.today.signUps * 18_000);
    expect(Math.round((S.spendMinor / S.budgetMinor) * 100)).toBe(74);
  });

  it('top creators table and request reach lines', () => {
    expect(DEMO_TOP_CREATORS.map((c) => formatINRFromMinor(c.payoutMinor))).toEqual([
      '₹2,52,360',
      '₹2,14,200',
      '₹1,33,920',
      '₹1,26,360',
      '₹92,700',
    ]);
    expect(DEMO_CREATOR_REQUESTS).toHaveLength(3);
  });
});

describe('brand demo data is TEST-labelled', () => {
  it('names only Demo creators, example.com addresses and demo references', () => {
    for (const c of brand.DEMO_CONVERSIONS) {
      expect(c.creator).toMatch(/^Demo /);
      expect(c.id).toMatch(/^txn-demo-/);
    }
    for (const r of brand.DEMO_BILLING_HISTORY) expect(r.reference).toMatch(/-DEMO-/);
    expect(brand.DEMO_BRAND_PROFILE.legalName).toMatch(/^Demo /);
    expect(brand.DEMO_BRAND_PROFILE.displayName).toMatch(/^Demo /);
    expect(new URL(brand.DEMO_BRAND_PROFILE.website).hostname).toMatch(/(^|\.)example\.com$/);
    expect(brand.DEMO_BRAND_PROFILE.billingEmail).toMatch(/@example\.com$/);
    expect(new URL(brand.DEMO_OFFER_DRAFT.landingPage).hostname).toBe(brand.DEMO_BRAND_DOMAIN);
    expect(brand.DEMO_BRAND_DOMAIN).toMatch(/example\.com$/);
    const text = JSON.stringify(brand);
    for (const real of ['Zestpay', 'Nykaa', 'Unacademy', 'Zomato', 'ixigo', 'HDFC', 'CredMint', 'priya.nair', 'okhdfc', 'DesiDeals']) {
      expect(text).not.toContain(real);
    }
    expect(text.toLowerCase()).not.toContain('cookie');
  });

  it('the conversion status split sums to the drawn 10,212 sign-ups', () => {
    const c = brand.DEMO_CONVERSION_COUNTS;
    expect(c.Approved + c.Pending + c.Rejected + c.Flagged).toBe(S.signUps);
  });

  it('plan invoices use the site-copy price', () => {
    const plan = brand.DEMO_BILLING_HISTORY.filter((r) => r.description.startsWith('Network plan'));
    expect(plan.length).toBeGreaterThan(0);
    for (const r of plan) expect(r.amountMinor).toBe(PRICING.network.monthlyRupees * 100);
  });

  it('bills the network fee on approved conversions, the base the conversions page bills', () => {
    // Only Approved is "Billed at the offer's payout" (/brand/conversions):
    // 8,934 × ₹180 = ₹16,08,120, and 8% of it is ₹1,28,649.60 — not 8% of
    // the ₹18.4L spend, which counts pending, rejected and flagged sign-ups.
    expect(DEMO_BILLED_PAYOUT_MINOR).toBe(18_000);
    expect(approvedPayoutsMinor()).toBe(brand.DEMO_CONVERSION_COUNTS.Approved * 18_000);
    expect(formatINRFromMinor(approvedPayoutsMinor())).toBe('₹16,08,120');
    const fee = networkFeeDueMinor(PRICING.network.networkFeePct);
    expect(fee).toBe(feeMinor(approvedPayoutsMinor(), 8));
    expect(formatINRFromMinor(fee, { paise: true })).toBe('₹1,28,649.60');
    expect(approvedPayoutsMinor()).toBeLessThan(S.spendMinor);
  });
});

describe('brand conversions', () => {
  const rows = brand.DEMO_CONVERSIONS;
  const pending = rows.filter((r) => r.status === 'Pending');
  const flagged = rows.find((r) => r.status === 'Flagged')!;

  it('lets the brand decide pending conversions only', () => {
    expect(pending.length).toBeGreaterThan(0);
    for (const r of rows) expect(canDecide(r)).toBe(r.status === 'Pending');
    const out = applyDecisions(rows, {
      [pending[0]!.id]: { status: 'Approved' },
      [pending[1]!.id]: { status: 'Rejected', reason: 'Duplicate account' },
      [flagged.id]: { status: 'Approved' },
    });
    expect(out.find((r) => r.id === pending[0]!.id)?.status).toBe('Approved');
    expect(out.find((r) => r.id === pending[1]!.id)).toMatchObject({ status: 'Rejected', reason: 'Duplicate account' });
    expect(out.find((r) => r.id === flagged.id)?.status).toBe('Flagged');
  });

  it('moves the month totals, keeping the total', () => {
    const decisions = {
      [pending[0]!.id]: { status: 'Approved' as const },
      [pending[1]!.id]: { status: 'Rejected' as const, reason: 'Other' },
      [flagged.id]: { status: 'Approved' as const },
    };
    const next = adjustCounts(brand.DEMO_CONVERSION_COUNTS, rows, decisions);
    expect(next.Pending).toBe(brand.DEMO_CONVERSION_COUNTS.Pending - 2);
    expect(next.Approved).toBe(brand.DEMO_CONVERSION_COUNTS.Approved + 1);
    expect(next.Rejected).toBe(brand.DEMO_CONVERSION_COUNTS.Rejected + 1);
    expect(next.Flagged).toBe(brand.DEMO_CONVERSION_COUNTS.Flagged);
    expect(next.Approved + next.Pending + next.Rejected + next.Flagged).toBe(S.signUps);
  });

  it('dates the validation deadline from the offer window, in India time', () => {
    expect(windowDays('UPI sign-up')).toBe(7);
    expect(windowDays('Refer a friend')).toBe(14);
    expect(windowDays('Unknown offer')).toBe(7);
    expect(validateBy('2026-09-29T14:02:00+05:30', 7)).toBe('2026-10-06');
    expect(validateBy('2026-09-29T23:30:00+05:30', 7)).toBe('2026-10-06');
  });

  it('requires a reason to reject', () => {
    expect(validateRejection('', '')).toMatch(/Choose/);
    expect(validateRejection('Duplicate account', '')).toBeNull();
    expect(validateRejection('Other', 'no')).toMatch(/note/);
    expect(validateRejection('Other', 'Test order from staff')).toBeNull();
    expect(validateRejection('Duplicate account', 'x'.repeat(201))).toMatch(/200/);
    expect(rejectionText('Duplicate account', '')).toBe('Duplicate account');
    expect(rejectionText('Duplicate account', 'same PAN')).toBe('Duplicate account: same PAN');
    expect(rejectionText('Other', ' Staff test ')).toBe('Staff test');
  });

  it('exports an RFC 4180 CSV labelled as TEST data, money from integer paise', () => {
    const csv = buildConversionsCsv(rows.slice(0, 2));
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(`"${DEMO_CSV_LABEL}"`); // the label has a comma, so it is quoted
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('time_ist,conversion_id,creator,platform,offer,sub_id,payout_inr,status,reason');
    expect(lines[3]).toBe('2026-09-29T14:02:00+05:30,txn-demo-20929-0412,Demo Priya Nair,Instagram,UPI sign-up,reel-oct-01,180.00,pending,');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('-12')).toBe('-12');
    expect(minorToRupees(18_050)).toBe('180.50');
    expect(minorToRupees(-5)).toBe('-0.05');
    expect(() => minorToRupees(1.5)).toThrow();
  });
});

describe('brand settings', () => {
  const good = { ...brand.DEMO_BRAND_PROFILE };

  it('accepts the demo profile, and a valid GSTIN', () => {
    expect(validateBrandSettings(good)).toEqual({});
    expect(validateBrandSettings({ ...good, gstin: '27abcde1234f1z5' })).toEqual({});
  });

  it('flags each field', () => {
    const e = validateBrandSettings({ legalName: '', displayName: '', gstin: '27ABCDE1234F1Z', website: '', category: 'Nope', billingEmail: 'x' });
    expect(Object.keys(e).sort()).toEqual(['billingEmail', 'category', 'displayName', 'gstin', 'legalName', 'website']);
    expect(e.gstin).toMatch(/15 characters/);
    expect(validateBrandSettings({ ...good, gstin: '27ABCDE1234F1X5' }).gstin).toMatch(/valid GSTIN/);
    expect(validateBrandSettings({ ...good, website: 'http://shop.example.com' }).website).toMatch(/https/);
    expect(validateBrandSettings({ ...good, website: 'localhost' }).website).toBeDefined();
    expect(validateBrandSettings({ ...good, website: 'shop.example.com' }).website).toBeUndefined();
  });

  it('normalises what it stores and derives the landing domain', () => {
    const n = normaliseBrandSettings({ ...good, legalName: '  Demo Co  ', gstin: ' 27abcde1234f1z5 ', website: 'shop.example.com' });
    expect(n.legalName).toBe('Demo Co');
    expect(n.gstin).toBe('27ABCDE1234F1Z5');
    expect(n.website).toBe('https://shop.example.com');
    expect(allowedDomain(n)).toBe('shop.example.com');
  });

  it('is dirty only when a normalised value changed (Save stays disabled otherwise)', () => {
    expect(brandSettingsDirty(good, good)).toBe(false);
    expect(brandSettingsDirty({ ...good, legalName: `  ${good.legalName} ` }, good)).toBe(false);
    expect(brandSettingsDirty({ ...good, displayName: 'Demo Other' }, good)).toBe(true);
  });
});

describe('creator requests list', () => {
  it('is honest about the demo sample once it is used up', () => {
    expect(emptyRequestsMessage(0)).toBe('No creator requests waiting.');
    expect(emptyRequestsMessage(35)).toBe('The demo requests are decided; the other 35 are not in the demo data.');
  });
});

describe('wallet top-up (demo, no payment)', () => {
  it('validates the amount', () => {
    expect(validateTopUp('')).toMatchObject({ ok: false });
    expect(validateTopUp('₹0')).toMatchObject({ ok: false });
    expect(validateTopUp('five lakh')).toMatchObject({ ok: false });
    expect(validateTopUp('₹5,00,000')).toEqual({ ok: true, minor: 50_000_000 });
    expect(validateTopUp('100000.50')).toEqual({ ok: true, minor: 10_000_050 });
    for (const r of brand.DEMO_TOP_UP_PRESETS_RUPEES) expect(validateTopUp(String(r))).toEqual({ ok: true, minor: r * 100 });
  });
});

describe('brand demo storage', () => {
  it('uses a stored partition only when it has the seed shape', () => {
    // '{"own":null}' used to crash /brand/conversions; it now restarts from the seed.
    expect(hasSeedShape(null, {})).toBe(false);
    expect(hasSeedShape(undefined, {})).toBe(false);
    expect(hasSeedShape([], {})).toBe(false);
    expect(hasSeedShape('x', {})).toBe(false);
    expect(hasSeedShape({ a: 1 }, {})).toBe(true);
    expect(hasSeedShape({}, [])).toBe(false);
    expect(hasSeedShape([1], [])).toBe(true);
    expect(hasSeedShape(3, 0)).toBe(true);
    expect(hasSeedShape('3', 0)).toBe(false);
  });
});
