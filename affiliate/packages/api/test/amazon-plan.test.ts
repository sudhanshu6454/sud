// deploy/linode/amazon-plan.py (called by `amazon.sh plan <N>`): the tracking-ID
// plan of the in-house network's most-viewed pages. TEST data only.
process.env.DATABASE_URL ??= 'postgres://localhost:5432/paparazzi_amazon_plan';

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const PLAN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../deploy/linode/amazon-plan.py');
const tmp = mkdtempSync(path.join(tmpdir(), 'amazon-plan-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const EXPORT_HEADER = 'Channel,Handle,Platform,Channel URL,Followers,Views (28d)';
const fb = (name: string, id: string, views: number) => `${name},,facebook,https://www.facebook.com/${id},10,${views}`;
const ig = (name: string, handle: string, views: number) => `${name},${handle},instagram,https://www.instagram.com/${handle}/,10,${views}`;

function run(dir: string, n: number, store = 'demo-21') {
  const out = path.join(dir, 'out.csv');
  const r = spawnSync('python3', [PLAN, path.join(dir, 'template.csv'), path.join(dir, 'meta'), String(n), out], {
    env: { ...process.env, AFFLINO_PLAN_STORE: store },
    encoding: 'utf8',
  });
  return { ...r, out };
}

function fixture(name: string, templateRows: string[], exports: Record<string, string[]>): string {
  const dir = path.join(tmp, name);
  mkdirSync(path.join(dir, 'meta'), { recursive: true });
  writeFileSync(path.join(dir, 'template.csv'), ['platform,account,tracking_id,url', ...templateRows].join('\n') + '\n');
  for (const [file, rows] of Object.entries(exports)) writeFileSync(path.join(dir, 'meta', file), [EXPORT_HEADER, ...rows].join('\n') + '\n');
  return dir;
}

describe('amazon-plan.py', () => {
  const dir = fixture(
    'basic',
    [
      'facebook,100000000000001,,https://www.facebook.com/100000000000001',
      'facebook,100000000000002,,https://www.facebook.com/100000000000002',
      'instagram,demo.reels,,https://www.instagram.com/demo.reels/',
      'instagram,demo.unlisted,,https://www.instagram.com/demo.unlisted/',
      'web,shop.example.com,,https://shop.example.com',
    ],
    {
      'facebook.csv': [fb('Demo Page One', '100000000000001', 500), fb('Demo Page Two', '100000000000002', 9000)],
      'instagram.csv': [ig('Demo Reels', 'Demo.Reels', 7000)],
    },
  );

  it('keeps the N most-viewed pages, numbers them under the Store ID and adds the site', () => {
    const r = run(dir, 2);
    expect(r.status).toBe(0);
    expect(readFileSync(r.out, 'utf8')).toBe(
      [
        'platform,account,tracking_id,url',
        'facebook,100000000000002,demo-p01-21,https://www.facebook.com/100000000000002',
        'instagram,demo.reels,demo-p02-21,https://www.instagram.com/demo.reels/',
        'web,shop.example.com,demo-web-21,https://shop.example.com',
      ].join('\n') + '\n',
    );
    expect(r.stdout).toMatch(/2 of 3 pages chosen by 28-day views \(97\.0% of those pages' views\), plus 1 website/);
    expect(r.stdout).toMatch(/demo-p01-21\s+9,000\s+Demo Page Two \(facebook\)/);
  });

  it('writes a file the setup step accepts', async () => {
    const r = run(dir, 3);
    const { parsePropertiesFile } = await import('../src/amazon/setup.js');
    const parsed = parsePropertiesFile(readFileSync(r.out, 'utf8'));
    expect(parsed.problems).toEqual([]);
    expect(parsed.declarations.map((d) => d.trackingId)).toEqual(['demo-p01-21', 'demo-p02-21', 'demo-p03-21', 'demo-web-21']);
  });

  it('never names a page after the Store ID itself (page 21 is p21)', () => {
    const many = Array.from({ length: 22 }, (_, i) => String(200000000000000 + i));
    const d = fixture('many', many.map((id) => `facebook,${id},,https://www.facebook.com/${id}`), {
      'facebook.csv': many.map((id, i) => fb(`Demo ${i}`, id, 1000 - i)),
    });
    const r = run(d, 22);
    expect(r.status).toBe(0);
    const tags = readFileSync(r.out, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[2]);
    expect(tags[20]).toBe('demo-p21-21');
    expect(tags).not.toContain('demo-21');
  });

  it('refuses when no template page matches the exports, writing nothing', () => {
    const d = fixture('nomatch', ['facebook,100000000000009,,https://www.facebook.com/100000000000009'], {
      'facebook.csv': [fb('Demo Other', '100000000000008', 5)],
    });
    const r = run(d, 5);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no template page matches the Meta exports/);
    expect(() => readFileSync(r.out, 'utf8')).toThrow();
  });
});
