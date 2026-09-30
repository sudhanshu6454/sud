/**
 * After a commit that hides or shows content (a takedown or its restore, a
 * rights review, unpublishing, a removed item): the redirect's cached routes
 * of the links it paused or reactivated are deleted (now and 2 s later,
 * routes/programmes.ts deleteRouteKeys), and the web's page caches for the
 * affected tags are revalidated.
 *
 * The web call is best-effort and bounded: POST {WEB_REVALIDATE_URL} with
 * {"tags": [...]} and the header `x-revalidate-secret: WEB_REVALIDATE_SECRET`
 * (the web side is packages/web's /internal/revalidate; the edge answers 404
 * for /internal/* from outside), in batches of REVALIDATE_BATCH tags; ok only
 * when every batch answered 2xx. Unset → skipped. The api's own cache of
 * public answers is dropped first, in every process (the Redis epoch,
 * src/public-guard.ts), and the answers carry `cache-control: public,
 * max-age=30` (PUBLIC_CACHE_SECONDS), which bounds any downstream cache.
 */
import { deleteRouteKeys } from '../routes/programmes.js';
import { bumpEpoch } from '../public-guard.js';

export interface InvalidationResult {
  routes: { tokens: number; deleted: number; redis_available: boolean };
  web: { attempted: boolean; ok: boolean | null; status: number | null; batches?: number };
  /** The api's own public answers (src/public-guard.ts): dropped in every process through the Redis epoch. */
  public_cache?: { cleared: boolean };
}

/** Tags per revalidation call: the web's /internal/revalidate refuses more than 2000 (a celebrity with thousands of looks is sent in batches). */
export const REVALIDATE_BATCH = 1000;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean }>;

let fetchOverride: FetchLike | null = null;
const calls: Array<{ url: string; tags: string[] }> = [];

/** Test seam: replace the web revalidation fetch (null = the global fetch). */
export function __setRevalidateFetch(f: FetchLike | null): void {
  fetchOverride = f;
}

/** Test seam: the tags every revalidation call carried, in order. */
export function __revalidateCalls(): Array<{ url: string; tags: string[] }> {
  return calls;
}

export async function revalidateWeb(tags: string[], log?: { warn: (obj: unknown, msg?: string) => void }): Promise<InvalidationResult['web']> {
  const url = process.env.WEB_REVALIDATE_URL?.trim();
  const secret = process.env.WEB_REVALIDATE_SECRET?.trim();
  const unique = [...new Set(tags)].sort();
  if (!url || !secret || unique.length === 0) return { attempted: false, ok: null, status: null };
  const f: FetchLike = fetchOverride ?? ((u, init) => fetch(u, init));
  let allOk = true;
  let lastStatus: number | null = null;
  let batches = 0;
  for (let i = 0; i < unique.length; i += REVALIDATE_BATCH) {
    const batch = unique.slice(i, i + REVALIDATE_BATCH);
    batches += 1;
    calls.push({ url, tags: batch });
    try {
      const res = await f(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ tags: batch }),
        signal: AbortSignal.timeout(3000),
      });
      lastStatus = res.status;
      if (!res.ok) {
        allOk = false;
        log?.warn({ status: res.status, batch: batches }, 'web revalidation answered non-2xx; pages expire within their cache time');
      }
    } catch (err) {
      allOk = false;
      lastStatus = null;
      log?.warn({ err: err instanceof Error ? err.message : String(err), batch: batches }, 'web revalidation failed; pages expire within their cache time');
    }
  }
  return { attempted: true, ok: allOk, status: lastStatus, batches };
}

export async function invalidateAfterCommit(
  opts: { tokens: string[]; tags: string[] },
  log?: { warn: (obj: unknown, msg?: string) => void },
): Promise<InvalidationResult> {
  const routes = await deleteRouteKeys(opts.tokens, log as Parameters<typeof deleteRouteKeys>[1]);
  const cleared = await bumpEpoch();
  const web = await revalidateWeb(opts.tags, log);
  return { routes: { tokens: routes.tokens, deleted: routes.deleted, redis_available: routes.redisAvailable }, web, public_cache: { cleared } };
}

/** The cache tags of one look's pages. */
export function lookTags(look: { id: string; celebrity_slug?: string | null; storefront_slug?: string | null }): string[] {
  const tags = [`look:${look.id}`, 'spotted', 'sitemap'];
  if (look.celebrity_slug) tags.push(`celebrity:${look.celebrity_slug}`);
  if (look.storefront_slug) tags.push(`storefront:${look.storefront_slug}`);
  return tags;
}
