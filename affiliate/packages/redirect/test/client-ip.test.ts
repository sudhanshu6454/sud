// Which address the redirect hashes into clicks.context.ip_hash, with and
// without TRUST_PROXY; how it is hashed, with and without IP_HASH_KEY; and
// that the request log never carries it.
//
// A fake pool stands in for Postgres: the route query returns one active,
// allow-listed route and the clicks insert is captured. REDIS_URL is unset, so
// there is no cache and no queue (the click is still persisted and the 302
// carries subid).

import { afterEach, describe, expect, it } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { buildRedirectApp, hashClientAddress, parseIpHashKey, requestLogFields } from '../src/index.js';

const TOKEN = '0123456789abcdef0123456789abcdef';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (key: string, s: string) => createHmac('sha256', key).update(s).digest('hex');
// TEST key (64 hex characters, the shape of `openssl rand -hex 32`).
const KEY = 'a1'.repeat(32);

interface Captured {
  inserts: { context: { ua?: string; ip_hash: string } }[];
}

function fakePool(captured: Captured): Pool {
  return {
    query: async (text: string, params: unknown[] = []) => {
      if (/from links l/.test(text)) {
        return {
          rows: [
            {
              link_id: 'link-1',
              org_id: 'org-1',
              destination_url: 'https://shop.example.com/p/demo-sku',
              allowed_hosts: ['shop.example.com'],
              programme_status: 'active',
              offer_status: 'active',
              fresh_until: null,
            },
          ],
        };
      }
      if (/insert into clicks/.test(text)) {
        captured.inserts.push({ context: JSON.parse(String(params[4])) });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  } as unknown as Pool;
}

const SAVED = {
  TRUST_PROXY: process.env.TRUST_PROXY,
  REDIS_URL: process.env.REDIS_URL,
  IP_HASH_KEY: process.env.IP_HASH_KEY,
};
afterEach(() => {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function click(opts: { env?: string; key?: string; remoteAddress: string; xff?: string }) {
  delete process.env.REDIS_URL;
  if (opts.env === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = opts.env;
  if (opts.key === undefined) delete process.env.IP_HASH_KEY;
  else process.env.IP_HASH_KEY = opts.key;
  const captured: Captured = { inserts: [] };
  const lines: string[] = [];
  const app = await buildRedirectApp({ pool: fakePool(captured), logStream: { write: (l) => void lines.push(l) } });
  await app.ready();
  const res = await app.inject({
    method: 'GET',
    url: `/r/${TOKEN}`,
    remoteAddress: opts.remoteAddress,
    headers: opts.xff ? { 'x-forwarded-for': opts.xff } : {},
  });
  await app.close();
  expect(res.statusCode).toBe(302);
  expect(String(res.headers.location)).toMatch(/[?&]subid=/);
  expect(res.headers['set-cookie']).toBeUndefined();
  expect(captured.inserts).toHaveLength(1);
  return { ipHash: captured.inserts[0]!.context.ip_hash, log: lines.join('') };
}

describe('redirect client address (TRUST_PROXY)', () => {
  it('with trust, a request from a trusted remote hashes the X-Forwarded-For client', async () => {
    const r = await click({ env: 'loopback,uniquelocal', remoteAddress: '172.18.0.5', xff: '203.0.113.7' });
    expect(r.ipHash).toBe(sha256('203.0.113.7'));

    const loop = await click({ env: 'loopback,uniquelocal', remoteAddress: '127.0.0.1', xff: '198.51.100.23' });
    expect(loop.ipHash).toBe(sha256('198.51.100.23'));
  });

  it('with trust, only the nearest untrusted hop counts (a spoofed left-most entry is ignored)', async () => {
    // A client that sends its own X-Forwarded-For through a proxy that appends
    // (Caddy overwrites instead; this is the belt-and-braces case).
    const r = await click({
      env: 'loopback,uniquelocal',
      remoteAddress: '10.1.2.3',
      xff: '192.0.2.99, 203.0.113.7',
    });
    expect(r.ipHash).toBe(sha256('203.0.113.7'));
  });

  it('without trust (TRUST_PROXY unset), X-Forwarded-For is ignored: the remote address is hashed', async () => {
    const r = await click({ remoteAddress: '172.18.0.5', xff: '203.0.113.7' });
    expect(r.ipHash).toBe(sha256('172.18.0.5'));

    const empty = await click({ env: '', remoteAddress: '172.18.0.5', xff: '203.0.113.7' });
    expect(empty.ipHash).toBe(sha256('172.18.0.5'));
  });

  it('with trust, a request from an untrusted remote hashes the remote address, not its X-Forwarded-For', async () => {
    const r = await click({ env: 'loopback,uniquelocal', remoteAddress: '198.51.100.40', xff: '203.0.113.7' });
    expect(r.ipHash).toBe(sha256('198.51.100.40'));
  });

  it('the request log carries neither the remote address nor the forwarded client', async () => {
    const r = await click({ env: 'loopback,uniquelocal', remoteAddress: '172.18.0.5', xff: '203.0.113.7' });
    expect(r.log).toContain('"url":"/r/');
    expect(r.log).not.toContain('203.0.113.7');
    expect(r.log).not.toContain('172.18.0.5');
    expect(r.log).not.toContain('remoteAddress');
    expect(requestLogFields({ method: 'GET', url: '/r/x', hostname: 'afflino.com' })).toEqual({
      method: 'GET',
      url: '/r/x',
      hostname: 'afflino.com',
    });
  });

  it('an invalid TRUST_PROXY fails the build (boot) instead of silently trusting nothing', async () => {
    process.env.TRUST_PROXY = 'caddy';
    await expect(buildRedirectApp({ pool: fakePool({ inserts: [] }) })).rejects.toThrow(/TRUST_PROXY: 'caddy'/);
  });
});

describe('redirect ip_hash key (IP_HASH_KEY)', () => {
  it('unset or empty keeps the plain SHA-256 (existing rows and tests stay valid)', async () => {
    expect((await click({ remoteAddress: '198.51.100.40' })).ipHash).toBe(sha256('198.51.100.40'));
    expect((await click({ key: '', remoteAddress: '198.51.100.40' })).ipHash).toBe(sha256('198.51.100.40'));
    expect((await click({ key: '   ', remoteAddress: '198.51.100.40' })).ipHash).toBe(sha256('198.51.100.40'));
    expect(parseIpHashKey(undefined)).toBeNull();
    expect(hashClientAddress('198.51.100.40', null)).toBe(sha256('198.51.100.40'));
  });

  it('set: ip_hash = HMAC-SHA256(key, address), not the enumerable plain hash', async () => {
    const r = await click({ key: KEY, remoteAddress: '198.51.100.40' });
    expect(r.ipHash).toBe(hmac(KEY, '198.51.100.40'));
    expect(r.ipHash).not.toBe(sha256('198.51.100.40'));
    expect(r.ipHash).toMatch(/^[0-9a-f]{64}$/);
    // Stable under one key (per-address checks keep working), different under another.
    expect((await click({ key: KEY, remoteAddress: '198.51.100.40' })).ipHash).toBe(r.ipHash);
    expect((await click({ key: 'b2'.repeat(32), remoteAddress: '198.51.100.40' })).ipHash).not.toBe(r.ipHash);
    // Surrounding whitespace in the env value is not part of the key.
    expect((await click({ key: ` ${KEY}\n`, remoteAddress: '198.51.100.40' })).ipHash).toBe(r.ipHash);
  });

  it('with trust and a key, the forwarded client is what gets keyed', async () => {
    const r = await click({ env: 'loopback,uniquelocal', key: KEY, remoteAddress: '172.18.0.5', xff: '203.0.113.7' });
    expect(r.ipHash).toBe(hmac(KEY, '203.0.113.7'));
    expect(r.log).not.toContain('203.0.113.7');
    expect(r.log).not.toContain(KEY);
  });

  it('a key shorter than 32 characters fails the boot without echoing it', async () => {
    process.env.IP_HASH_KEY = 'short-secret-value';
    const err = await buildRedirectApp({ pool: fakePool({ inserts: [] }) }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err?.message).toMatch(/IP_HASH_KEY: must be at least 32 characters/);
    expect(err?.message).not.toContain('short-secret-value');
    expect(() => parseIpHashKey('x'.repeat(31))).toThrow(/IP_HASH_KEY/);
    expect(parseIpHashKey('x'.repeat(32))).toBe('x'.repeat(32));
  });
});
