import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatCountCompact,
  formatDayMonth,
  formatINR,
  formatINRCompact,
  formatINRCompactFromMinor,
  formatINRFromMinor,
  formatINRWhole,
  formatMoney,
  formatPayout,
  formatPct,
  formatRate,
} from '../lib/format';
import {
  DEMO_AGENCY_CLIENTS,
  DEMO_AGENCY_ROSTER,
  DEMO_BRAND,
  DEMO_CREATOR,
  DEMO_CREATOR_SUMMARY,
  DEMO_FUNNEL,
  DEMO_MY_LINKS,
  DEMO_OFFERS,
  DEMO_PAYOUTS,
  DEMO_REVIEW_QUEUE,
  DEMO_SUB_IDS,
  DEMO_TOP_CREATORS,
  DEMO_TOP_LINKS,
  demoOfferById,
  platformList,
} from '../lib/demo/afflino';
import { loadLooks } from '../lib/console';
import {
  DEMO_CONVERSIONS,
  DEMO_DISPUTES,
  DEMO_LEDGER,
  DEMO_OFFERS as PORTAL_DEMO_OFFERS,
  DEMO_PLACEMENTS,
  DEMO_PROGRAMMES,
  DEMO_PROPERTIES,
  DEMO_SUSPENSE_ITEMS,
} from '../lib/portal-demo';
import { validateMobile } from '../lib/validators';

describe('existing exports keep their behaviour', () => {
  it('formatINR / formatMoney', () => {
    expect(formatINR(249900)).toBe('₹2,499');
    expect(formatMoney(18432000, 'INR')).toBe('₹1,84,320');
  });
});

describe('rupees: Indian grouping', () => {
  it.each([
    [184320, '₹1,84,320'],
    [2500000, '₹25,00,000'],
    [252360, '₹2,52,360'],
    [42900, '₹42,900'],
    [999, '₹999'],
    [1000, '₹1,000'],
    [0, '₹0'],
    [-500, '-₹500'],
    [48000000, '₹4,80,00,000'],
  ])('formatINRWhole(%d) = %s', (rupees, out) => {
    expect(formatINRWhole(rupees)).toBe(out);
  });

  it('from minor units, rounded to the rupee or with paise', () => {
    expect(formatINRFromMinor(18000)).toBe('₹180');
    expect(formatINRFromMinor(25236000)).toBe('₹2,52,360');
    expect(formatINRFromMinor(610, { paise: true })).toBe('₹6.10');
    expect(formatINRFromMinor(300, { paise: true })).toBe('₹3.00');
    expect(formatINRFromMinor(145, { paise: true })).toBe('₹1.45');
    expect(formatINRFromMinor(-51300)).toBe('-₹513');
    expect(formatINRFromMinor(Number.NaN)).toBe('—');
  });
});

describe('rupees: compact lakh / crore (truncated to one decimal)', () => {
  it.each([
    [48_000_000, '₹4.8Cr'],
    [5_260_000, '₹52.6L'],
    [1_840_000, '₹18.4L'],
    [2_500_000, '₹25L'],
    [620_000, '₹6.2L'],
    [920_000, '₹9.2L'],
    [410_000, '₹4.1L'],
    [184_320, '₹1.8L'],
    [100_000, '₹1L'],
    [99_999, '₹99,999'],
    [74_160, '₹74,160'],
    [9_999_999, '₹99.9L'],
    [10_000_000, '₹1Cr'],
    [1_234_560_000, '₹123.4Cr'],
  ])('formatINRCompact(%d) = %s', (rupees, out) => {
    expect(formatINRCompact(rupees)).toBe(out);
  });

  it('from minor units', () => {
    expect(formatINRCompactFromMinor(184_000_000)).toBe('₹18.4L');
    expect(formatINRCompactFromMinor(DEMO_BRAND.walletMinor)).toBe('₹6.2L');
    expect(formatINRCompactFromMinor(4_800_000_000)).toBe('₹4.8Cr');
    expect(formatINRCompactFromMinor(-184_000_000)).toBe('-₹18.4L');
  });
});

