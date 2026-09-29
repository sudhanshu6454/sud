import { describe, expect, it } from 'vitest';
import {
  AGENCY_STORAGE_KEYS,
  DEFAULT_AGENCY_SHARE_PCT,
  agencyShareMinor,
  formatShareCell,
  loadInvites,
  loadPendingClients,
  loadSharePct,
  parseSharePct,
  rosterWithShare,
  saveInvites,
  saveSharePct,
  totalShareMinor,
  validateClient,
  validateEmail,
  validateInvite,
} from '../components/agency/agencyModel';
import { DEMO_AGENCY_CLIENTS, DEMO_AGENCY_ROSTER } from '../lib/demo/afflino';
import { AGENCY_CLIENT_CATEGORIES, AGENCY_INVITE_PLATFORMS } from '../lib/demo/agency';
import { formatINRFromMinor } from '../lib/format';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('agency share maths', () => {
  it('the default share is 15% and reproduces the 3e share column exactly', () => {
    expect(DEFAULT_AGENCY_SHARE_PCT).toBe(15);
    expect(DEMO_AGENCY_ROSTER.map((r) => formatShareCell(r.earnedMinor, DEFAULT_AGENCY_SHARE_PCT))).toEqual([
      '₹27,648 (15%)',
      '₹20,088 (15%)',
      '₹13,905 (15%)',
      '₹5,730 (15%)',
    ]);
    // …and agrees with the figures stored in the demo data.
    for (const r of DEMO_AGENCY_ROSTER) expect(agencyShareMinor(r.earnedMinor, r.agencySharePct)).toBe(r.agencyShareMinor);
  });

  it('recomputes the column for another share', () => {
    const rows = rosterWithShare(DEMO_AGENCY_ROSTER, 20);
    expect(rows.map((r) => formatINRFromMinor(r.shareMinor))).toEqual(['₹36,864', '₹26,784', '₹18,540', '₹7,640']);
    expect(rows.every((r) => r.sharePct === 20)).toBe(true);
    expect(rosterWithShare(DEMO_AGENCY_ROSTER, 0).map((r) => r.shareMinor)).toEqual([0, 0, 0, 0]);
    expect(rosterWithShare(DEMO_AGENCY_ROSTER, 50).map((r) => r.shareMinor)).toEqual(
      DEMO_AGENCY_ROSTER.map((r) => r.earnedMinor / 2),
    );
  });

  it('stays in integer paise, rounding half up once', () => {
    expect(agencyShareMinor(1, 50)).toBe(1); // 0.5 paisa → 1
    expect(agencyShareMinor(1, 49)).toBe(0); // 0.49 paisa → 0
    expect(agencyShareMinor(333, 15)).toBe(50); // 49.95 → 50
    for (const pct of [0, 1, 7, 15, 33, 50]) {
      for (const r of DEMO_AGENCY_ROSTER) expect(Number.isSafeInteger(agencyShareMinor(r.earnedMinor, pct))).toBe(true);
    }
  });

  it('the total is the sum of the rounded cells', () => {
    expect(totalShareMinor(DEMO_AGENCY_ROSTER, 15)).toBe(2_764_800 + 2_008_800 + 1_390_500 + 573_000);
    expect(formatINRFromMinor(totalShareMinor(DEMO_AGENCY_ROSTER, 15))).toBe('₹67,371');
  });

  it('refuses amounts that are not integer paise and shares outside 0–50', () => {
    expect(() => agencyShareMinor(10.5, 15)).toThrow(RangeError);
    expect(() => agencyShareMinor(1000, 51)).toThrow(RangeError);
    expect(() => agencyShareMinor(1000, -1)).toThrow(RangeError);
    expect(() => agencyShareMinor(1000, 12.5)).toThrow(RangeError);
  });
});

