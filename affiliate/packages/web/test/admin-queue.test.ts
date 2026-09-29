import { describe, expect, it } from 'vitest';
import {
  QUEUE_STORAGE_KEY,
  filterLabel,
  initialQueueState,
  isClosed,
  loadDecisions,
  parseDecisions,
  queueCounts,
  queueReducer,
  saveDecisions,
  validateDecision,
  visibleItems,
  type QueueState,
} from '../components/admin/queueModel';
import { brandCounts, brandStatus, creatorCounts, creatorKyc, periodLabel } from '../components/admin/adminModel';
import {
  ADMIN_QUEUE_PAGE,
  ADMIN_QUEUE_TOTALS,
  ADMIN_REVIEW_ITEMS,
  DEMO_ADMIN_BRAND_COUNTS,
  DEMO_ADMIN_BRANDS,
  DEMO_ADMIN_CREATOR_COUNTS,
  DEMO_ADMIN_CREATORS,
  DEMO_ADMIN_KPIS,
  DEMO_FRAUD_SIGNALS,
  DEMO_SETTLEMENT_BATCHES,
  adminReviewItem,
} from '../lib/demo/admin';
import { DEMO_REVIEW_QUEUE } from '../lib/demo/afflino';
import { formatCount, formatINRCompactFromMinor } from '../lib/format';

const AT = '2026-09-29T10:00:00.000Z';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

function decide(state: QueueState, id: string, decision: 'approved' | 'rejected' | 'info_requested', note = '') {
  return queueReducer(state, { type: 'decide', id, decision, note, at: AT });
}

describe('admin review queue — filtering', () => {
  it('2e draws five rows: two fraud, two offer, one KYC, in that order', () => {
    expect(ADMIN_QUEUE_PAGE.map((i) => i.id)).toEqual(DEMO_REVIEW_QUEUE.map((i) => i.id));
    expect(ADMIN_QUEUE_PAGE.map((i) => i.type)).toEqual(['Fraud', 'Offer', 'KYC', 'Fraud', 'Offer']);
  });

  it('each filter keeps only its type and the original order; All keeps everything', () => {
    expect(visibleItems(ADMIN_QUEUE_PAGE, 'all')).toHaveLength(5);
    expect(visibleItems(ADMIN_QUEUE_PAGE, 'Fraud').map((i) => i.id)).toEqual(['rq-demo-1', 'rq-demo-4']);
    expect(visibleItems(ADMIN_QUEUE_PAGE, 'Offer').map((i) => i.id)).toEqual(['rq-demo-2', 'rq-demo-5']);
    expect(visibleItems(ADMIN_QUEUE_PAGE, 'KYC').map((i) => i.id)).toEqual(['rq-demo-3']);
  });

  it('the filter action switches the filter and leaves decisions alone', () => {
    let s = decide(initialQueueState(), 'rq-demo-1', 'approved');
    s = queueReducer(s, { type: 'filter', filter: 'KYC' });
    expect(s.filter).toBe('KYC');
    expect(s.decisions['rq-demo-1']?.decision).toBe('approved');
    // Same filter again: the same state object (no re-render churn).
    expect(queueReducer(s, { type: 'filter', filter: 'KYC' })).toBe(s);
  });

  it('prints the tag labels 2e draws', () => {
    const counts = queueCounts(ADMIN_QUEUE_TOTALS, ADMIN_QUEUE_PAGE, {});
    expect(
      (['all', 'Offer', 'KYC', 'Fraud'] as const).map((f) => filterLabel(f, formatCount(counts[f]))),
    ).toEqual(['All · 212', 'Offers · 14', 'KYC · 76', 'Fraud · 122']);
  });
});

