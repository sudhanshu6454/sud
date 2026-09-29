/*
 * The same-origin /api proxy (app/api/[...path]/route.ts): what crosses to
 * the API and back. Headers are forwarded except hop-by-hop ones and
 * cookies; WEB_API_TOKEN is never attached.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/[...path]/route';

function request(method: string, headers: Record<string, string>, search = '') {
  return {
    method,
    headers: new Headers(headers),
    nextUrl: { search },
    arrayBuffer: async () => new ArrayBuffer(0),
  } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('/api proxy', () => {
  it('forwards the bearer, drops cookies both ways and never adds WEB_API_TOKEN', async () => {
    vi.stubEnv('API_BASE', 'http://upstream.test');
    vi.stubEnv('WEB_API_TOKEN', 'server-secret');
    let sent: Headers | null = null;
    let url = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (target: string, init: RequestInit) => {
        url = target;
        sent = new Headers(init.headers);
        return new Response('{"data":{}}', {
          status: 200,
          headers: { 'content-type': 'application/json', 'set-cookie': 'upstream=1', 'x-request-id': 'r1' },
        });
      }),
    );
    const res = await GET(
      request('GET', { authorization: 'Bearer browser-token', cookie: 'session=abc; _ga=xyz', accept: 'application/json' }, '?page=1'),
      { params: { path: ['v1', 'looks'] } },
    );
    expect(url).toBe('http://upstream.test/v1/looks?page=1');
    expect(sent!.get('authorization')).toBe('Bearer browser-token');
    expect(sent!.get('cookie')).toBeNull();
    expect(sent!.get('accept')).toBe('application/json');
    expect([...sent!.values()].join(' ')).not.toContain('server-secret');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-request-id')).toBe('r1');
  });

  it('adds no authorization when the browser sent none', async () => {
    vi.stubEnv('API_BASE', 'http://upstream.test');
    vi.stubEnv('WEB_API_TOKEN', 'server-secret');
    let sent: Headers | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_t: string, init: RequestInit) => {
        sent = new Headers(init.headers);
        return new Response('{}', { status: 401 });
      }),
    );
    const res = await POST(request('POST', {}), { params: { path: ['v1', 'suspense', 'x', 'retry'] } });
    expect(res.status).toBe(401);
    expect(sent!.get('authorization')).toBeNull();
  });
});
