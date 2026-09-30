/**
 * The web's side of takedowns and indexing for celebrity pages: the
 * revalidation endpoint the API calls after a takedown (secret, tags), the
 * middleware's 410 for a withdrawn look or hub, the metadata and sitemap
 * rules (CELEBRITY_INDEXING only ever narrows SITE_INDEXING), the operator
 * screens' pure rules, and source checks (no client component reads the
 * server-only clients; no borrowed product names; messages and shares carry
 * afflino.com pages only). TEST data only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MATRIX,
  LIBRARY_COLUMNS,
  LIBRARY_EXAMPLE,
  allowsText,
  clicksCsv,
  daysOf,
  hotspotFrom,
  istLocalToIso,
  lastDays,
  linkablePages,
  looksLikeProductInput,
  nextStatuses,
  parseKeywords,
  publicReplyProblem,
  reviewBody,
  reviewProblems,
  slaLabel,
  sortedItems,
  tagProblems,
  type EditorialItem,
  type PropertyRow,
} from '../lib/celebrity-admin';
import { celebrityPageMetadata, celebritySitemapFor, shopMetadata } from '../lib/seo';

const WEB = join(__dirname, '..');
const LOOK_ID = '0b3f2a8e-5c1d-4e7a-9f60-2d4b8c1e7a90';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

describe('/internal/revalidate (the API calls it after a takedown)', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  async function call(body: unknown, secret?: string) {
    const { POST } = await import('../app/internal/revalidate/route');
    const cache = await import('next/cache');
    const res = await POST(
      new Request('http://web:3000/internal/revalidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(secret !== undefined ? { 'x-revalidate-secret': secret } : {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
    return { status: res.status, body: await res.json(), calls: (cache.revalidateTag as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c[0]) };
  }

  it('is off (503) without a configured secret', async () => {
    vi.stubEnv('WEB_REVALIDATE_SECRET', '');
    expect((await call({ tags: ['spotted'] }, 'x')).status).toBe(503);
  });

  it('refuses a missing or wrong secret (401) and unknown tags (400), revalidating nothing', async () => {
    vi.stubEnv('WEB_REVALIDATE_SECRET', 'test-revalidate-secret-0123456789');
    const none = await call({ tags: ['spotted'] });
    expect(none.status).toBe(401);
    expect((await call({ tags: ['spotted'] }, 'test-revalidate-secret-012345678')).status).toBe(401);
    const bad = await call({ tags: ['spotted', 'rm -rf'] }, 'test-revalidate-secret-0123456789');
    expect(bad.status).toBe(400);
    expect((await call('not json', 'test-revalidate-secret-0123456789')).status).toBe(400);
    expect((await call({ tags: [] }, 'test-revalidate-secret-0123456789')).status).toBe(400);
    expect(bad.calls).toEqual([]);
  });

  it('revalidates each known tag once', async () => {
    vi.stubEnv('WEB_REVALIDATE_SECRET', 'test-revalidate-secret-0123456789');
    const tags = [`look:${LOOK_ID}`, 'celebrity:demo-star-one', 'storefront:demo-ig', 'spotted', 'sitemap', 'spotted'];
    const ok = await call({ tags }, 'test-revalidate-secret-0123456789');
    expect(ok).toMatchObject({ status: 200, body: { ok: true, revalidated: 5 } });
    expect(ok.calls).toEqual([`look:${LOOK_ID}`, 'celebrity:demo-star-one', 'storefront:demo-ig', 'spotted', 'sitemap']);
  });
});

describe('the middleware: a withdrawn page answers 410', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const PAGE = '<!DOCTYPE html><html><head><link rel="stylesheet" href="/_next/static/css/a.css"><link rel="preload" as="script" href="/_next/static/chunks/x.js"><script src="/_next/static/chunks/x.js" async></script></head><body><main><h1>This page was withdrawn.</h1></main><script>self.__next_f.push([1,"payload"])</script></body></html>';

  async function run(path: string, status: number | 'down', pageStatus: number | 'down' = 200) {
    vi.stubEnv('API_BASE', 'http://api.test');
    vi.stubEnv('PORT', '3000');
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === 'http://127.0.0.1:3000/withdrawn') {
        if (pageStatus === 'down') throw new Error('unreachable');
        return new Response(PAGE, { status: pageStatus, headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      if (status === 'down') throw new Error('unreachable');
      return new Response(null, { status });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { middleware } = await import('../middleware');
    const { NextRequest } = await import('next/server');
    const res = await middleware(new NextRequest(`https://afflino.com${path}`));
    return { res, fetchMock };
  }

  it('asks the public API (HEAD) and answers 410 with noindex and no-store for a withdrawn look', async () => {
    const { res, fetchMock } = await run(`/looks/${LOOK_ID}`, 410);
    expect(res.status).toBe(410);
    expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(res.headers.get('cache-control')).toBe('no-store');
    // The answer itself, not a rewrite (Next answers a rewritten page with the page's own 200):
    // the shop's /withdrawn page, rendered by the web itself, without its scripts.
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('<h1>This page was withdrawn.</h1>');
    expect(body).toContain('/_next/static/css/a.css');
    expect(body).not.toMatch(/<script|as="script"|__next_f/);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://api.test/v1/public/afflino/looks/${LOOK_ID}`);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe('HEAD');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:3000/withdrawn');
  });

  it('still answers 410 with the plain notice when the page cannot be rendered', async () => {
    const { res } = await run(`/looks/${LOOK_ID}`, 410, 'down');
    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain('This page was withdrawn.');
    expect(body).not.toMatch(/<script/);
  });

  it('covers the item pages of a withdrawn look and the hub of a celebrity under takedown', async () => {
    expect((await run(`/looks/${LOOK_ID}/items/x`, 410)).res.status).toBe(410);
    const hub = await run('/c/demo-star-one', 410);
    expect(hub.res.status).toBe(410);
    expect(hub.fetchMock.mock.calls[0]?.[0]).toBe('http://api.test/v1/public/afflino/celebrities/demo-star-one');
  });

  it('lets everything else through: a public look, a miss, an unreachable API, a demo id', async () => {
    for (const [path, status] of [[`/looks/${LOOK_ID}`, 200], [`/looks/${LOOK_ID}`, 404], [`/looks/${LOOK_ID}`, 'down'], ['/looks/demo-spotted-premiere', 410]] as const) {
      const { res } = await run(path, status);
      expect(res.status, `${path} ${status}`).toBe(200);
      expect(res.headers.get('x-middleware-next')).toBe('1');
    }
  });
});

describe('metadata and the sitemap for celebrity pages', () => {
  it('is noindex unless SITE_INDEXING and CELEBRITY_INDEXING are both on, and never for demo data', () => {
    const line = 'Demo Star One is not affiliated with Afflino and has not endorsed any product on this page.';
    const closed = celebrityPageMetadata(`/looks/${LOOK_ID}`, 'Demo Star One at Demo Film Premiere', line, { demo: false, indexing: true, celebrityIndexing: false });
    expect(closed.robots).toEqual({ index: false, follow: false });
    expect(closed.alternates).toEqual({ canonical: `/looks/${LOOK_ID}` });
    expect(closed.openGraph).toMatchObject({ url: `/looks/${LOOK_ID}`, description: line, images: [{ url: '/icons/icon-512.png', width: 512, height: 512, alt: 'Afflino' }] });
    expect(closed.twitter).toMatchObject({ description: line });
    expect(celebrityPageMetadata('/c/x', 'X', line, { demo: false, indexing: false, celebrityIndexing: true }).robots).toEqual({ index: false, follow: false });
    expect(celebrityPageMetadata('/c/x', 'X', line, { demo: true, indexing: true, celebrityIndexing: true }).robots).toEqual({ index: false, follow: false });
    expect(celebrityPageMetadata('/c/x', 'X', line, { demo: false, indexing: true, celebrityIndexing: true }).robots).toBeUndefined();
  });

  it('keeps /shop noindex while its feed shows a celebrity look, unless CELEBRITY_INDEXING', () => {
    expect(shopMetadata({ celebrityContent: true, celebrityIndexing: false }).robots).toEqual({ index: false, follow: false });
    expect(shopMetadata({ celebrityContent: false, celebrityIndexing: false }).robots).toBeUndefined();
    expect(shopMetadata({ celebrityContent: true, celebrityIndexing: true }).robots).toBeUndefined();
    expect(shopMetadata({ celebrityContent: false }).alternates).toEqual({ canonical: '/shop' });
  });

  it('lists celebrity looks, hubs and storefronts only with both switches on', () => {
    const lists = { looks: [{ id: LOOK_ID, updated_at: '2026-09-29T00:00:00.000Z' }, { id: 'not-a-uuid', updated_at: null }], celebrities: ['demo-star-one', 'Bad Slug'], storefronts: ['demo-ig'] };
    expect(celebritySitemapFor('https://afflino.com', lists, true, false)).toEqual([]);
    expect(celebritySitemapFor('https://afflino.com', lists, false, true)).toEqual([]);
    expect(celebritySitemapFor('https://afflino.com', null, true, true)).toEqual([]);
    expect(celebritySitemapFor('https://afflino.com', lists, true, true)).toEqual([
      { url: `https://afflino.com/looks/${LOOK_ID}`, lastModified: '2026-09-29T00:00:00.000Z' },
      { url: 'https://afflino.com/c/demo-star-one' },
      { url: 'https://afflino.com/s/demo-ig' },
    ]);
  });

  it('the sitemap reads the public lists only with CELEBRITY_INDEXING=on (source check)', () => {
    const src = readFileSync(join(WEB, 'app/sitemap.ts'), 'utf8');
    expect(src).toContain('celebrity ? getPublicSitemap() : Promise.resolve(null)');
  });
});

describe('the operator screens: rights reviews', () => {
  const draft = { rights_status: 'cleared' as const, max_display: 'name_and_image' as const, shoppable: true, evidence_ref: 'TEST-LICENCE-1', note: 'TEST licence on file' };

  it('needs a note on every change, the evidence for editorial / cleared, and the rights reviewer beyond blocked', () => {
    expect(reviewProblems(draft, 'rights_reviewer')).toEqual([]);
    expect(reviewProblems({ ...draft, note: '' }, 'rights_reviewer')[0]).toMatch(/note/);
    expect(reviewProblems({ ...draft, evidence_ref: '' }, 'rights_reviewer').join(' ')).toMatch(/evidence/);
    expect(reviewProblems(draft, 'network_admin').join(' ')).toMatch(/rights reviewer/);
    expect(reviewProblems({ ...draft, rights_status: 'blocked', evidence_ref: '' }, 'network_admin')).toEqual([]);
    expect(reviewProblems({ ...draft, rights_status: 'editorial' }, 'rights_reviewer')).toEqual([]);
    const narrow = { ...DEFAULT_MATRIX, cleared: { display: 'name_only' as const, shoppable: false } };
    expect(reviewProblems(draft, 'rights_reviewer', narrow)).toEqual(['Cleared allows at most: Name only.', 'Cleared never allows products.']);
  });

  it('sends only what the status allows', () => {
    expect(reviewBody(draft)).toEqual({ rights_status: 'cleared', max_display: 'name_and_image', shoppable: true, note: 'TEST licence on file', evidence_ref: 'TEST-LICENCE-1' });
    expect(reviewBody({ ...draft, rights_status: 'editorial' })).toMatchObject({ max_display: 'name_only', shoppable: false });
    expect(reviewBody({ ...draft, rights_status: 'blocked' })).not.toHaveProperty('max_display');
    expect(allowsText(DEFAULT_MATRIX.cleared)).toBe('Name and image, with products');
    expect(allowsText(DEFAULT_MATRIX.unreviewed)).toBe('Nothing is published');
  });
});

describe('the operator screens: the outfit editor', () => {
  const it0 = (id: string, match: 'exact' | 'similar', position: number) => ({ id, match_type: match, position }) as EditorialItem;

  it('EXACT needs its evidence and source; SIMILAR needs nothing', () => {
    expect(tagProblems({ match_type: 'similar', evidence: '', evidence_source: '' })).toEqual([]);
    expect(tagProblems({ match_type: 'exact', evidence: 'short', evidence_source: '' })).toHaveLength(2);
    expect(tagProblems({ match_type: 'exact', evidence: 'the brand tag at 00:41', evidence_source: 'demo-batch#00:41' })).toEqual([]);
  });

  it('lists EXACT first, then SIMILAR by position; offers only the moves the API allows', () => {
    expect(sortedItems([it0('s2', 'similar', 2), it0('e', 'exact', 5), it0('s1', 'similar', 1)]).map((i) => i.id)).toEqual(['e', 's1', 's2']);
    expect(nextStatuses('draft').map((n) => n.to)).toEqual(['in_review']);
    expect(nextStatuses('ready').map((n) => n.to)).toContain('published');
    expect(nextStatuses('withdrawn')).toEqual([]);
  });

  it('places a marker in 0..1 of the still', () => {
    expect(hotspotFrom(150, 250, { left: 100, top: 200, width: 200, height: 400 })).toEqual({ x: 0.25, y: 0.125 });
    expect(hotspotFrom(900, -5, { left: 100, top: 200, width: 200, height: 400 })).toEqual({ x: 1, y: 0 });
    expect(hotspotFrom(1, 1, { left: 0, top: 0, width: 0, height: 10 })).toBeNull();
  });

  it('offers only owner-operated pages with their own tracking ID for Amazon links', () => {
    const p = (id: string, over: Partial<PropertyRow>): PropertyRow => ({ id, platform: 'instagram', account: id, url: null, status: 'approved', owner_operated: true, amazon_tracking_id: `${id}-21`, storefront: null, ...over });
    expect(linkablePages([p('a', {}), p('b', { owner_operated: false }), p('c', { amazon_tracking_id: null }), p('d', { status: 'pending' })]).map((x) => x.id)).toEqual(['a']);
    expect(looksLikeProductInput('B0DEMO0001')).toBe(true);
    expect(looksLikeProductInput('https://shop.example.com/item/1')).toBe(true);
    expect(looksLikeProductInput('not a link')).toBe(false);
  });
});

describe('the operator screens: takedowns, replies, analytics, library', () => {
  it('reads the notice time as India time and shows the SLA marks', () => {
    expect(istLocalToIso('2026-09-30T14:05')).toBe('2026-09-30T08:35:00.000Z');
    expect(istLocalToIso('')).toBeNull();
    expect(slaLabel('ok', 30)).toBe('30 min');
    expect(slaLabel('warn', 75)).toBe('1 h 15 min (over 1 h)');
    expect(slaLabel('breach', 200)).toBe('3 h 20 min (over 3 h)');
  });

  it('keywords, and a public answer that is one of the fixed texts (never free text under a post)', () => {
    expect(parseKeywords('link, Price,link,\nshop')).toEqual(['link', 'Price', 'shop']);
    expect(publicReplyProblem('')).toBeNull();
    expect(publicReplyProblem('We sent you a message with the link.')).toBeNull();
    expect(publicReplyProblem('Demo Star One wore this! She loves it.')).toMatch(/fixed answers/);
    expect(publicReplyProblem('See https://afflino.com/looks/x')).toMatch(/fixed answers/);
    // The API's own list wins when it sent one.
    expect(publicReplyProblem('An approved text', ['An approved text'])).toBeNull();
  });

  it('tag problems cover every match: the link or ASIN, the brand and the product; EXACT its evidence too', () => {
    expect(tagProblems({ match_type: 'similar', evidence: '', evidence_source: '', input: '', brand: '', model: '' })).toEqual([
      'Paste an amazon.in link or a 10-character ASIN.',
      'Brand is needed.',
      'Product is needed.',
    ]);
    expect(tagProblems({ match_type: 'similar', evidence: '', evidence_source: '', input: 'B0DEMO0001', brand: 'Demo Brand', model: 'Demo shirt' })).toEqual([]);
  });

  it('exports the click table as CSV, formula-guarded', () => {
    const csv = clicksCsv({ from: '2026-09-01', to: '2026-09-30', group_by: 'celebrity', total_clicks: 3, groups: [{ key: 'k', label: '=cmd', clicks: 3 }] }, 'Celebrity');
    expect(csv.split('\r\n')[0]).toBe('Celebrity,Key,Clicks');
    expect(csv).toContain("'=cmd");
    expect(csv).toContain('Total,,3');
  });

  it('builds India-day ranges', () => {
    const now = Date.parse('2026-09-30T20:00:00Z'); // 01:30 on 1 Oct in India
    expect(lastDays(7, now)).toEqual({ from: '2026-09-25', to: '2026-10-01' });
    expect(daysOf('2026-09-29', '2026-10-01')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01']);
  });

  it('the TEST library example uses the documented columns and fictional people only', () => {
    const header = (LIBRARY_EXAMPLE.split('\n')[0] as string).split(',');
    const documented = LIBRARY_COLUMNS.flatMap((c) => c.name.split(/,\s*/));
    for (const h of header) expect(documented, h).toContain(h);
    for (const required of LIBRARY_COLUMNS.filter((c) => c.required).map((c) => c.name)) expect(header).toContain(required);
    expect(LIBRARY_EXAMPLE).toMatch(/Demo Star One/);
    expect(LIBRARY_EXAMPLE).not.toMatch(/https:\/\/(?!(instagram|cdn|facebook)\.example\.com)/);
  });

  it('the library column list matches the importer (source check)', () => {
    const src = readFileSync(join(WEB, '../api/src/looks/library-import.ts'), 'utf8');
    const listed = LIBRARY_COLUMNS.flatMap((c) => c.name.split(/,\s*/));
    for (const name of listed) expect(src, name).toContain(`'${name}'`);
  });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('source rules for the celebrity-look screens and pages', () => {
  const sources = [
    ...filesUnder(join(WEB, 'app/(shop)')),
    ...filesUnder(join(WEB, 'app/s')),
    ...filesUnder(join(WEB, 'app/admin')),
    ...filesUnder(join(WEB, 'components/shop')),
    ...filesUnder(join(WEB, 'components/admin/celebrity')),
    join(WEB, 'lib/spotted.ts'),
    join(WEB, 'lib/public-catalogue.ts'),
    join(WEB, 'lib/mock-spotted.ts'),
    join(WEB, 'lib/celebrity-admin.ts'),
    join(WEB, 'lib/demo/celebrity.ts'),
    join(WEB, 'middleware.ts'),
  ].filter((f) => /\.(tsx?|css)$/.test(f));

  it('keep the server-only clients out of client components', () => {
    for (const file of sources.filter((f) => /\.tsx?$/.test(f))) {
      const src = readFileSync(file, 'utf8');
      if (/^['"]use client['"]/.test(src.trimStart())) expect(src, file).not.toMatch(/lib\/public-catalogue|lib\/catalogue'|lib\/server-env|WEB_API_TOKEN/);
    }
  });

  it("use Afflino's own names, never another product's", () => {
    for (const file of sources) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/wishlink|\bEngage\b|Shop My Looks|Link Please/i);
    }
  });

  it('share and encode only afflino.com page addresses (a storefront), never a tracked link', () => {
    const page = readFileSync(join(WEB, 'app/s/[slug]/page.tsx'), 'utf8');
    expect(page).toContain('const url = `${siteUrl()}/s/${s.slug}`;');
    expect(page).toContain('<ShareButton url={url}');
    expect(page).toContain('<QrSvg text={url}');
  });

  it('never name a real person: the demo and fixture people are "Demo Star …"', () => {
    for (const file of [join(WEB, 'lib/mock-spotted.ts'), join(WEB, 'lib/demo/celebrity.ts')]) {
      const names = [...readFileSync(file, 'utf8').matchAll(/name: '([^']+)'/g)].map((m) => m[1] as string);
      for (const n of names) expect(n, file).toMatch(/^Demo\b/);
    }
  });
});
