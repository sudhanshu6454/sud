// TRUST_PROXY on the API: `req.ip` follows X-Forwarded-For only for a
// trusted peer; unset keeps the old behaviour. The request log carries
// neither address. No database is touched: a probe route is added to the
// built app before ready() and exercised with inject().

process.env.DATABASE_URL ??= 'postgres://trust-proxy-test/dummy';
process.env.JWT_SECRET ??= 'trust-proxy-test-secret';

import { afterEach, describe, expect, it } from 'vitest';

const saved = process.env.TRUST_PROXY;
afterEach(() => {
  if (saved === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = saved;
});

async function ipSeen(
  env: string | undefined,
  remoteAddress: string,
  xff?: string,
  lines: string[] = [],
): Promise<string> {
  if (env === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = env;
  // Dynamic import: db.ts reads DATABASE_URL at import time (set above).
  const { buildApp } = await import('../src/index.js');
  const app = await buildApp({ logStream: { write: (l) => void lines.push(l) } });
  app.get('/__ip', async (req) => ({ ip: req.ip }));
  await app.ready();
  const res = await app.inject({
    method: 'GET',
    url: '/__ip',
    remoteAddress,
    headers: xff ? { 'x-forwarded-for': xff } : {},
  });
  await app.close();
  return String(res.json().ip);
}

describe('api TRUST_PROXY', () => {
  it('unset: X-Forwarded-For is ignored, req.ip is the peer', async () => {
    expect(await ipSeen(undefined, '172.18.0.4', '203.0.113.7')).toBe('172.18.0.4');
  });

  it('loopback,uniquelocal: a trusted peer (the web proxy / the edge) passes on the client', async () => {
    expect(await ipSeen('loopback,uniquelocal', '172.18.0.4', '203.0.113.7')).toBe('203.0.113.7');
  });

  it('loopback,uniquelocal: an untrusted peer cannot choose its address', async () => {
    expect(await ipSeen('loopback,uniquelocal', '198.51.100.40', '203.0.113.7')).toBe('198.51.100.40');
  });

  it('a hop count trusts that many proxies', async () => {
    expect(await ipSeen('1', '198.51.100.40', '192.0.2.1, 203.0.113.7')).toBe('203.0.113.7');
  });

  it('the request log carries neither the peer nor the forwarded client', async () => {
    const lines: string[] = [];
    expect(await ipSeen('loopback,uniquelocal', '172.18.0.4', '203.0.113.7', lines)).toBe('203.0.113.7');
    const log = lines.join('');
    expect(log).toContain('"url":"/__ip"');
    expect(log).not.toContain('203.0.113.7');
    expect(log).not.toContain('172.18.0.4');
    expect(log).not.toContain('remoteAddress');
  });

  it('an invalid value fails at boot', async () => {
    process.env.TRUST_PROXY = 'edge';
    const { buildApp } = await import('../src/index.js');
    await expect(buildApp()).rejects.toThrow(/TRUST_PROXY: 'edge'/);
  });
});
