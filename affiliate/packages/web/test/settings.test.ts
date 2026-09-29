import { describe, expect, it } from 'vitest';
import {
  SETTINGS_STORAGE_KEY,
  defaultSettings,
  loadSettings,
  parseStoredSettings,
  payoutMethodSummary,
  platformDetail,
  saveSettings,
  serialiseSettings,
  settingsEqual,
  validateAccountNumber,
  validateDisplayName,
  validateHandle,
  validateIfsc,
  validateSettings,
  validateShortText,
  type CreatorSettings,
} from '../components/creator/settings/model';
import { DEMO_CREATOR } from '../lib/demo/afflino';
import { DEMO_CONNECTED_DETAIL, DEMO_NOTIFICATION_PREFS, DEMO_PAN } from '../lib/demo/payouts';
import { validatePan } from '../lib/validators';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const edit = (patch: (s: CreatorSettings) => void): CreatorSettings => {
  const s = structuredClone(defaultSettings());
  patch(s);
  return s;
};

describe('settings defaults (2d)', () => {
  it('are the designed profile and platforms, TEST-labelled', () => {
    const s = defaultSettings();
    expect(s.profile).toEqual({
      displayName: 'Demo Priya Nair',
      handle: '@demo.priyanair',
      language: 'English, Hindi',
      niche: 'Personal finance, lifestyle',
    });
    expect(s.platforms).toEqual({ instagram: true, youtube: true, snapchat: false });
    expect(s.payout.method).toBe('upi');
    expect(s.payout.upiId).toBe(DEMO_CREATOR.upiId);
    for (const n of DEMO_NOTIFICATION_PREFS) expect(s.notifications[n.id]).toBe(n.defaultOn);
    expect(validateSettings(s).ok).toBe(true);
  });

  it('carry a PAN that passes the shape check but cannot be anyone’s', () => {
    expect(validatePan(DEMO_PAN).ok).toBe(true);
    expect(DEMO_PAN.charAt(3)).toBe('O'); // no PAN holder type is "O"
    expect(DEMO_PAN.slice(5, 9)).toBe('0000'); // no PAN serial is 0000
    expect(DEMO_PAN.startsWith('DEMO')).toBe(true);
  });
});

describe('field checks', () => {
  it('display name: required, collapsed spaces, at most 60', () => {
    expect(validateDisplayName('  Demo   Priya  ')).toEqual({ ok: true, message: '', value: 'Demo Priya' });
    expect(validateDisplayName('').ok).toBe(false);
    expect(validateDisplayName('x'.repeat(61)).ok).toBe(false);
  });

  it('handle: @ added, lowercased, 3–30 of a–z 0–9 . _', () => {
    expect(validateHandle('Demo.PriyaNair').value).toBe('@demo.priyanair');
    expect(validateHandle('@demo_priya').value).toBe('@demo_priya');
    expect(validateHandle('@ab').ok).toBe(false);
    expect(validateHandle('bad handle!').message).toBe('Use letters, digits, dots and underscores only.');
    expect(validateHandle('a'.repeat(31)).ok).toBe(false);
    expect(validateHandle('').message).toBe('Enter your handle.');
  });

  it('language / niche: required, at most 80', () => {
    expect(validateShortText(' English,  Hindi ', 'languages').value).toBe('English, Hindi');
    expect(validateShortText('', 'niche').message).toBe('Enter your niche.');
    expect(validateShortText('x'.repeat(81), 'niche').ok).toBe(false);
  });

  it('bank account number: 9–18 digits, spaces and hyphens dropped', () => {
    expect(validateAccountNumber('0000 1234 5678').value).toBe('000012345678');
    expect(validateAccountNumber('12345678').ok).toBe(false);
    expect(validateAccountNumber('1'.repeat(19)).ok).toBe(false);
    expect(validateAccountNumber('12345678x').message).toBe('Use digits only.');
  });

  it('IFSC: 4 letters, 0, 6 alphanumerics; upper-cased', () => {
    expect(validateIfsc('demo0a1b2c3').value).toBe('DEMO0A1B2C3');
    expect(validateIfsc('DEMO1A1B2C3').ok).toBe(false); // fifth character must be 0
    expect(validateIfsc('DEM00A1B2C3').ok).toBe(false);
    expect(validateIfsc('').message).toBe('Enter the IFSC.');
  });
});

