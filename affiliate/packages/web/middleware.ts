import { NextResponse, type NextRequest } from 'next/server';
import { apiBase, publicOrgSlug } from './lib/server-env';
import { withdrawalProbePath } from './lib/spotted';

/**
 * A withdrawn page answers HTTP 410 (Gone) everywhere at once: a look under
 * a takedown (/looks/<id> and its item pages) and the hub of a celebrity
 * under a takedown (/c/<slug>). Before such a page renders, this asks the
 * public read API about it (HEAD on /v1/public/<org>/looks/<id> or
 * /celebrities/<slug>, 2 s at most) and answers it itself with status 410,
 * noindex and no-store, the body being the web's own /withdrawn page: the
 * shop's layout (bar, tabs, footer, Archivo, the design system's CSS) with
 * only the withdrawn notice under its h1 — what every old Facebook or
 * Instagram link shows after a takedown. (A rewrite to /withdrawn cannot
 * carry the 410: Next answers a rewritten page with the page's own 200, on
 * `next start` and on the standalone server alike; checked 2026-09-30.)
 * The page is rendered once a minute per process from the web's own origin
 * (WEB_INTERNAL_ORIGIN, default http://127.0.0.1:$PORT) with its scripts
 * taken out, so the browser shows static markup under the withdrawn URL
 * (no hydration that could move the address bar); if that render fails, a
 * plain notice with the same words is the body. Answers are kept
 * per page in this process: "not withdrawn" for 5 s, "withdrawn" for 30 s
 * (so a busy look costs the API one check per 5 s, and a takedown reaches
 * the status code within 5 s; a restore puts the look back to draft, so
 * the longer window for "withdrawn" hides nothing that should show). The
 * page itself re-checks through its own fetch (revalidated at once by the
 * takedown's call to /internal/revalidate), so a stale "not withdrawn" here
 * still renders only the withdrawn notice. A page that was never public
 * answers 404 at the API, so it is never rewritten here.
 *
 * If the API cannot be reached, the request goes on to the page, which then
 * shows the shop's error state or the withdrawn notice — never the look.
 */
export const config = { matcher: ['/looks/:path*', '/c/:path*'] };

const PAGE_TTL_MS = 60_000;
const NOT_GONE_TTL_MS = 5_000;
const GONE_TTL_MS = 30_000;
const MAX_ENTRIES = 5_000;
const seen = new Map<string, { gone: boolean; at: number }>();

async function withdrawn(probe: string): Promise<boolean | null> {
  const now = Date.now();
  const hit = seen.get(probe);
  if (hit && now - hit.at < (hit.gone ? GONE_TTL_MS : NOT_GONE_TTL_MS)) return hit.gone;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(`${apiBase()}/v1/public/${publicOrgSlug()}${probe}`, { method: 'HEAD', cache: 'no-store', signal: ctrl.signal });
    const gone = res.status === 410;
    if (seen.size >= MAX_ENTRIES) seen.clear();
    seen.set(probe, { gone, at: now });
    return gone;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The same words as components/shop/WithdrawnNotice (CELEBRITY_WEB), for when the page cannot be rendered. */
const FALLBACK_HTML =
  '<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="robots" content="noindex, nofollow"><title>Withdrawn · Afflino</title></head>' +
  '<body style="margin:0;padding:40px 16px;background:#F3F2F2;color:#141414;font-family:Archivo,system-ui,sans-serif">' +
  '<main><p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px">410</p>' +
  '<h1 style="font-size:28px;margin:0 0 12px">This page was withdrawn.</h1>' +
  '<p style="font-size:15px;margin:0 0 16px">It is no longer available on Afflino.</p>' +
  '<p style="font-size:15px;margin:0"><a href="/shop" style="color:inherit">See every look on Spotted</a></p></main></body></html>';

let page: { html: string; at: number } | null = null;

function internalOrigin(): string {
  const o = process.env.WEB_INTERNAL_ORIGIN?.trim();
  if (o && /^https?:\/\/[^/\s]+$/.test(o)) return o;
  const port = /^\d{1,5}$/.test(process.env.PORT ?? '') ? process.env.PORT : '3000';
  return `http://127.0.0.1:${port}`;
}

/** The server-rendered /withdrawn page without its scripts (static markup and the design system's CSS). */
export function staticMarkup(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*\bas="script"[^>]*>/gi, '')
    .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/gi, '');
}

async function withdrawnHtml(): Promise<string> {
  const now = Date.now();
  if (page && now - page.at < PAGE_TTL_MS) return page.html;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2000);
  try {
    const res = await fetch(`${internalOrigin()}/withdrawn`, { cache: 'no-store', signal: ctrl.signal });
    const type = res.headers.get('content-type') ?? '';
    if (res.status === 200 && type.startsWith('text/html')) {
      const html = staticMarkup(await res.text());
      if (html.includes('<h1')) {
        page = { html, at: now };
        return html;
      }
    }
  } catch {
    // fall through to the last good page or the plain notice
  } finally {
    clearTimeout(timer);
  }
  return page?.html ?? FALLBACK_HTML;
}

/** Test seam. */
export function __resetWithdrawnPage(): void {
  page = null;
}

export async function middleware(req: NextRequest) {
  const probe = withdrawalProbePath(req.nextUrl.pathname);
  if (!probe) return NextResponse.next();
  if ((await withdrawn(probe)) !== true) return NextResponse.next();
  return new NextResponse(await withdrawnHtml(), {
    status: 410,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
