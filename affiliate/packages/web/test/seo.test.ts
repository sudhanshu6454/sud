import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import manifest from '../app/manifest';
import {
  NOT_FOR_INDEX_ROBOTS,
  OG_IMAGE_PATH,
  PRE_LAUNCH_ROBOTS,
  ROBOTS_DISALLOW,
  SITEMAP_PATHS,
  isTestLabelledTitle,
  pageMetadata,
  robotsFor,
  rootMetadata,
  shopDetailMetadata,
  sitemapFor,
} from '../lib/seo';
import { DEFAULT_SITE_URL, siteIndexing, siteUrl } from '../lib/site';
import { SITE_DESCRIPTION } from '../lib/site-copy';

const WEB = join(__dirname, '..');
const ENV_KEYS = ['SITE_URL', 'SITE_INDEXING', 'NEXT_PUBLIC_SITE_NAME', 'WEB_API_TOKEN', 'WEB_PLACEMENT_ID', 'API_BASE'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe('siteUrl (SITE_URL, runtime)', () => {
  it('defaults to https://afflino.com', () => {
    delete process.env.SITE_URL;
    expect(DEFAULT_SITE_URL).toBe('https://afflino.com');
    expect(siteUrl()).toBe('https://afflino.com');
    process.env.SITE_URL = '   ';
    expect(siteUrl()).toBe('https://afflino.com');
  });

  it('uses the origin of an absolute http(s) URL, read on every call', () => {
    process.env.SITE_URL = 'https://staging.afflino.com/';
    expect(siteUrl()).toBe('https://staging.afflino.com');
    process.env.SITE_URL = 'http://127.0.0.1:8088/some/path?x=1';
    expect(siteUrl()).toBe('http://127.0.0.1:8088');
  });

  it('never canonicalises to a malformed or non-http value', () => {
    for (const bad of ['afflino.com', 'ftp://afflino.com', 'javascript:alert(1)', 'https://']) {
      process.env.SITE_URL = bad;
      expect(siteUrl(), bad).toBe('https://afflino.com');
    }
  });
});

describe('root metadata', () => {
  it('sets metadataBase, Open Graph and a summary Twitter card from SITE_URL and lib/site-copy', () => {
    process.env.SITE_URL = 'https://afflino.com';
    delete process.env.NEXT_PUBLIC_SITE_NAME;
    const m = rootMetadata(true);
    expect(String(m.metadataBase)).toBe('https://afflino.com/');
    expect(m.title).toEqual({ default: 'Afflino', template: '%s · Afflino' });
    expect(m.description).toBe(SITE_DESCRIPTION);
    expect(m.openGraph).toMatchObject({
      siteName: 'Afflino',
      type: 'website',
      locale: 'en_IN',
      url: '/',
      title: 'Afflino',
      description: SITE_DESCRIPTION,
      images: [{ url: '/icons/icon-512.png', width: 512, height: 512 }],
    });
    expect(m.twitter).toMatchObject({ card: 'summary', description: SITE_DESCRIPTION, images: [OG_IMAGE_PATH] });
    // No site-wide canonical: it would point every inheriting page at "/".
    expect(m.alternates).toBeUndefined();
    // Open for indexing: no robots meta of its own.
    expect(m.robots).toBeUndefined();
  });

  it('follows SITE_URL and NEXT_PUBLIC_SITE_NAME at runtime', () => {
    process.env.SITE_URL = 'https://staging.afflino.com';
    process.env.NEXT_PUBLIC_SITE_NAME = 'Afflino Staging';
    const m = rootMetadata();
    expect(String(m.metadataBase)).toBe('https://staging.afflino.com/');
    expect(m.openGraph).toMatchObject({ siteName: 'Afflino Staging', title: 'Afflino Staging' });
  });

  it('the share image exists in public/', () => {
    expect(readFileSync(join(WEB, 'public', OG_IMAGE_PATH)).length).toBeGreaterThan(0);
  });
});

describe('pageMetadata (canonical + og:url per page)', () => {
  it('puts canonical and og:url on the page path and keeps the full Open Graph block', () => {
    delete process.env.NEXT_PUBLIC_SITE_NAME;
    const m = pageMetadata('/shop', 'Shop the looks');
    expect(m.title).toBe('Shop the looks');
    expect(m.alternates).toEqual({ canonical: '/shop' });
    expect(m.openGraph).toMatchObject({
      url: '/shop',
      title: 'Shop the looks · Afflino',
      siteName: 'Afflino',
      type: 'website',
      locale: 'en_IN',
      description: SITE_DESCRIPTION,
    });
    expect(m.twitter).toMatchObject({ card: 'summary', title: 'Shop the looks · Afflino' });
  });

  it('the home page keeps the root title', () => {
    const m = pageMetadata('/');
    expect(m.title).toBeUndefined();
    expect(m.alternates).toEqual({ canonical: '/' });
    expect(m.openGraph).toMatchObject({ url: '/', title: 'Afflino' });
  });

  it('the marketing and shop pages declare it (source check)', () => {
    const pages: Array<[string, string]> = [
      ['app/(marketing)/page.tsx', "pageMetadata('/')"],
      ['app/(marketing)/contact/page.tsx', "pageMetadata('/contact', 'Contact')"],
      ['app/(marketing)/terms/page.tsx', "pageMetadata('/terms', 'Terms of use')"],
      ['app/(marketing)/privacy/page.tsx', "pageMetadata('/privacy', 'Privacy notice')"],
      ['app/(shop)/shop/page.tsx', "pageMetadata('/shop', 'Shop the looks')"],
      ['app/(shop)/looks/[id]/page.tsx', 'shopDetailMetadata(`/looks/${encodeURIComponent(look.id)}`, look.title, {'],
      ['app/(shop)/looks/[id]/items/[itemId]/page.tsx', '`/looks/${encodeURIComponent(look.id)}/items/${encodeURIComponent(item.id)}`'],
    ];
    for (const [file, call] of pages) {
      expect(readFileSync(join(WEB, file), 'utf8'), file).toContain(call);
    }
  });
});

describe('the indexing gate (SITE_INDEXING)', () => {
  it('only "on" opens it; unset, empty, off and anything else are pre-launch', () => {
    delete process.env.SITE_INDEXING;
    expect(siteIndexing()).toBe(false);
    for (const v of ['', ' ', 'off', 'OFF', 'true', '1', 'yes', 'onn']) {
      process.env.SITE_INDEXING = v;
      expect(siteIndexing(), JSON.stringify(v)).toBe(false);
    }
    for (const v of ['on', 'ON', ' On ']) {
      process.env.SITE_INDEXING = v;
      expect(siteIndexing(), JSON.stringify(v)).toBe(true);
    }
  });

  it('pre-launch, every page inherits noindex, nofollow from the root metadata', () => {
    delete process.env.SITE_INDEXING;
    expect(rootMetadata().robots).toEqual({ index: false, follow: false });
    expect(rootMetadata(false).robots).toEqual(PRE_LAUNCH_ROBOTS);
    process.env.SITE_INDEXING = 'on';
    expect(rootMetadata().robots).toBeUndefined();
    // The rest of the root metadata does not depend on the gate.
    const { robots: _closed, ...closed } = rootMetadata(false);
    const { robots: _open, ...open } = rootMetadata(true);
    expect(closed).toEqual(open);
  });

  it('no page opts itself back in: every page-level robots setting is noindex, nofollow', () => {
    // pageMetadata never sets robots, so public pages inherit the gate.
    expect(pageMetadata('/shop', 'Shop the looks').robots).toBeUndefined();
    // Every `robots:` in app/ is the noindex pair (the app areas, /join,
    // /login, /dev); none says index: true.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : [],
      );
    const settings = walk(join(WEB, 'app')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/robots:\s*(\{[^}]*\})/g)].map((m) => [file, m[1]] as const),
    );
    expect(settings.length).toBeGreaterThanOrEqual(7);
    for (const [file, value] of settings) {
      expect(value, file).toBe('{ index: false, follow: false }');
    }
  });

  it('pre-launch robots.txt is Disallow: / with no sitemap line', () => {
    const r = robotsFor('https://afflino.com', false);
    expect(r).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });
    expect(r.sitemap).toBeUndefined();
    delete process.env.SITE_INDEXING;
    process.env.SITE_URL = 'https://afflino.com';
    expect(robots()).toEqual({ rules: [{ userAgent: '*', disallow: '/' }] });
    process.env.SITE_INDEXING = 'off';
    expect(robots().sitemap).toBeUndefined();
  });

  it('pre-launch sitemap.xml lists nothing and does not read the catalogue', async () => {
    expect(sitemapFor('https://afflino.com', [{ id: 'b2', title: 'Summer edit', publishedAt: null }], false)).toEqual([]);
    delete process.env.SITE_INDEXING;
    process.env.WEB_API_TOKEN = 'token';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await sitemap()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('robots.txt (SITE_INDEXING=on)', () => {
  it('allows the public site, disallows the app areas and points to the sitemap', () => {
    const r = robotsFor('https://afflino.com', true);
    expect(r.sitemap).toBe('https://afflino.com/sitemap.xml');
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    expect(rules).toHaveLength(1);
    expect(rules[0]!.userAgent).toBe('*');
    expect(rules[0]!.allow).toEqual(['/', '/apple-icon.png']);
    expect(rules[0]!.disallow).toEqual(['/app', '/brand', '/agency', '/admin', '/join', '/login', '/api', '/dev', '/saved']);
    expect([...ROBOTS_DISALLOW]).toEqual(rules[0]!.disallow);
  });

  it('app/robots.ts reads SITE_URL and SITE_INDEXING per request', () => {
    process.env.SITE_INDEXING = 'on';
    process.env.SITE_URL = 'https://afflino.com';
    expect(robots().sitemap).toBe('https://afflino.com/sitemap.xml');
    process.env.SITE_URL = 'http://127.0.0.1:8088';
    expect(robots().sitemap).toBe('http://127.0.0.1:8088/sitemap.xml');
  });

  it('every disallowed area that renders HTML also declares noindex, nofollow', () => {
    const noindex = /robots:\s*\{ index: false, follow: false \}/;
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
      );
    const groups = readdirSync(join(WEB, 'app')).filter((d) => /^\(.*\)$/.test(d));
    for (const area of ROBOTS_DISALLOW) {
      const dirs = [join(WEB, 'app', area), ...groups.map((g) => join(WEB, 'app', g, area))].filter((d) => existsSync(d));
      expect(dirs, area).toHaveLength(1);
      const files = walk(dirs[0]!);
      const pages = files.filter((f) => /[/\\]page\.tsx$/.test(f));
      if (pages.length === 0) {
        // /api: route handlers only, no HTML to carry a meta tag.
        expect(files.some((f) => /[/\\]route\.ts$/.test(f)), area).toBe(true);
        continue;
      }
      const layout = join(dirs[0]!, 'layout.tsx');
      if (existsSync(layout) && noindex.test(readFileSync(layout, 'utf8'))) continue;
      for (const page of pages) {
        expect(readFileSync(page, 'utf8'), `${area}: ${page}`).toMatch(noindex);
      }
    }
  });

  it('never disallows a public page', () => {
    const disallow = [...ROBOTS_DISALLOW];
    for (const path of ['/', '/shop', '/looks/x', '/contact', '/terms', '/privacy']) {
      // Robots rules are prefixes: nothing public may start with a disallowed one.
      expect(disallow.some((d) => path.startsWith(d)), path).toBe(false);
    }
  });
});

describe('sitemap.xml (SITE_INDEXING=on)', () => {
  it('lists / and /shop, and one entry per live look', () => {
    expect([...SITEMAP_PATHS]).toEqual(['/', '/shop']);
    const s = sitemapFor(
      'https://afflino.com',
      [
        { id: '5793fbd2-9e8b-4a94-ac49-b1fde7128084', title: 'Festive edit', publishedAt: '2026-09-29T00:00:00.000Z' },
        { id: 'b2', title: 'Office wear', publishedAt: null },
      ],
      true,
    );
    expect(s).toEqual([
      { url: 'https://afflino.com/' },
      { url: 'https://afflino.com/shop' },
      { url: 'https://afflino.com/looks/5793fbd2-9e8b-4a94-ac49-b1fde7128084', lastModified: '2026-09-29T00:00:00.000Z' },
      { url: 'https://afflino.com/looks/b2' },
    ]);
    // The stub pages (contact, terms, privacy) stay out until they have content.
    expect(s.some((e) => /\/(contact|terms|privacy)$/.test(e.url))).toBe(false);
  });

  it('never lists a TEST-labelled look, even from the live catalogue', () => {
    expect(isTestLabelledTitle('Demo look — Demo Instagram')).toBe(true);
    expect(isTestLabelledTitle('  demo-look')).toBe(true);
    expect(isTestLabelledTitle('Demolition chic')).toBe(false);
    expect(isTestLabelledTitle('Festive edit')).toBe(false);
    const s = sitemapFor(
      'https://afflino.com',
      [
        { id: 'test-1', title: 'Demo look — Demo Instagram', publishedAt: null },
        { id: 'real-1', title: 'Festive edit', publishedAt: null },
      ],
      true,
    );
    expect(s.map((e) => e.url)).toEqual([
      'https://afflino.com/',
      'https://afflino.com/shop',
      'https://afflino.com/looks/real-1',
    ]);
  });

  it('demo data contributes no look (no WEB_API_TOKEN)', async () => {
    process.env.SITE_INDEXING = 'on';
    process.env.SITE_URL = 'https://afflino.com';
    delete process.env.WEB_API_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const s = await sitemap();
    expect(s.map((e) => e.url)).toEqual(['https://afflino.com/', 'https://afflino.com/shop']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an unreachable API (demo fallback) contributes no look either', async () => {
    process.env.SITE_INDEXING = 'on';
    process.env.SITE_URL = 'https://afflino.com';
    process.env.WEB_API_TOKEN = 'token';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const s = await sitemap();
    expect(s).toHaveLength(2);
  });

  it('the live catalogue adds its looks', async () => {
    process.env.SITE_INDEXING = 'on';
    process.env.SITE_URL = 'https://afflino.com';
    process.env.WEB_API_TOKEN = 'token';
    process.env.API_BASE = 'http://api:3000';
    const testLook = {
      id: '0b0b0b0b-9e8b-4a94-ac49-b1fde7128084',
      title: 'Demo look — Demo Web',
      locale: 'en',
      category: null,
      published_at: '2026-09-29T00:00:00.000Z',
      source_page: null,
      sponsored: false,
      cover_url: null,
      item_count: 1,
    };
    const look = {
      id: '5793fbd2-9e8b-4a94-ac49-b1fde7128084',
      title: 'Festive edit',
      locale: 'en',
      category: null,
      published_at: '2026-09-29T00:00:00.000Z',
      source_page: null,
      sponsored: false,
      cover_url: null,
      item_count: 1,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [testLook, look], page: 1, page_size: 100, total: 2 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const s = await sitemap();
    expect(s.map((e) => e.url)).toEqual([
      'https://afflino.com/',
      'https://afflino.com/shop',
      'https://afflino.com/looks/5793fbd2-9e8b-4a94-ac49-b1fde7128084',
    ]);
  });
});

describe('look and item pages (shopDetailMetadata)', () => {
  it('a live, non-TEST look is indexable: no robots of its own', () => {
    const m = shopDetailMetadata('/looks/real-1', 'Festive edit', { demo: false, lookTitle: 'Festive edit' });
    expect(m.robots).toBeUndefined();
    expect(m).toEqual(pageMetadata('/looks/real-1', 'Festive edit'));
  });

  it('demo data and TEST-labelled looks or items are noindex, nofollow', () => {
    const cases: Array<[string, { demo: boolean; lookTitle: string }]> = [
      // the web's own demo looks (no WEB_API_TOKEN / API unreachable)
      ['Office wear', { demo: true, lookTitle: 'Office wear' }],
      // the network seed's TEST looks, served by the live API
      ['Demo look — Demo Web', { demo: false, lookTitle: 'Demo look — Demo Web' }],
      // an item of a TEST look
      ['Blazer', { demo: false, lookTitle: 'Demo look — Demo Instagram' }],
      // a TEST-labelled item
      ['Demo Kaya — Blazer', { demo: false, lookTitle: 'Festive edit' }],
    ];
    for (const [title, opts] of cases) {
      const m = shopDetailMetadata('/looks/x', title, opts);
      expect(m.robots, title).toEqual(NOT_FOR_INDEX_ROBOTS);
      expect(m.robots, title).toEqual({ index: false, follow: false });
      // canonical and og:url stay on the page's own path
      expect(m.alternates).toEqual({ canonical: '/looks/x' });
    }
  });

  it('both look routes use it with the catalogue result\'s demo flag (source check)', () => {
    for (const file of ['app/(shop)/looks/[id]/page.tsx', 'app/(shop)/looks/[id]/items/[itemId]/page.tsx']) {
      const src = readFileSync(join(WEB, file), 'utf8');
      expect(src, file).toContain('shopDetailMetadata(');
      expect(src, file).toContain('demo: result.demo');
      expect(src, file).toMatch(/lookTitle: look\.title/);
      expect(src, file).not.toContain('pageMetadata(');
    }
  });
});

describe('manifest', () => {
  it('uses the shared description', () => {
    expect(manifest().description).toBe(SITE_DESCRIPTION);
  });
});
