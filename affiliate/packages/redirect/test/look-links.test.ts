// Links of celebrity looks at the redirect (0007): a paused link — a
// takedown, a rights review, an unpublished look, a removed product — serves
// the paused page (200, no redirect, no click), never a 404 and never the
// merchant; `?via=` (the page surface) is kept in clicks.context only when
// it is a short slug, and never reaches the merchant URL.
// A fake pool stands in for Postgres (REDIS_URL unset: no cache, no queue).

import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { VIA_RE, buildRedirectApp, routeFromRow, viaOf } from '../src/index.js';

const TOKEN = 'abcdef0123456789abcdef0123456789';

function fakePool(status: string, inserts: Array<{ context: Record<string, unknown> }>): Pool {
  return {
    query: async (text: string, params: unknown[] = []) => {
      if (/from links l/.test(text)) {
        return {
          rows: [
            {
              link_id: 'link-1',
              org_id: 'org-1',
              link_status: status,
              destination_url: 'https://shop.example.com/p/demo-sku',
              allowed_hosts: ['shop.example.com'],
              programme_status: 'active',
              offer_status: 'active',
              fresh_until: null,
            },
          ],
        };
      }
      if (/insert into clicks/.test(text)) {
        inserts.push({ context: JSON.parse(String(params[4])) as Record<string, unknown> });
        return { rows: [] };
      }
      return { rows: [] };
    },
  } as unknown as Pool;
}

describe('paused links', () => {
  it('routeFromRow blocks a paused link (plain and Amazon routes)', () => {
    const base = { link_id: 'l', org_id: 'o', destination_url: 'https://www.amazon.in/dp/B0DEMO0001', allowed_hosts: ['www.amazon.in'], programme_status: 'active', offer_status: 'active', fresh_until: null };
    expect(routeFromRow({ ...base, link_status: 'paused' }).route_block).toBe('link_paused');
    expect(routeFromRow({ ...base, link_status: 'active' }).route_block).toBeUndefined();
    const amazon = { ...base, amazon_account_id: 'a', amazon_account_status: 'active', amazon_store_id: 'demo-21', property_status: 'approved', property_platform: 'instagram', owner_verification_id: 'v' };
    expect(routeFromRow({ ...amazon, link_status: 'paused' }).route_block).toBe('link_paused');
    expect(routeFromRow({ ...amazon, link_status: 'active' }).route_block).toBeNull();
  });

  it('serves the paused page for a paused link: 200, no Location, no click', async () => {
    const inserts: Array<{ context: Record<string, unknown> }> = [];
    const app = await buildRedirectApp({ pool: fakePool('paused', inserts), ipHashKey: null, logStream: { write: () => undefined } });
    const res = await app.inject({ method: 'GET', url: `/r/${TOKEN}`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('This link is paused');
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(inserts).toEqual([]);
    await app.close();
  });
});

describe('via', () => {
  it('keeps a short slug surface in the click context; drops anything else; never forwards it', async () => {
    expect(VIA_RE.test('s-demo-page')).toBe(true);
    expect(viaOf({ via: 'look' })).toBe('look');
    expect(viaOf({ via: 'Look' })).toBeNull();
    expect(viaOf({ via: 'a'.repeat(41) })).toBeNull();
    expect(viaOf({ via: ['a', 'b'] })).toBeNull();
    const inserts: Array<{ context: Record<string, unknown> }> = [];
    const app = await buildRedirectApp({ pool: fakePool('active', inserts), ipHashKey: null, logStream: { write: () => undefined } });
    const ok = await app.inject({ method: 'GET', url: `/r/${TOKEN}?via=s-demo`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(ok.statusCode).toBe(302);
    expect(String(ok.headers.location)).not.toContain('via');
    const bad = await app.inject({ method: 'GET', url: `/r/${TOKEN}?via=%3Cscript%3E`, headers: { 'user-agent': 'Mozilla/5.0 Demo' } });
    expect(bad.statusCode).toBe(302);
    expect(inserts.map((i) => i.context.via)).toEqual(['s-demo', undefined]);
    await app.close();
  });
});