describe('admin review queue — decisions', () => {
  it('a rejection needs a note; the reducer ignores one without', () => {
    expect(validateDecision('rejected', '   ').ok).toBe(false);
    const s0 = initialQueueState();
    expect(decide(s0, 'rq-demo-2', 'rejected', '  ')).toBe(s0);
    const s1 = decide(s0, 'rq-demo-2', 'rejected', '  Brand documents missing.  ');
    expect(s1.decisions['rq-demo-2']).toEqual({ decision: 'rejected', note: 'Brand documents missing.', decidedAt: AT });
  });

  it('approve and request info need no note; notes are capped', () => {
    expect(validateDecision('approved', '').ok).toBe(true);
    expect(validateDecision('info_requested', '').ok).toBe(true);
    expect(validateDecision('approved', 'x'.repeat(501)).ok).toBe(false);
  });

  it('a decision is recorded per item and can be reopened', () => {
    let s = decide(initialQueueState(), 'rq-demo-1', 'approved');
    s = decide(s, 'rq-demo-3', 'info_requested', 'Upload the PAN card image.');
    expect(Object.keys(s.decisions).sort()).toEqual(['rq-demo-1', 'rq-demo-3']);
    s = queueReducer(s, { type: 'reopen', id: 'rq-demo-1' });
    expect(s.decisions['rq-demo-1']).toBeUndefined();
    expect(s.decisions['rq-demo-3']?.note).toBe('Upload the PAN card image.');
    // Reopening something undecided is a no-op.
    expect(queueReducer(s, { type: 'reopen', id: 'rq-demo-9' })).toBe(s);
  });

  it('a later decision replaces the earlier one', () => {
    let s = decide(initialQueueState(), 'rq-demo-5', 'info_requested');
    s = decide(s, 'rq-demo-5', 'approved');
    expect(s.decisions['rq-demo-5']?.decision).toBe('approved');
  });

  it('approved and rejected items leave the open counts; info requested stays open', () => {
    let s = initialQueueState();
    s = decide(s, 'rq-demo-1', 'approved'); // fraud
    s = decide(s, 'rq-demo-2', 'rejected', 'Missing documents.'); // offer
    s = decide(s, 'rq-demo-3', 'info_requested'); // KYC, still open
    expect(isClosed(s.decisions['rq-demo-3'])).toBe(false);
    expect(queueCounts(ADMIN_QUEUE_TOTALS, ADMIN_QUEUE_PAGE, s.decisions)).toEqual({ all: 210, Offer: 13, KYC: 76, Fraud: 121 });
  });

  it('counts only decisions on items in the list, and never go below zero', () => {
    const decisions = { 'not-an-item': { decision: 'approved' as const, note: '', decidedAt: AT } };
    expect(queueCounts(ADMIN_QUEUE_TOTALS, ADMIN_QUEUE_PAGE, decisions).all).toBe(212);
    const all = Object.fromEntries(ADMIN_REVIEW_ITEMS.map((i) => [i.id, { decision: 'approved' as const, note: '', decidedAt: AT }]));
    expect(queueCounts({ all: 1, Offer: 0, KYC: 0, Fraud: 1 }, ADMIN_REVIEW_ITEMS, all)).toEqual({ all: 0, Offer: 0, KYC: 0, Fraud: 0 });
  });

  it('hydrate replaces the decisions (stored ones on load)', () => {
    const s = queueReducer(decide(initialQueueState(), 'rq-demo-1', 'approved'), {
      type: 'hydrate',
      decisions: { 'rq-demo-4': { decision: 'rejected', note: 'Bot traffic.', decidedAt: AT } },
    });
    expect(Object.keys(s.decisions)).toEqual(['rq-demo-4']);
  });
});

describe('admin review queue — storage', () => {
  it('round-trips decisions', () => {
    const storage = memoryStorage();
    const s = decide(decide(initialQueueState(), 'rq-demo-1', 'approved'), 'rq-demo-2', 'rejected', 'No licence.');
    expect(saveDecisions(storage, s.decisions)).toBe(true);
    expect(loadDecisions(storage)).toEqual(s.decisions);
    expect(storage.data.has(QUEUE_STORAGE_KEY)).toBe(true);
  });

  it('drops malformed or rule-breaking entries and survives broken storage', () => {
    expect(parseDecisions('not json')).toEqual({});
    expect(parseDecisions('[1,2]')).toEqual({});
    expect(
      parseDecisions(
        JSON.stringify({
          a: { decision: 'approved', note: '', decidedAt: AT },
          b: { decision: 'rejected', note: '' }, // a rejection without a note never counts
          c: { decision: 'deleted' },
          d: 'x',
        }),
      ),
    ).toEqual({ a: { decision: 'approved', note: '', decidedAt: AT } });
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadDecisions(throwing)).toEqual({});
    expect(saveDecisions(throwing, {})).toBe(false);
    expect(loadDecisions(null)).toEqual({});
  });
});

