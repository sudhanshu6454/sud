/**
 * db/meta-network.ts: the owner's Meta channel exports → the network file the
 * seed reads. Fixtures are TEST rows ("Demo …" names); the real exports never
 * enter the repository.
 */
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { metaToNetwork, parseCsv } from '../../../db/meta-network.ts';
import { networkFromYaml } from '../../../db/seed-network.ts';

const HEADER =
  'Channel,Handle,Platform,Channel URL,Followers,Follower change (28d) [+ gained / - lost / blank = no history yet],Views (28d),Engagements (28d),Reach (28d),Revenue USD (28d),Profile views,Posts,New follows (28d),Unfollows (28d),Saves (28d),Shares (28d),Accounts engaged (28d),Data through';
const row = (channel: string, handle: string, platform: string, url: string) =>
  [channel, handle, platform, url, '100', '', '1000', '10', '500', '0.00', '5', '3', '1', '0', '', '', '', '2026-09-27'].join(',');

const FB = [
  '﻿' + HEADER,
  row('Demo Page', 'DemoPage', 'facebook', 'https://www.facebook.com/100000000000001'),
  row('Demo Page', '', 'facebook', 'https://www.facebook.com/100000000000002'),
  row('"Demo, Quoted ""Page"""', 'demo.quoted', 'facebook', 'https://www.facebook.com/100000000000003'),
  row('Demo Vanity', 'DemoVanity', 'facebook', 'https://www.facebook.com/Demo.Vanity/'),
  row('Demo Threads', 'demothreads', 'threads', 'https://www.threads.net/@demothreads'),
].join('\r\n');

const IG = [
  HEADER,
  row('Demo Page', 'demo_page', 'instagram', 'https://www.instagram.com/demo_page/'),
  row('Demo Reels', 'Demo.Reels', 'instagram', 'https://www.instagram.com/Demo.Reels/'),
].join('\n');

const NOW = new Date('2026-09-29T00:00:00Z');

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas and newlines inside quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""","line\nbreak"\r\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'line\nbreak'],
    ]);
  });

  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/never closed/);
  });
});

describe('metaToNetwork', () => {
  const result = metaToNetwork(
    [
      { name: 'facebook.csv', text: FB },
      { name: 'instagram.csv', text: IG },
    ],
    NOW,
  );

  it('keeps Facebook pages by page ID and Instagram accounts by handle, one property each', () => {
    expect(result.properties).toEqual([
      { key: 'fb-100000000000001', name: 'Demo Page (Facebook, DemoPage)', platform: 'facebook', account: '100000000000001', url: 'https://www.facebook.com/100000000000001' },
      { key: 'fb-100000000000002', name: 'Demo Page (Facebook, 100000000000002)', platform: 'facebook', account: '100000000000002', url: 'https://www.facebook.com/100000000000002' },
      { key: 'fb-100000000000003', name: 'Demo, Quoted "Page" (Facebook)', platform: 'facebook', account: '100000000000003', url: 'https://www.facebook.com/100000000000003' },
      { key: 'fb-demo-vanity', name: 'Demo Vanity (Facebook)', platform: 'facebook', account: 'demo.vanity', url: 'https://www.facebook.com/demo.vanity' },
      { key: 'ig-demo-page', name: 'Demo Page (Instagram)', platform: 'instagram', account: 'demo_page', url: 'https://www.instagram.com/demo_page/' },
      { key: 'ig-demo-reels', name: 'Demo Reels (Instagram)', platform: 'instagram', account: 'demo.reels', url: 'https://www.instagram.com/demo.reels/' },
    ]);
    expect(result.counts).toEqual({ facebook: 4, instagram: 2 });
  });

  it('skips platforms it does not convert, with the file and line', () => {
    expect(result.skipped).toEqual(["facebook.csv:6: platform 'threads' is not converted (add it to the network file by hand)"]);
  });

  it('writes YAML the seed accepts, with the same properties', () => {
    const parsed = networkFromYaml(parseYaml(result.yaml), 'yaml');
    expect(parsed.properties).toEqual(result.properties);
    expect(result.yaml.startsWith('# Afflino in-house publisher network: REAL accounts, not TEST data.\n')).toBe(true);
    expect(result.yaml).toContain('# Written by db/meta-network.ts on 2026-09-29T00:00:00.000Z from facebook.csv, instagram.csv:');
  });

  it('keeps an account listed twice once', () => {
    const twice = metaToNetwork([{ name: 'a.csv', text: IG }, { name: 'b.csv', text: IG }], NOW);
    expect(twice.properties).toHaveLength(2);
    expect(twice.duplicates).toBe(2);
  });

  it('shortens a long name to the seed limit and makes clashing keys unique', () => {
    const long = 'Demo ' + 'Long '.repeat(30);
    const out = metaToNetwork(
      [
        {
          name: 'fb.csv',
          text: [
            HEADER,
            row(long, '', 'facebook', 'https://www.facebook.com/demo.clash'),
            row('Demo Clash', '', 'facebook', 'https://www.facebook.com/demo..clash'),
          ].join('\n'),
        },
      ],
      NOW,
    );
    expect(out.properties[0].name.length).toBeLessThanOrEqual(80);
    expect(out.properties[0].name.endsWith('… (Facebook)')).toBe(true);
    expect(out.properties.map((p) => p.key)).toEqual(['fb-demo-clash', 'fb-demo-clash-2']);
  });

  it('refuses a file without the export columns', () => {
    expect(() => metaToNetwork([{ name: 'x.csv', text: 'Name,Link\nDemo,https://x.example.com\n' }], NOW)).toThrow(
      /x\.csv has no 'Channel' column/,
    );
  });
});
