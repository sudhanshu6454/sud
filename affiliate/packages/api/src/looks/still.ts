/**
 * The still's own address (GET /v1/public/:org/looks/:id/still, behind the
 * web's /img/looks/<id>): the bytes of the origin file, fetched by the api
 * on each request that passed every rule (routes/public.ts). The origin
 * URL (assets.public_url, set by the library import or an editor) never
 * reaches the public; with the origin bucket private (owner item), a
 * takedown or a licence that ends withdraws the image itself, not only the
 * page (docs/runbooks/deploy.md §1C).
 *
 * Bounded: https only (http and loopback / private addresses only outside
 * production, for local TEST stills), no redirects followed, 8 s, 12 MB,
 * an image content type only (jpeg, png, webp, avif, gif).
 */
const MAX_BYTES = 12 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const TYPES = /^image\/(jpeg|png|webp|avif|gif)$/;

type FetchLike = (url: string, init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
let fetchOverride: FetchLike | null = null;

/** Test seam: replace the origin fetch (null = the global fetch). */
export function __setStillFetch(f: FetchLike | null): void {
  fetchOverride = f;
}

function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe80:/.test(h)) return true;
  return false;
}

/** Whether the api may fetch this origin URL. */
export function stillOriginAllowed(raw: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  const production = env.NODE_ENV === 'production';
  if (u.protocol !== 'https:' && (production || u.protocol !== 'http:')) return false;
  if (production && privateHost(u.hostname)) return false;
  return true;
}

export async function fetchStill(url: string): Promise<{ ok: true; contentType: string; bytes: Buffer } | { ok: false; reason: string }> {
  if (!stillOriginAllowed(url)) return { ok: false, reason: 'origin_not_allowed' };
  const f: FetchLike = fetchOverride ?? ((u, init) => fetch(u, init));
  try {
    const res = await f(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'image/*' } });
    if (res.status !== 200) return { ok: false, reason: `origin_status_${res.status}` };
    const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (!TYPES.test(type)) return { ok: false, reason: 'not_an_image' };
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) return { ok: false, reason: 'too_large' };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return { ok: false, reason: 'too_large' };
    return { ok: true, contentType: type, bytes };
  } catch {
    return { ok: false, reason: 'origin_unreachable' };
  }
}