describe('admin demo data', () => {
  it('keeps the 2e KPI figures exactly', () => {
    expect([
      formatINRCompactFromMinor(DEMO_ADMIN_KPIS.gmvMinor),
      formatINRCompactFromMinor(DEMO_ADMIN_KPIS.networkFeeMinor),
      formatCount(DEMO_ADMIN_KPIS.liveOffers),
      formatCount(DEMO_ADMIN_KPIS.creators),
      formatCount(DEMO_ADMIN_KPIS.flaggedConversions),
    ]).toEqual(['₹4.8Cr', '₹52.6L', '128', '18,406', '1,284']);
  });

  it('the undrawn pages agree with the 2e totals', () => {
    expect(ADMIN_QUEUE_TOTALS.Offer + ADMIN_QUEUE_TOTALS.KYC + ADMIN_QUEUE_TOTALS.Fraud).toBe(ADMIN_QUEUE_TOTALS.all);
    expect(DEMO_FRAUD_SIGNALS.reduce((n, s) => n + s.flaggedConversions, 0)).toBe(DEMO_ADMIN_KPIS.flaggedConversions);
    expect(DEMO_FRAUD_SIGNALS.reduce((n, s) => n + s.openCases, 0)).toBe(ADMIN_QUEUE_TOTALS.Fraud);
    const c = DEMO_ADMIN_CREATOR_COUNTS;
    expect(c.Verified + c['In review'] + c['Not verified']).toBe(DEMO_ADMIN_KPIS.creators);
    expect(c['In review']).toBe(ADMIN_QUEUE_TOTALS.KYC);
    const september = DEMO_SETTLEMENT_BATCHES.filter((b) => b.to.startsWith('2026-09'));
    expect(september.reduce((n, b) => n + b.feeMinor, 0)).toBe(DEMO_ADMIN_KPIS.networkFeeMinor);
  });

  it('settlement batches are integer paise and net = gross − fee', () => {
    for (const b of DEMO_SETTLEMENT_BATCHES) {
      for (const v of [b.grossMinor, b.feeMinor, b.netMinor]) expect(Number.isSafeInteger(v)).toBe(true);
      expect(b.netMinor).toBe(b.grossMinor - b.feeMinor);
    }
  });

  it('every queue item a page links to exists, with the facts for its panel', () => {
    for (const id of [...DEMO_ADMIN_BRANDS, ...DEMO_ADMIN_CREATORS].map((r) => r.reviewItemId).filter(Boolean)) {
      expect(adminReviewItem(id as string)).toBeDefined();
    }
    for (const item of ADMIN_REVIEW_ITEMS) expect(item.details.length).toBeGreaterThan(0);
    for (const item of ADMIN_REVIEW_ITEMS.filter((i) => i.type === 'Fraud')) expect(item.signal).toBeDefined();
    expect(new Set(ADMIN_REVIEW_ITEMS.map((i) => i.id)).size).toBe(ADMIN_REVIEW_ITEMS.length);
  });

  it('is TEST-labelled: Demo names, demo handles, example domains, no real merchant', () => {
    for (const b of DEMO_ADMIN_BRANDS) expect(b.name).toMatch(/^Demo /);
    for (const c of DEMO_ADMIN_CREATORS) expect(c.name).toMatch(/^Demo /);
    for (const b of DEMO_SETTLEMENT_BATCHES) expect(b.id).toMatch(/^ST-DEMO-/);
    for (const i of ADMIN_REVIEW_ITEMS) {
      if (i.subject.startsWith('afflino.com/r/')) expect(i.subject).toMatch(/^afflino\.com\/r\/demo-[a-z]+\/demo-[a-z]+$/);
      else expect(i.subject).toMatch(/^Demo /);
    }
    const text = JSON.stringify([ADMIN_REVIEW_ITEMS, DEMO_ADMIN_BRANDS, DEMO_ADMIN_CREATORS, DEMO_FRAUD_SIGNALS]);
    for (const real of ['Zestpay', 'Nykaa', 'CredMint', 'Unacademy', 'Zomato', 'ixigo', 'dealsx', 'HDFC', 'Flipkart', 'Myntra']) {
      expect(text).not.toContain(real);
    }
    for (const domain of text.match(/[a-z0-9-]+\.(com|net|in|org)\b/g) ?? []) {
      expect(['afflino.com', 'example.com', 'example.net'].some((d) => domain.endsWith(d))).toBe(true);
    }
  });
});