describe('validateSettings', () => {
  it('normalises what it saves', () => {
    const v = validateSettings(
      edit((s) => {
        s.profile.handle = 'Demo.PriyaNair';
        s.payout.pan = ' demox0000z ';
        s.payout.gstin = '';
      }),
    );
    expect(v.ok).toBe(true);
    expect(v.normalized.profile.handle).toBe('@demo.priyanair');
    expect(v.normalized.payout.pan).toBe(DEMO_PAN);
  });

  it('checks the UPI ID for UPI and only the bank fields for bank transfer', () => {
    const upi = validateSettings(edit((s) => (s.payout.upiId = 'not-a-upi')));
    expect(upi.ok).toBe(false);
    expect(Object.keys(upi.errors)).toEqual(['upiId']);

    const bank = validateSettings(
      edit((s) => {
        s.payout.method = 'bank';
        s.payout.upiId = 'not-a-upi'; // ignored for bank transfer
        s.payout.bankAccount = '12';
        s.payout.ifsc = '';
      }),
    );
    expect(Object.keys(bank.errors).sort()).toEqual(['bankAccount', 'ifsc']);

    const bankOk = validateSettings(
      edit((s) => {
        s.payout.method = 'bank';
        s.payout.bankAccount = '0000 1234 5678';
        s.payout.ifsc = 'demo0a1b2c3';
      }),
    );
    expect(bankOk.ok).toBe(true);
    expect(bankOk.normalized.payout.bankAccount).toBe('000012345678');
  });

  it('reports PAN and GSTIN shape errors, GSTIN only when present', () => {
    const v = validateSettings(
      edit((s) => {
        s.payout.pan = 'ABC';
        s.payout.gstin = '27ABC';
      }),
    );
    expect(v.errors.pan).toMatch(/PAN is 10 characters/);
    expect(v.errors.gstin).toBe('GSTIN is 15 characters.');
  });
});

describe('dirty tracking and storage', () => {
  it('compares settings by value, independent of key order', () => {
    const a = defaultSettings();
    const b = JSON.parse(JSON.stringify({ notifications: a.notifications, payout: a.payout, platforms: a.platforms, profile: a.profile }));
    expect(settingsEqual(a, b)).toBe(true);
    expect(settingsEqual(a, edit((s) => (s.platforms.snapchat = true)))).toBe(false);
    expect(settingsEqual(a, edit((s) => (s.notifications.product_news = true)))).toBe(false);
  });

  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const changed = edit((s) => {
      s.profile.niche = 'Money';
      s.payout.method = 'bank';
      s.platforms.snapchat = true;
    });
    expect(saveSettings(changed, storage)).toBe(true);
    expect(storage.data.has(SETTINGS_STORAGE_KEY)).toBe(true);
    expect(settingsEqual(loadSettings(storage), changed)).toBe(true);
  });

  it('falls back to the defaults when nothing, garbage or another version is stored', () => {
    expect(settingsEqual(loadSettings(memoryStorage()), defaultSettings())).toBe(true);
    expect(settingsEqual(loadSettings(null), defaultSettings())).toBe(true);
    expect(parseStoredSettings('{not json')).toBeNull();
    expect(parseStoredSettings(JSON.stringify({ version: 2, settings: {} }))).toBeNull();
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(settingsEqual(loadSettings(throwing), defaultSettings())).toBe(true);
    expect(saveSettings(defaultSettings(), throwing)).toBe(false);
  });

  it('ignores unknown keys and mistyped values in what is stored', () => {
    const raw = JSON.stringify({
      version: 1,
      settings: {
        profile: { displayName: 'Stored', handle: 42, extra: 'x' },
        platforms: { snapchat: 'yes', instagram: false },
        payout: { method: 'cash', upiId: 'stored@upi' },
        notifications: { weekly_report: true, unknown: true },
      },
    });
    const parsed = parseStoredSettings(raw)!;
    const base = defaultSettings();
    expect(parsed.profile.displayName).toBe('Stored');
    expect(parsed.profile.handle).toBe(base.profile.handle);
    expect('extra' in parsed.profile).toBe(false);
    expect(parsed.platforms).toEqual({ instagram: false, youtube: true, snapchat: false });
    expect(parsed.payout.method).toBe('upi');
    expect(parsed.payout.upiId).toBe('stored@upi');
    expect(parsed.notifications.weekly_report).toBe(true);
    expect('unknown' in parsed.notifications).toBe(false);
    expect(parseStoredSettings(serialiseSettings(base))).toEqual(base);
  });
});

describe('read-outs shared with Payouts', () => {
  it('platform detail lines', () => {
    expect(platformDetail('instagram', true)).toBe('@demo.priyanair · 1.2M followers · connected');
    expect(platformDetail('instagram', false)).toBe('Not connected');
    expect(platformDetail('snapchat', true)).toBe(DEMO_CONNECTED_DETAIL);
  });

  it('payout method summary for UPI and bank', () => {
    expect(payoutMethodSummary(defaultSettings())).toEqual({
      label: 'demo.priya@upi',
      short: 'UPI',
      withdrawLabel: 'Withdraw to UPI',
      panDemoVerified: true,
    });
    const bank = payoutMethodSummary(
      edit((s) => {
        s.payout.method = 'bank';
        s.payout.bankAccount = '000012345678';
        s.payout.pan = 'DEMOY0000Z'; // another impossible PAN, not the demo one
      }),
    );
    expect(bank).toEqual({ label: 'Bank account ····5678', short: 'Bank', withdrawLabel: 'Withdraw to bank', panDemoVerified: false });
    expect(payoutMethodSummary(edit((s) => (s.payout.method = 'bank'))).label).toBe('Bank account');
  });
});