describe('counts: western grouping, compact K / M truncated', () => {
  it.each([
    [312_880, '312,880'],
    [271_040, '271,040'],
    [84_210, '84,210'],
    [4_106, '4,106'],
    [980, '980'],
    [18_406, '18,406'],
    [2_140, '2,140'],
  ])('formatCount(%d) = %s', (n, out) => {
    expect(formatCount(n)).toBe(out);
  });

  it.each([
    [312_880, '312.8K'],
    [1_200_000, '1.2M'],
    [9_800_000, '9.8M'],
    [420_000, '420K'],
    [1_100_000, '1.1M'],
    [260_000, '260K'],
    [1_500_000, '1.5M'],
    [880_000, '880K'],
    [640_000, '640K'],
    [310_000, '310K'],
    [999_999, '999.9K'],
    [999, '999'],
    [2_500_000_000, '2.5B'],
  ])('formatCountCompact(%d) = %s', (n, out) => {
    expect(formatCountCompact(n)).toBe(out);
  });
});

describe('percentages', () => {
  it('formatPct', () => {
    expect(formatPct(1.31, { decimals: 2 })).toBe('1.31%');
    expect(formatPct(1.9, { decimals: 1 })).toBe('1.9%');
    expect(formatPct(61)).toBe('61%');
    expect(formatPct(22, { signed: true })).toBe('+22%');
    expect(formatPct(31, { signed: true })).toBe('+31%');
    expect(formatPct(-4, { signed: true })).toBe('-4%');
    expect(formatPct(0, { signed: true })).toBe('0%');
  });
  it('formatRate', () => {
    expect(formatRate(4106, 312880)).toBe('1.31%');
    expect(formatRate(1, 0)).toBe('—');
  });
});

describe('dates', () => {
  it('formatDayMonth', () => {
    expect(formatDayMonth('2026-09-26', { pad: true })).toBe('26 Sep');
    expect(formatDayMonth('2026-09-05', { pad: true })).toBe('05 Sep');
    expect(formatDayMonth('2026-10-03')).toBe('3 Oct');
    expect(formatDayMonth('2026-10-03', { weekday: true })).toBe('Sat 3 Oct');
    // A timestamp is read in India time: 20:00 UTC on 30 Sep is 1 Oct in IST.
    expect(formatDayMonth('2026-09-30T20:00:00Z')).toBe('1 Oct');
    expect(formatDayMonth('not a date')).toBe('—');
  });
});

