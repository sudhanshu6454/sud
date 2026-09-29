import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from './trust-proxy.js';

describe('parseTrustProxy (TRUST_PROXY → Fastify trustProxy)', () => {
  it('unset, empty or "false" trusts nothing (the previous behaviour)', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy(null)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('   ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('FALSE')).toBe(false);
    expect(parseTrustProxy(' , ')).toBe(false);
  });

  it('"true" trusts every hop; an integer is a hop count', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('True')).toBe(true);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('0')).toBe(0);
  });

  it('a comma list of names, addresses and CIDR ranges becomes a trimmed list', () => {
    expect(parseTrustProxy('loopback,uniquelocal')).toEqual(['loopback', 'uniquelocal']);
    expect(parseTrustProxy(' Loopback , 10.0.0.0/8 ,172.16.0.0/12,, fd00::/8 ')).toEqual([
      'loopback',
      '10.0.0.0/8',
      '172.16.0.0/12',
      'fd00::/8',
    ]);
    expect(parseTrustProxy('127.0.0.1,::1,10.0.0.0/255.0.0.0,linklocal')).toEqual([
      '127.0.0.1',
      '::1',
      '10.0.0.0/255.0.0.0',
      'linklocal',
    ]);
  });

  it('refuses entries that are not addresses, ranges or known names (fails at boot)', () => {
    expect(() => parseTrustProxy('yes')).toThrow(/TRUST_PROXY: 'yes'/);
    expect(() => parseTrustProxy('loopback,caddy')).toThrow(/'caddy'/);
    expect(() => parseTrustProxy('10.0.0.0/8/9')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('10.0.0.0/x')).toThrow(/TRUST_PROXY/);
    expect(() => parseTrustProxy('-1')).toThrow(/TRUST_PROXY/);
  });
});
