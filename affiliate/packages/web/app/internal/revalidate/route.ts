import { createHmac, timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { isCacheTag } from '../../../lib/spotted';

// Per request, never cached.
export const dynamic = 'force-dynamic';

/** At most this many tags per call (a celebrity takedown names each of their looks). */
const MAX_TAGS = 2000;

function sameSecret(a: string, b: string): boolean {
  const x = createHmac('sha256', 'afflino-revalidate').update(a).digest();
  const y = createHmac('sha256', 'afflino-revalidate').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

function answer(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' },
  });
}

/**
 * POST /internal/revalidate {"tags": ["look:<uuid>", "celebrity:<slug>",
 * "storefront:<slug>", "spotted", "sitemap"]} with the header
 * `x-revalidate-secret: WEB_REVALIDATE_SECRET` — the API calls it after a
 * takedown, its restore, a rights review, an unpublish or a removed product
 * (packages/api/src/looks/invalidate.ts), so the cached public answers for
 * those pages are dropped at once instead of within their 30 s.
 *
 * Reached over the compose network only (WEB_REVALIDATE_URL
 * http://web:3000/internal/revalidate): the edge answers 404 for
 * /internal/* from outside (docker/Caddyfile). No secret configured → 503;
 * a wrong or missing secret → 401 (compared in constant time); a malformed
 * body or an unknown tag → 400, nothing revalidated.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = process.env.WEB_REVALIDATE_SECRET?.trim();
  if (!secret || secret.length < 16) return answer(503, { error: 'revalidation is not configured' });
  const given = req.headers.get('x-revalidate-secret') ?? '';
  if (!sameSecret(given, secret)) return answer(401, { error: 'unauthorized' });
  const body = (await req.json().catch(() => null)) as { tags?: unknown } | null;
  const tags = body && Array.isArray(body.tags) ? body.tags : null;
  if (!tags || tags.length === 0 || tags.length > MAX_TAGS || !tags.every(isCacheTag)) {
    return answer(400, { error: 'tags must be 1-2000 known cache tags' });
  }
  const unique = [...new Set(tags as string[])];
  for (const tag of unique) revalidateTag(tag);
  return answer(200, { ok: true, revalidated: unique.length });
}

export function GET(): Response {
  return answer(405, { error: 'POST only' });
}