describe('admin pages follow the queue decisions', () => {
  const cardmint = DEMO_ADMIN_BRANDS.find((b) => b.id === 'demo-cardmint')!;
  const meera = DEMO_ADMIN_CREATORS.find((c) => c.reviewItemId === 'rq-demo-3')!;
  const brandBase = {
    all: DEMO_ADMIN_BRAND_COUNTS.all,
    Active: DEMO_ADMIN_BRAND_COUNTS.Active,
    'In review': DEMO_ADMIN_BRAND_COUNTS['In review'],
    Paused: DEMO_ADMIN_BRAND_COUNTS.Paused,
  };

  it('a brand in review becomes Active on approval, Rejected on rejection', () => {
    expect(brandStatus(cardmint, {})).toBe('In review');
    const approved = decide(initialQueueState(), 'rq-demo-2', 'approved').decisions;
    expect(brandStatus(cardmint, approved)).toBe('Active');
    expect(brandCounts(brandBase, DEMO_ADMIN_BRANDS, approved)).toEqual({ all: 46, Active: 42, 'In review': 2, Paused: 2 });
    const rejected = decide(initialQueueState(), 'rq-demo-2', 'rejected', 'No licence.').decisions;
    expect(brandStatus(cardmint, rejected)).toBe('Rejected');
    expect(brandCounts(brandBase, DEMO_ADMIN_BRANDS, rejected)).toEqual({ all: 46, Active: 41, 'In review': 2, Paused: 2 });
    const info = decide(initialQueueState(), 'rq-demo-2', 'info_requested').decisions;
    expect(brandCounts(brandBase, DEMO_ADMIN_BRANDS, info)).toEqual(brandBase);
  });

  it('KYC in review follows its decision and moves the KYC counts', () => {
    expect(creatorKyc(meera, {})).toBe('In review');
    const approved = decide(initialQueueState(), 'rq-demo-3', 'approved').decisions;
    expect(creatorKyc(meera, approved)).toBe('Verified');
    expect(creatorCounts(DEMO_ADMIN_CREATOR_COUNTS, DEMO_ADMIN_CREATORS, approved)).toEqual({
      all: 18_406,
      Verified: 16_813,
      'In review': 75,
      'Not verified': 1_518,
    });
    const rejected = decide(initialQueueState(), 'rq-demo-3', 'rejected', 'Name does not match.').decisions;
    expect(creatorKyc(meera, rejected)).toBe('Rejected');
    expect(creatorCounts(DEMO_ADMIN_CREATOR_COUNTS, DEMO_ADMIN_CREATORS, rejected)['Not verified']).toBe(1_519);
    const info = decide(initialQueueState(), 'rq-demo-3', 'info_requested').decisions;
    expect(creatorKyc(meera, info)).toBe('Info requested');
    expect(creatorCounts(DEMO_ADMIN_CREATOR_COUNTS, DEMO_ADMIN_CREATORS, info)).toEqual({ ...DEMO_ADMIN_CREATOR_COUNTS });
  });

  it('prints settlement periods', () => {
    expect(DEMO_SETTLEMENT_BATCHES.map(periodLabel)).toEqual(['29 Sep – 5 Oct', '22–28 Sep', '15–21 Sep', '8–14 Sep', '1–7 Sep']);
  });
});
