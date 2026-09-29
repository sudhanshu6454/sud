import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CTA, HERO, HERO_STATS, PLANS, POSTER, STEPS, joinWithAnd, numberWord } from '../components/marketing/copy';
import {
  checkDevToken,
  checkPublisherId,
  clearDevSession,
  decodeTokenClaims,
  readDevSession,
  saveDevSession,
  tokenTail,
  type StorageLike,
} from '../components/marketing/devSession';
import { PUBLISHER_ID_KEY, TOKEN_KEY } from '../lib/api';
import { MARKETING_CLAIMS, PRICING } from '../lib/site-copy';

const WEB = join(__dirname, '..');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const MARKETING_SOURCES = [...filesUnder(join(WEB, 'app/(marketing)')), ...filesUnder(join(WEB, 'components/marketing'))]
  .filter((f) => /\.(tsx?|css)$/.test(f));

describe('marketing copy (1b) comes from lib/site-copy', () => {
  it('prints the design copy with the placeholder figures', () => {
    expect(HERO.title).toBe('400 million people. One link between them and your brand.');
    expect(HERO.body).toContain('across Meta, YouTube and Snapchat.');
    expect(HERO_STATS.map((s) => s.value)).toEqual(['400M', '₹0', 'T+7']);
    expect(HERO_STATS[0]!.label).toBe('Audience reach across three platforms');
    expect(PLANS.map((p) => p.priceLine)).toEqual([
      '₹0 / month · 15% network fee on approved payouts',
      '₹24,999 / month · 8% network fee',
    ]);
    expect(PLANS.map((p) => p.features)).toEqual([PRICING.starter.features, PRICING.network.features]);
    expect(STEPS.map((s) => s.eyebrow)).toEqual(['01 — List', '02 — Promote', '03 — Earn']);
    expect(POSTER?.title).toBe('Creators are free. Forever.');
  });

  it('follows the figures when they change', () => {
    expect(HERO.title.startsWith(MARKETING_CLAIMS.audienceReachWords)).toBe(true);
    expect(PLANS[1]!.priceLine).toContain(`${PRICING.network.networkFeePct}%`);
    expect(numberWord(3)).toBe('three');
    expect(numberWord(12)).toBe('12');
    expect(joinWithAnd(['A'])).toBe('A');
    expect(joinWithAnd(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('never restates a figure in a page or component', () => {
    const figures = /400M|400 million|24,?999|T\+7|\b15%|\b8%|₹0/;
    for (const file of MARKETING_SOURCES) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(figures);
    }
  });

  it('sends each call to action where the brief says', () => {
    expect(CTA.listOffer.href).toBe('/join?role=brand');
    expect(CTA.becomeCreator.href).toBe('/join?role=creator');
    expect(CTA.startFree.href).toBe('/join?role=brand&plan=starter');
    expect(CTA.talkToSales.href).toBe('/contact');
    expect(CTA.createFreeAccount.href).toBe('/join?role=creator');
    expect(PLANS.map((p) => p.cta)).toEqual([CTA.startFree, CTA.talkToSales]);
  });

  it('makes no cookie claim and invents no contact details', () => {
    for (const file of MARKETING_SOURCES) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/cookie/i);
    }
    const contact = readFileSync(join(WEB, 'app/(marketing)/contact/page.tsx'), 'utf8');
    expect(contact).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(contact).not.toMatch(/\+?\d[\d\s-]{7,}\d/);
    expect(contact).not.toMatch(/mailto:|tel:/);
    expect(contact).toContain('The contact channel will be published with the launch.');
    for (const page of ['terms', 'privacy']) {
      expect(readFileSync(join(WEB, `app/(marketing)/${page}/page.tsx`), 'utf8')).toContain(
        'This document is being prepared and will be published before launch.',
      );
    }
  });

  it('keeps the section anchors the nav links to', () => {
    const home = readFileSync(join(WEB, 'components/marketing/MarketingHome.tsx'), 'utf8');
    for (const id of ['brands', 'pricing', 'creators']) expect(home).toContain(`id="${id}"`);
  });
});

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const jwt = (claims: unknown) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.c2lnbmF0dXJl`;

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('dev sign-in (/login)', () => {
  const good = jwt({ sub: 'demo-user', org_id: 'demo-org', role: 'publisher_owner', exp: NOW / 1000 + 3600 });

  it('accepts a JWT-shaped token, pasted with a Bearer prefix or line breaks', () => {
    const checked = checkDevToken(`  Bearer ${good.slice(0, 20)}\n${good.slice(20)}  `, NOW);
    expect(checked.ok).toBe(true);
    expect(checked.value).toBe(good);
    expect(checked.claims).toEqual({ sub: 'demo-user', org_id: 'demo-org', role: 'publisher_owner', exp: NOW / 1000 + 3600 });
  });

  it('rejects empty, malformed, unreadable and expired tokens with a field message', () => {
    expect(checkDevToken('', NOW)).toMatchObject({ ok: false, message: 'Paste a development token.' });
    expect(checkDevToken('not-a-token', NOW).ok).toBe(false);
    expect(checkDevToken('a.b.c.d', NOW).ok).toBe(false);
    expect(checkDevToken('eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.c2ln', NOW).message).toMatch(/could not be read/);
    const expired = checkDevToken(jwt({ role: 'x', exp: NOW / 1000 - 1 }), NOW);
    expect(expired.ok).toBe(false);
    expect(expired.message).toMatch(/^This token expired on .+\. Mint a new one\.$/);
    expect(checkDevToken(jwt({ role: 'x' }), NOW).ok).toBe(true);
  });

  it('reads claims without trusting their types', () => {
    expect(decodeTokenClaims(jwt({ role: 7, exp: 'soon', org_id: 'o' }))).toEqual({ org_id: 'o' });
    expect(decodeTokenClaims(jwt([1, 2]))).toBeNull();
    expect(decodeTokenClaims('only.two')).toBeNull();
  });

  it('takes an optional uuid publisher id, stored lower-case', () => {
    expect(checkPublisherId('  ')).toEqual({ ok: true, message: '', value: '' });
    expect(checkPublisherId('1234').ok).toBe(false);
    expect(checkPublisherId('11111111-2222-4333-8444-5555555555AB')).toEqual({
      ok: true,
      message: '',
      value: '11111111-2222-4333-8444-5555555555ab',
    });
  });

  it('saves under lib/api.ts keys and signs out by removing both', () => {
    const storage = memoryStorage();
    expect(readDevSession(storage)).toBeNull();
    saveDevSession(storage, { token: good, publisherId: '11111111-2222-4333-8444-555555555555' });
    expect(storage.map.get(TOKEN_KEY)).toBe(good);
    expect(readDevSession(storage)).toEqual({ token: good, publisherId: '11111111-2222-4333-8444-555555555555' });
    saveDevSession(storage, { token: good, publisherId: '' });
    expect(storage.map.has(PUBLISHER_ID_KEY)).toBe(false);
    clearDevSession(storage);
    expect(storage.map.size).toBe(0);
    expect(tokenTail('abcdefghij')).toBe('efghij');
  });
});
