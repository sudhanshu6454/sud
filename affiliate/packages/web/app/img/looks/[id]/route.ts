import { apiBase, publicOrgSlug } from '../../../../lib/server-env';

/**
 * A look's still at its own afflino.com address (/img/looks/<id>?v=…): the
 * page's <img> points here, never at the origin file. Every request asks the
 * public API again (GET /v1/public/<org>/looks/<id>/still, which re-applies
 * every rule: the celebrity's rights, the licence, the chain of title, the
 * frame screen), so a takedown or a licence that ends withdraws the image
 * itself: 410 after a takedown of a look that was public, 404 otherwise.
 * `max-age=30`, like every public answer; nothing is kept here.
 */
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = /^image\/(jpeg|png|webp|avif|gif)$/;

function refusal(status: number): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

export async function GET(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const id = ctx.params.id;
  if (!UUID.test(id)) return refusal(404);
  const v = new URL(req.url).searchParams.get('v');
  const q = v && /^[0-9a-f]{1,16}$/.test(v) ? `?v=${v}` : '';
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase()}/v1/public/${publicOrgSlug()}/looks/${id.toLowerCase()}/still${q}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return refusal(502);
  }
  if (upstream.status === 410 || upstream.status === 404) return refusal(upstream.status);
  const type = (upstream.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (upstream.status !== 200 || !TYPES.test(type)) return refusal(502);
  return new Response(upstream.body, {
    status: 200,
    headers: { 'content-type': type, 'cache-control': 'public, max-age=30', 'x-content-type-options': 'nosniff' },
  });
}
