import { describe, expect, it } from 'vitest';
import { parseDecimalMinorUnits } from './money-parse.js';

const minor = (raw: string, opts = {}) => {
  const r = parseDecimalMinorUnits(raw, opts);
  if (!r.ok) throw new Error(r.reason);
  return r.minor;
};
const refused = (raw: string, opts = {}) => {
  const r = parseDecimalMinorUnits(raw, opts);
  expect(r.ok, `${raw} should be refused`).toBe(false);
  return r.ok ? '' : r.reason;
};

describe('parseDecimalMinorUnits (exact, no floats, no rounding)', () => {
  it('converts exact 2-decimal rupee strings to paise', () => {
    expect(minor('160.00')).toBe(16000);
    expect(minor('0.01')).toBe(1);
    expect(minor('0.10')).toBe(10);
    expect(minor('0.00')).toBe(0);
    expect(minor('1299')).toBe(129900);
    expect(minor(' 49.99 ')).toBe(4999);
    // 0.1 + 0.2 style float artefacts cannot occur: the digits are used as text.
    expect(minor('1234567.89')).toBe(123456789);
  });

  it('accepts Western and Indian digit grouping', () => {
    expect(minor('1,234.50')).toBe(123450);
    expect(minor('1,234,567.00')).toBe(123456700);
    expect(minor('12,34,567.00')).toBe(123456700);
    expect(minor('1,00,000')).toBe(10000000);
  });

  it('negative values only when allowed (returns)', () => {
    expect(refused('-12.00')).toMatch(/negative/);
    expect(minor('-12.00', { allowNegative: true })).toBe(-1200);
    expect(minor('-0.00', { allowNegative: true })).toBe(0);
    expect(Object.is(minor('-0.00', { allowNegative: true }), -0)).toBe(false);
  });

  it('refuses anything that would need rounding or guessing', () => {
    expect(refused('12.5')).toMatch(/exactly 2 digits/);
    expect(refused('12.505')).toMatch(/exactly 2 digits/);
    expect(refused('1e3')).toMatch(/not a plain decimal/);
    expect(refused('₹12.00')).toMatch(/not a plain decimal/);
    expect(refused('Rs. 12.00')).toMatch(/not a plain decimal|more than one/);
    expect(refused('12,00.00')).toMatch(/not a plain decimal/);
    expect(refused('1,2345.00')).toMatch(/not a plain decimal/);
    expect(refused('012.00')).toMatch(/not a plain decimal/);
    expect(refused('.50')).toMatch(/not a plain decimal/);
    expect(refused('12.')).toMatch(/exactly 2 digits/);
    expect(refused('1.2.3')).toMatch(/more than one/);
    expect(refused('+12.00')).toMatch(/not a plain decimal/);
    expect(refused('(12.00)')).toMatch(/not a plain decimal/);
    expect(refused('1 234.00')).toMatch(/not a plain decimal/);
    expect(refused('')).toMatch(/empty/);
    expect(refused('90071992547409.92')).toMatch(/largest/);
  });

  it('whole-unit currencies refuse a fraction', () => {
    expect(minor('15', { fractionDigits: 0 })).toBe(15);
    expect(refused('15.00', { fractionDigits: 0 })).toMatch(/whole units/);
  });
});
