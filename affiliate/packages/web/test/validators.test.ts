import { describe, expect, it } from 'vitest';
import {
  validateGstin,
  validateMobile,
  validateOtp,
  validatePan,
  validateSubId,
  validateUpi,
} from '../lib/validators';

describe('validateMobile (+91, 10 digits)', () => {
  it.each([
    ['+91 98450 12345', '+919845012345'],
    ['+919845012345', '+919845012345'],
    ['9845012345', '+919845012345'],
    ['919845012345', '+919845012345'],
    ['09845012345', '+919845012345'],
    ['98450-12345', '+919845012345'],
    ['6000000000', '+916000000000'],
  ])('accepts %s', (input, value) => {
    expect(validateMobile(input)).toEqual({ ok: true, message: '', value });
  });

  it.each(['', '12345', '98450123456', '+1 415 555 0100', '5845012345', '+91 98450 1234x', '+44 98450 12345'])(
    'rejects %j',
    (input) => {
      const r = validateMobile(input);
      expect(r.ok).toBe(false);
      expect(r.message).not.toBe('');
    },
  );

  it('allows empty when optional', () => {
    expect(validateMobile('  ', { optional: true }).ok).toBe(true);
  });
});

describe('validateOtp (6 digits)', () => {
  it('accepts 6 digits, spaces ignored', () => {
    expect(validateOtp('123456')).toEqual({ ok: true, message: '', value: '123456' });
    expect(validateOtp('123 456').value).toBe('123456');
  });
  it.each(['', '12345', '1234567', 'abcdef', '12345a'])('rejects %j', (input) => {
    expect(validateOtp(input).ok).toBe(false);
  });
});

describe('validatePan ^[A-Z]{5}[0-9]{4}[A-Z]$', () => {
  it('accepts the designed example and upper-cases input', () => {
    expect(validatePan('ABCPN1234K')).toEqual({ ok: true, message: '', value: 'ABCPN1234K' });
    expect(validatePan(' abcpn1234k ').value).toBe('ABCPN1234K');
  });
  it.each(['', 'ABCP1234K', 'ABCPN12345', 'ABCPN1234', '1BCPN1234K', 'ABCPN1234KK', 'ABC-N1234K'])(
    'rejects %j',
    (input) => {
      expect(validatePan(input).ok).toBe(false);
    },
  );
});

describe('validateUpi ^[\\w.\\-]{2,}@[a-zA-Z]{2,}$', () => {
  it.each(['demo.priya@upi', 'demo_priya-01@okbank', 'ab@cd'])('accepts %s', (input) => {
    expect(validateUpi(input)).toEqual({ ok: true, message: '', value: input });
  });
  it.each(['', 'a@upi', 'demo.priya', 'demo.priya@u', 'demo priya@upi', 'demo@up1', '@upi'])('rejects %j', (input) => {
    expect(validateUpi(input).ok).toBe(false);
  });
});

describe('validateGstin (15 characters, standard layout)', () => {
  it('accepts a well-formed GSTIN and upper-cases it', () => {
    expect(validateGstin('27ABCDE1234F1Z5')).toEqual({ ok: true, message: '', value: '27ABCDE1234F1Z5' });
    expect(validateGstin('29abcde1234f2zk').value).toBe('29ABCDE1234F2ZK');
  });
  it('is optional by default ("only if registered")', () => {
    expect(validateGstin('')).toEqual({ ok: true, message: '', value: '' });
    expect(validateGstin('', { optional: false }).ok).toBe(false);
  });
  it('rejects the wrong length with a length message', () => {
    const r = validateGstin('27ABCDE1234F1Z');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/15 characters/);
  });
  it.each(['2AABCDE1234F1Z5', '27ABCD01234F1Z5', '27ABCDE1234F0Z5', '27ABCDE1234F1X5', '27ABCDE1234F1Z-'])(
    'rejects %j',
    (input) => {
      expect(validateGstin(input).ok).toBe(false);
    },
  );
});

describe('validateSubId (a–z 0–9 hyphen, max 32)', () => {
  it.each(['reel-oct-01', 'short-diwali-02', 'a', 'x'.repeat(32)])('accepts %s', (input) => {
    expect(validateSubId(input).ok).toBe(true);
  });
  it('is optional by default', () => {
    expect(validateSubId('').ok).toBe(true);
    expect(validateSubId('', { optional: false }).ok).toBe(false);
  });
  it.each(['Reel-Oct-01', 'reel_oct', 'reel oct', 'reel.oct', 'x'.repeat(33), 'réel'])('rejects %j', (input) => {
    expect(validateSubId(input).ok).toBe(false);
  });
});
