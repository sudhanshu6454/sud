/**
 * The owner confirmed every figure in lib/site-copy.ts on 2026-09-29
 * ("figures are confirmed, keep them"). This pins them, so changing one is a
 * deliberate edit of both files, never a side effect. The #ad disclosure line
 * is wording, not a figure, and stays pending counsel.
 */
import { describe, expect, it } from 'vitest';
import {
  CREATOR_DISCLOSURE_LINE,
  DEFAULT_AGENCY_SHARE_PCT,
  MARKETING_CLAIMS,
  MIN_WITHDRAWAL_RUPEES,
  PRICING,
  TDS,
  VALIDATION_WINDOW_DAYS,
  VALIDATION_WINDOW_OPTIONS_DAYS,
} from '../lib/site-copy';

describe('site copy: the owner-confirmed figures', () => {
  it('keeps the confirmed marketing claims', () => {
    expect(MARKETING_CLAIMS).toEqual({
      audienceReach: '400M',
      audienceReachWords: '400 million',
      platforms: ['Meta', 'YouTube', 'Snapchat'],
      brandUpfrontCostRupees: 0,
      creatorPayoutCycle: 'T+7',
      creatorsFree: true,
    });
  });

  it('keeps the confirmed plans, fees and policy figures', () => {
    expect(PRICING.starter).toMatchObject({ monthlyRupees: 0, networkFeePct: 15, maxLiveOffers: 3 });
    expect(PRICING.network).toMatchObject({ monthlyRupees: 24_999, networkFeePct: 8, maxLiveOffers: null });
    expect(PRICING.network.features).toContain('Dedicated account manager');
    expect(TDS).toEqual({ ratePct: 1, section: '194-O' });
    expect(VALIDATION_WINDOW_DAYS).toBe(7);
    expect(VALIDATION_WINDOW_OPTIONS_DAYS).toEqual([3, 7, 14]);
    expect(MIN_WITHDRAWAL_RUPEES).toBe(500);
    expect(DEFAULT_AGENCY_SHARE_PCT).toBe(15);
  });

  it('still marks the disclosure wording as waiting for counsel', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../lib/site-copy.ts', import.meta.url), 'utf8');
    expect(src).toContain('WORDING PENDING COUNSEL SIGN-OFF');
    expect(CREATOR_DISCLOSURE_LINE.startsWith('#ad')).toBe(true);
  });
});