describe('demo data formats to exactly what the mocks print', () => {
  it('1c top links', () => {
    expect(
      DEMO_TOP_LINKS.map((l) => [l.offer, l.url, formatCount(l.clicks), formatCount(l.conversions), formatINRFromMinor(l.earnedMinor), l.status]),
    ).toEqual([
      ['Demo PayUPI', 'afflino.com/r/demo-priya/demo-payupi', '84,210', '1,402', '₹2,52,360', 'Active'],
      ['Demo Style Festive', 'afflino.com/r/demo-priya/demo-style', '61,004', '980', '₹58,800', 'Active'],
      ['Demo Learn Plus', 'afflino.com/r/demo-priya/demo-learn', '22,930', '311', '₹46,650', 'Paused'],
      ['Demo Eats Gold', 'afflino.com/r/demo-priya/demo-eats', '19,400', '702', '₹28,080', 'Review'],
    ]);
  });

  it('1c KPIs', () => {
    expect(formatINRFromMinor(DEMO_CREATOR_SUMMARY.earnings30dMinor)).toBe('₹1,84,320');
    expect(formatCount(DEMO_CREATOR_SUMMARY.clicks30d)).toBe('312,880');
    expect(formatCountCompact(DEMO_CREATOR_SUMMARY.clicks30d)).toBe('312.8K');
    expect(formatRate(DEMO_CREATOR_SUMMARY.conversions30d, DEMO_CREATOR_SUMMARY.clicks30d)).toBe('1.31%');
    expect(formatINRFromMinor(DEMO_CREATOR_SUMMARY.pendingMinor)).toBe('₹1,12,480');
  });

  it('1d offers', () => {
    expect(DEMO_OFFERS.map((o) => [o.name, formatPayout(o.payout), platformList(o.platforms)])).toEqual([
      ['Demo PayUPI', '₹180 / sign-up', 'Meta · YT · Snap'],
      ['Demo Style Festive', '12% / sale', 'Meta · YT'],
      ['Demo Learn Plus', '₹150 / lead', 'YT'],
      ['Demo Eats Gold', '₹40 / purchase', 'Meta · Snap'],
      ['Demo Ludo Arena', '₹22 / install', 'Meta · YT · Snap'],
      ['Demo Rail Trips', '4% / booking', 'YT · Snap'],
    ]);
    expect(demoOfferById('demo-payupi')?.name).toBe('Demo PayUPI');
    expect(demoOfferById('nope')).toBeUndefined();
    expect(new Set(DEMO_OFFERS.map((o) => o.id)).size).toBe(DEMO_OFFERS.length);
  });

  it('2c payouts', () => {
    expect(
      DEMO_PAYOUTS.map((p) => [
        formatDayMonth(p.date, { pad: true }),
        p.reference,
        p.method,
        formatINRFromMinor(p.grossMinor),
        formatINRFromMinor(p.tdsMinor),
        formatINRFromMinor(p.netMinor),
      ]),
    ).toEqual([
      ['26 Sep', 'PO-20926-118', 'UPI', '₹38,400', '₹384', '₹38,016'],
      ['19 Sep', 'PO-20919-094', 'UPI', '₹51,250', '₹513', '₹50,737'],
      ['12 Sep', 'PO-20912-071', 'UPI', '₹29,800', '₹298', '₹29,502'],
      ['05 Sep', 'PO-20905-042', 'Bank · Demo Bank', '₹44,100', '₹441', '₹43,659'],
      ['03 Oct', 'Scheduled', 'UPI', '₹42,900', '₹429', '₹42,471'],
    ]);
    for (const p of DEMO_PAYOUTS) expect(p.grossMinor - p.tdsMinor).toBe(p.netMinor);
  });

  it('2b, 3c, 3d, 3e rows', () => {
    expect(DEMO_TOP_CREATORS.map((c) => formatINRFromMinor(c.payoutMinor))).toEqual([
      '₹2,52,360',
      '₹2,14,200',
      '₹1,33,920',
      '₹1,26,360',
      '₹92,700',
    ]);
    expect(DEMO_MY_LINKS.map((l) => formatINRFromMinor(l.epcMinor, { paise: true }))).toEqual([
      '₹6.10',
      '₹3.00',
      '₹1.45',
      '₹2.03',
      '₹1.90',
    ]);
    expect(DEMO_MY_LINKS[0]?.url).toBe('afflino.com/r/demo-priya/demo-style?s=short-diwali-02');
    expect(DEMO_SUB_IDS.map((s) => [s.subId, formatCount(s.clicks), formatPct(s.crPct, { decimals: 1 }), formatINRFromMinor(s.earnedMinor)])).toEqual([
      ['reel-oct-01', '41,200', '1.9%', '₹1,40,940'],
      ['short-diwali-02', '12,400', '1.4%', '₹75,640'],
      ['story-12', '8,120', '0.9%', '₹15,430'],
      ['yt-long', '22,930', '1.4%', '₹46,650'],
      ['snap-01', '19,400', '3.6%', '₹28,080'],
    ]);
    expect(DEMO_FUNNEL.map((f, i) => (i === 0 ? formatCountCompact(f.value) : formatCount(f.value)))).toEqual([
      '9.8M',
      '312,880',
      '271,040',
      '4,106',
      '3,812',
    ]);
    expect(DEMO_AGENCY_CLIENTS.map((c) => formatINRCompactFromMinor(c.spendMinor))).toEqual(['₹18.4L', '₹9.2L', '₹4.1L']);
    expect(
      DEMO_AGENCY_ROSTER.map((r) => [
        formatCountCompact(r.reach),
        formatINRFromMinor(r.earnedMinor),
        `${formatINRFromMinor(r.agencyShareMinor)} (${r.agencySharePct}%)`,
      ]),
    ).toEqual([
      ['1.5M', '₹1,84,320', '₹27,648 (15%)'],
      ['880K', '₹1,33,920', '₹20,088 (15%)'],
      ['640K', '₹92,700', '₹13,905 (15%)'],
      ['420K', '₹38,200', '₹5,730 (15%)'],
    ]);
  });

  it('never names a real merchant: every proper noun is Demo-prefixed', () => {
    const names = [
      ...DEMO_OFFERS.map((o) => o.name),
      ...DEMO_TOP_LINKS.map((l) => l.offer),
      ...DEMO_TOP_CREATORS.map((c) => c.name),
      ...DEMO_AGENCY_CLIENTS.map((c) => c.name),
      ...DEMO_AGENCY_ROSTER.map((r) => r.name),
    ];
    for (const n of names) expect(n).toMatch(/^Demo /);
    const text = JSON.stringify([DEMO_OFFERS, DEMO_TOP_LINKS, DEMO_MY_LINKS, DEMO_REVIEW_QUEUE, DEMO_PAYOUTS, DEMO_AGENCY_CLIENTS]);
    for (const real of ['Zestpay', 'Nykaa', 'Unacademy', 'Zomato', 'ixigo', 'HDFC', 'CredMint', 'priya.nair', 'okhdfc', 'dealsx']) {
      expect(text).not.toContain(real);
    }
  });

  it('every demo identifier of the creator is TEST-marked; the mobile can never ring anyone', () => {
    expect(DEMO_CREATOR.name).toMatch(/^Demo /);
    expect(DEMO_CREATOR.handle).toMatch(/^demo-/);
    expect(DEMO_CREATOR.instagramHandle).toMatch(/^@demo\./);
    expect(DEMO_CREATOR.upiId).toMatch(/^demo\./);
    expect(DEMO_CREATOR.bank).toMatch(/^Demo /);
    expect(DEMO_CREATOR.panName).toMatch(/^DEMO /);
    // The design's "+91 98450 12345" is in a live series; the demo number is impossible (starts with 0).
    expect(DEMO_CREATOR.mobileDisplay).not.toContain('98450');
    expect(validateMobile(DEMO_CREATOR.mobileDisplay).ok).toBe(false);
    expect(JSON.stringify(DEMO_CREATOR)).not.toContain('98450');
  });

  it('no demo offer claims an attribution cookie (the redirect sets none)', () => {
    for (const o of DEMO_OFFERS) expect(o.description.toLowerCase()).not.toContain('cookie');
  });
});