describe('agency share input', () => {
  it('accepts whole numbers 0–50, with or without "%"', () => {
    expect(parseSharePct('15')).toEqual({ ok: true, value: 15 });
    expect(parseSharePct(' 20 % ')).toEqual({ ok: true, value: 20 });
    expect(parseSharePct('0')).toEqual({ ok: true, value: 0 });
    expect(parseSharePct('50')).toEqual({ ok: true, value: 50 });
  });

  it('rejects empty, out-of-range, fractional and non-numeric input', () => {
    for (const bad of ['', '51', '100', '-1', '12.5', 'abc', '1e1']) expect(parseSharePct(bad).ok).toBe(false);
  });

  it('persists the share; a missing or invalid stored value falls back to the default', () => {
    const storage = memoryStorage();
    expect(loadSharePct(storage)).toBe(15);
    expect(saveSharePct(storage, 22)).toBe(true);
    expect(loadSharePct(storage)).toBe(22);
    expect(loadSharePct(memoryStorage({ [AGENCY_STORAGE_KEYS.share]: '75' }))).toBe(15);
    expect(loadSharePct(memoryStorage({ [AGENCY_STORAGE_KEYS.share]: '"20"' }))).toBe(15);
    expect(loadSharePct(memoryStorage({ [AGENCY_STORAGE_KEYS.share]: '{' }))).toBe(15);
    expect(loadSharePct(null)).toBe(15);
  });
});

describe('agency dialogs', () => {
  it('invite: every field is required and checked', () => {
    const empty = validateInvite({ name: '', email: '', platform: '', handle: '' }, AGENCY_INVITE_PLATFORMS);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(Object.keys(empty.errors).sort()).toEqual(['email', 'handle', 'name', 'platform']);
    const ok = validateInvite(
      { name: '  Demo  New Creator ', email: 'Demo.New@Example.com ', platform: 'youtube', handle: '@demo.new' },
      AGENCY_INVITE_PLATFORMS,
    );
    expect(ok).toEqual({ ok: true, value: { name: 'Demo New Creator', email: 'demo.new@example.com', platform: 'youtube', handle: '@demo.new' } });
    expect(validateInvite({ name: 'Demo A', email: 'a@b.co', platform: 'myspace', handle: '@a' }, AGENCY_INVITE_PLATFORMS).ok).toBe(false);
  });

  it('client: GSTIN is optional but must be well-formed when given', () => {
    const base = { name: 'Demo Tea House', category: 'Food delivery', email: 'ops@example.com', gstin: '' };
    expect(validateClient(base, AGENCY_CLIENT_CATEGORIES).ok).toBe(true);
    const bad = validateClient({ ...base, gstin: '12345' }, AGENCY_CLIENT_CATEGORIES);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors)).toEqual(['gstin']);
    const good = validateClient({ ...base, gstin: '27abcde1234f1z5' }, AGENCY_CLIENT_CATEGORIES);
    expect(good.ok && good.value.gstin).toBe('27ABCDE1234F1Z5');
    expect(validateClient({ ...base, category: 'Crypto' }, AGENCY_CLIENT_CATEGORIES).ok).toBe(false);
  });

  it('email shape', () => {
    expect(validateEmail('name@example.com').ok).toBe(true);
    for (const bad of ['', 'name', 'name@', '@example.com', 'a b@example.com', 'name@example']) expect(validateEmail(bad).ok).toBe(false);
  });

  it('stored invites and clients are read back defensively', () => {
    const storage = memoryStorage();
    const invite = { id: 'demo-invite-1', name: 'Demo A', email: 'a@example.com', platform: 'youtube' as const, handle: '@a', createdAt: 'x' };
    saveInvites(storage, [invite]);
    expect(loadInvites(storage, AGENCY_INVITE_PLATFORMS)).toEqual([invite]);
    expect(loadInvites(memoryStorage({ [AGENCY_STORAGE_KEYS.invites]: JSON.stringify([{ ...invite, platform: 'x' }, 7]) }), AGENCY_INVITE_PLATFORMS)).toEqual([]);
    expect(loadPendingClients(memoryStorage({ [AGENCY_STORAGE_KEYS.clients]: '{"a":1}' }))).toEqual([]);
  });
});

describe('agency demo data', () => {
  it('client cells open the brand workspace ids the brand shell knows', () => {
    expect(DEMO_AGENCY_CLIENTS.map((c) => c.id)).toEqual(['demo-payupi', 'demo-style', 'demo-ludo']);
  });
});
