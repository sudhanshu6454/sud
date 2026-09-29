/**
 * End-to-end test of packages/api/scripts/mint-links.mjs against a stub of
 * the three v1 endpoints it uses. Lives here (web/test) because the script
 * exists for the consumer shop's placement; it exercises the real script
 * via child_process.
 */
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../api/scripts/mint-links.mjs');
const PLACEMENT = 'a1b15b6e-556f-4183-9f09-75b6ccea5d30';
const PROPERTY = '6aa2f2d1-c553-48c2-883e-fd395abd144c';
const OFFER_LINKED = '11111111-1111-4111-8111-111111111111';
const OFFER_OPEN = '22222222-2222-4222-8222-222222222222';
const OFFER_BAD = '33333333-3333-4333-8333-333333333333';

interface Mint {
  body: Record<string, unknown>;
  idempotencyKey: string | undefined;
  auth: string | undefined;
}

interface Stub {
  server: Server;
  base: string;
  mints: Mint[];
  detailCalls: string[];
}

function offer(id: string) {
  return {
    id,
    programme_id: 'cd70fe7c-85a2-46d2-85c2-2d9e2005af29',
    merchant: { id: 'm', name: 'Demo Merchant' },
    price_minor: 200000,
    currency: 'INR',
    stock_status: 'in_stock',
    fresh_until: '2026-10-29T00:00:00.000Z',
  };
}

const LOOKS = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [{ id: 'i1', offer: offer(OFFER_LINKED), link: { token: 'x', url: 'http://r/x' } }, { id: 'i2', offer: offer(OFFER_OPEN), link: null }, { id: 'i3', offer: null, link: null }] },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', items: [{ id: 'i4', offer: offer(OFFER_OPEN), link: null }] },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', items: [{ id: 'i5', offer: offer(OFFER_BAD), link: null }] },
];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c: Buffer) => { data += c.toString(); });
    req.on('end', () => resolve(data));
  });
}

async function startStub(): Promise<Stub> {
  const mints: Mint[] = [];
  const detailCalls: string[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.pathname === '/v1/looks') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('page_size') ?? '100');
      const start = (page - 1) * pageSize;
      const items = LOOKS.slice(start, start + pageSize).map((l) => ({ id: l.id, title: `Demo ${l.id}`, locale: 'en', category: null, published_at: null, source_page: null, sponsored: false, cover_url: null, item_count: l.items.length }));
      return send(200, { data: { items, page, page_size: pageSize, total: LOOKS.length }, request_id: 'r' });
    }
    const detail = /^\/v1\/looks\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && detail) {
      detailCalls.push(url.search);
      const look = LOOKS.find((l) => l.id === detail[1]);
      if (!look) return send(404, { error: { code: 'NOT_FOUND', message: 'Look not found' }, request_id: 'r' });
      const placement = url.searchParams.get('placement_id') === PLACEMENT ? { id: PLACEMENT, property_id: PROPERTY, campaign_id: 'c' } : null;
      return send(200, { data: { id: look.id, items: look.items, placement }, request_id: 'r' });
    }
    if (req.method === 'POST' && url.pathname === '/v1/links') {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const idem = req.headers['idempotency-key'];
      mints.push({ body, idempotencyKey: Array.isArray(idem) ? idem[0] : idem, auth: req.headers.authorization });
      if (body.offer_id === OFFER_BAD) {
        return send(403, { error: { code: 'PROGRAMME_NOT_APPROVED', message: 'Programme is not active' }, request_id: 'r' });
      }
      return send(201, { data: { token: 'f'.repeat(32), url: `http://127.0.0.1:3101/r/${'f'.repeat(32)}` }, request_id: 'r' });
    }
    return send(404, { error: { code: 'NOT_FOUND', message: 'no route' }, request_id: 'r' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  return { server, base: `http://127.0.0.1:${addr.port}`, mints, detailCalls };
}

function run(args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

let stub: Stub | null = null;
afterEach(async () => {
  if (stub) await new Promise<void>((resolve) => stub!.server.close(() => resolve()));
  stub = null;
});

describe('mint-links.mjs', () => {
  it('mints once per open offer, skips linked / offer-less / duplicate items, reports failures verbatim, exits 1', async () => {
    stub = await startStub();
    const out = await run(['--placement', PLACEMENT, '--page-size', '2'], { API_BASE: stub.base, API_TOKEN: 'dev-token' });
    expect(out.code).toBe(1);
    expect(stub.detailCalls).toEqual([`?placement_id=${PLACEMENT}`, `?placement_id=${PLACEMENT}`, `?placement_id=${PLACEMENT}`]);
    expect(stub.mints).toHaveLength(2);
    expect(stub.mints[0]).toEqual({
      body: { property_id: PROPERTY, programme_id: 'cd70fe7c-85a2-46d2-85c2-2d9e2005af29', offer_id: OFFER_OPEN, placement_id: PLACEMENT },
      idempotencyKey: `mint-links:${PLACEMENT}:${OFFER_OPEN}`,
      auth: 'Bearer dev-token',
    });
    expect(stub.mints[1]?.body.offer_id).toBe(OFFER_BAD);
    expect(out.stdout).toContain(`minted look=${LOOKS[0]!.id} item=i2 offer=${OFFER_OPEN} token=${'f'.repeat(32)} url=http://127.0.0.1:3101/r/${'f'.repeat(32)}`);
    expect(out.stdout).toContain('summary: looks=3 items=5 minted=1 replayed=0 skipped_linked=1 skipped_no_offer=1 skipped_duplicate_offer=1 failed=1');
    expect(out.stderr).toContain(`FAILED look=${LOOKS[2]!.id} item=i5 offer=${OFFER_BAD}: HTTP 403 PROGRAMME_NOT_APPROVED: Programme is not active`);
    expect(out.stderr).toContain('dev stub');
  });

  it('--dry-run performs no POST and exits 0', async () => {
    stub = await startStub();
    const out = await run(['--placement', PLACEMENT, '--dry-run'], { API_BASE: stub.base, API_TOKEN: 'dev-token' });
    expect(out.code).toBe(0);
    expect(stub.mints).toHaveLength(0);
    expect(out.stdout).toContain(`would mint look=${LOOKS[0]!.id} item=i2 offer=${OFFER_OPEN}`);
    expect(out.stdout).toContain('would_mint=2');
  });

  it('refuses to run without a uuid placement or a token (exit 2, no requests)', async () => {
    stub = await startStub();
    const noPlacement = await run(['--placement', 'demo-ig-bio-1'], { API_BASE: stub.base, API_TOKEN: 'dev-token' });
    expect(noPlacement.code).toBe(2);
    const noToken = await run(['--placement', PLACEMENT], { API_BASE: stub.base, API_TOKEN: '' });
    expect(noToken.code).toBe(2);
    expect(stub.detailCalls).toHaveLength(0);
  });
});