describe('the restored portal / console demo data is TEST-labelled', () => {
  const REAL_MERCHANTS = ['Flipkart', 'Myntra', 'Ajio', 'Amazon', 'Nykaa', 'Meesho', 'Tata', 'Zaveri & Co'];

  it('programmes, properties, ledger, disputes and conversions name no real merchant', () => {
    const text = JSON.stringify([
      DEMO_PROGRAMMES,
      DEMO_PROPERTIES,
      PORTAL_DEMO_OFFERS,
      DEMO_PLACEMENTS,
      DEMO_LEDGER,
      DEMO_DISPUTES,
      DEMO_CONVERSIONS,
      DEMO_SUSPENSE_ITEMS,
    ]);
    for (const real of REAL_MERCHANTS) expect(text).not.toContain(real);
  });

  it('every proper noun is Demo-prefixed', () => {
    for (const p of [...DEMO_PROGRAMMES, ...DEMO_PROPERTIES]) expect(p.label).toMatch(/^Demo /);
    for (const o of PORTAL_DEMO_OFFERS) expect(o.label).toMatch(/^Demo /);
    for (const e of DEMO_LEDGER) {
      expect(e.programme).toMatch(/^Demo /);
      expect(e.property).toMatch(/^Demo /);
      expect(e.label).toMatch(/Demo |^Reversal/);
    }
    for (const c of DEMO_CONVERSIONS) {
      expect(c.product).toMatch(/^Demo /);
      expect(c.placement).toMatch(/^Demo /);
    }
    for (const s of DEMO_SUSPENSE_ITEMS) {
      expect(s.programme_name).toMatch(/^Demo /);
      expect(s.source_transaction_id).toMatch(/^DEMO-/);
    }
  });

  it('the editorial console seed looks are Demo-labelled', () => {
    const looks = loadLooks(); // no window under vitest: the seed
    expect(looks.length).toBeGreaterThan(0);
    for (const l of looks) {
      expect(l.title).toMatch(/^Demo /);
      expect(l.sourcePage).toMatch(/^Demo /);
    }
  });
});
