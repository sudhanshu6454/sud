import type { NextRequest } from 'next/server';
import { apiBase } from '../../../lib/server-env';

/**
 * Same-origin proxy: /api/<path> → `${API_BASE}/<path>` (query string kept).
 *
 * Why a route handler and not `rewrites()` in next.config: Next 14 freezes
 * rewrite destinations into the routes manifest at `next build`, but the
 * deployment passes API_BASE at container start (docker-compose sets
 * API_BASE=http://api:3000 as a runtime env). This handler reads
 * API_BASE on every request, so the same image works wherever the API lives.
 *
 * Trust: the browser's own Authorization header is forwarded untouched;
 * the server's WEB_API_TOKEN is NEVER attached here. Hop-by-hop headers are
 * dropped both ways; the body is buffered (the API caps uploads at 2 MB).
 * Cookies do not cross: the API authenticates by bearer only and sets none,
 * so the web origin's cookies are not sent upstream and an upstream
 * set-cookie never reaches the browser.
 */
export const dynamic = 'force-dynamic';

const DROP_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'accept-encoding',
  'cookie',
]);

const DROP_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
  'set-cookie',
]);

/** Upstream budget: a hung API must not hold the shop's request open forever. */
const UPSTREAM_TIMEOUT_MS = 30_000;

async function proxy(req: NextRequest, ctx: { params: { path: string[] } }): Promise<Response> {
  // '.' and '..' survive encodeURIComponent and would be collapsed by URL parsing,
  // so /api/v1/../x could climb out of a path-prefixed API_BASE: refuse them.
  if (ctx.params.path.some((seg) => seg === '.' || seg === '..')) {
    return Response.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid path segment' }, request_id: null },
      { status: 400 },
    );
  }
  const path = ctx.params.path.map(encodeURIComponent).join('/');
  const target = `${apiBase()}/${path}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!DROP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await req.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    return Response.json(
      {
        error: {
          code: 'UPSTREAM_UNAVAILABLE',
          message: `API unreachable via proxy: ${err instanceof Error ? err.message : 'network error'}`,
        },
        request_id: null,
      },
      { status: 502 },
    );
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase())) out.set(key, value);
  });
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as HEAD, proxy as OPTIONS };
