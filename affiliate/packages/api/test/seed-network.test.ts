// db/seed-network.ts: the network file's parser and validation, and the CLI's flag parsing and guards.
//
// The seed itself (the SQL) is exercised on real Postgres by CI and by hand
// (db/README.md "Network seed"); this suite pins what a network file may contain
// before anything reaches a database: rejected entries throw, and a url outside the
// reserved example names is a warning, not an error (an operator's own file names
// real accounts). The shipped example file must stay TEST-only: no warnings.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_NETWORK_FILE,
  NETWORK_PLATFORMS,
  cliNotices,
  warningLines,
  cliRefusal,
  PLATFORM_CHANNEL,
  SHOP_PLACEMENT_KEY,
  isReservedExampleHost,
  loadNetworkFile,
  networkFromYaml,
  parseNetworkArgs,
  placementKeyFor,
} from '../../../db/seed-network.ts';

type Entry = Record<string, unknown>;

const ig = (over: Entry = {}): Entry => ({
  key: 'demo-ig',
  name: 'Demo Instagram',
  platform: 'instagram',
  account: 'demo.afflino',
  url: 'https://instagram.example.com/demo.afflino',
  ...over,
});
const web = (over: Entry = {}): Entry => ({
  key: 'demo-web',
  name: 'Demo Web',
  platform: 'web',
  account: 'demo-web.example.com',
  url: 'https://demo-web.example.com',
  ...over,
});
const file = (...properties: unknown[]) => ({ properties });

const tmp = mkdtempSync(path.join(tmpdir(), 'seed-network-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('db/network.example.yaml (the default network file)', () => {
  it('parses to six TEST properties, one per platform, with no warnings', async () => {
    const { properties, warnings } = await loadNetworkFile(DEFAULT_NETWORK_FILE);
    expect(warnings).toEqual([]);
    expect(properties.map((p) => p.platform).sort()).toEqual([...NETWORK_PLATFORMS].sort());
    for (const p of properties) {
      expect(p.name.startsWith('Demo ')).toBe(true);
      expect(p.account).toMatch(/demo/);
      expect(isReservedExampleHost(new URL(p.url).hostname)).toBe(true);
    }
  });

  it('is the default unless NETWORK_FILE or --network says otherwise', () => {
    expect(parseNetworkArgs([], {}).networkPath).toBe(DEFAULT_NETWORK_FILE);
    expect(parseNetworkArgs([], { NETWORK_FILE: '  ' }).networkPath).toBe(DEFAULT_NETWORK_FILE);
    expect(path.basename(DEFAULT_NETWORK_FILE)).toBe('network.example.yaml');
  });
});

describe('networkFromYaml — rejected files', () => {
  it('rejects a platform outside instagram | facebook | youtube | snapchat | telegram | web', () => {
    expect(() => networkFromYaml(file(ig({ platform: 'tiktok' })))).toThrow(
      /properties\[0\]\.platform 'tiktok' is not one of instagram \| facebook \| youtube \| snapchat \| telegram \| web/,
    );
  });

  it('accepts a Facebook page by its numeric page ID (real accounts warn, still seeded)', () => {
    const { properties, warnings } = networkFromYaml(
      file(ig({ key: 'fb-100000000000001', name: 'Page (Facebook)', platform: 'facebook', account: '100000000000001', url: 'https://www.facebook.com/100000000000001' })),
    );
    expect(properties).toEqual([
      { key: 'fb-100000000000001', name: 'Page (Facebook)', platform: 'facebook', account: '100000000000001', url: 'https://www.facebook.com/100000000000001' },
    ]);
    expect(placementKeyFor('fb-100000000000001', 'facebook')).toBe('network-fb-100000000000001-facebook_post');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/www\.facebook\.com' is not a reserved example name/);
  });

  it('rejects a duplicate key', () => {
    expect(() => networkFromYaml(file(ig(), web({ key: 'demo-ig' })))).toThrow(/duplicate key 'demo-ig'/);
  });

  it('rejects a duplicate name, case-insensitively (the demo look is titled after it)', () => {
    expect(() => networkFromYaml(file(ig(), web({ name: 'demo instagram' })))).toThrow(
      /duplicate name 'demo instagram'/,
    );
  });

  it('rejects the same platform + account twice, but allows one handle on two platforms', () => {
    expect(() => networkFromYaml(file(ig(), ig({ key: 'demo-ig-2', name: 'Demo Instagram 2' })))).toThrow(
      /lists instagram\/demo\.afflino twice/,
    );
    const ok = networkFromYaml(
      file(ig(), ig({ key: 'demo-yt', name: 'Demo YouTube', platform: 'youtube', url: 'https://youtube.example.com/x' })),
    );
    expect(ok.properties).toHaveLength(2);
  });

  it.each(['key', 'name', 'platform', 'account', 'url'])('rejects an entry missing %s', (field) => {
    const entry = ig();
    delete entry[field];
    expect(() => networkFromYaml(file(entry))).toThrow(new RegExp(`properties\\[0\\] is missing '${field}'`));
    expect(() => networkFromYaml(file(ig({ [field]: '   ' })))).toThrow(/is missing/);
  });

  it('rejects unknown fields and unknown top-level keys (typos fail loudly)', () => {
    expect(() => networkFromYaml(file(ig({ acount: 'x' })))).toThrow(/unknown field 'acount'/);
    expect(() => networkFromYaml({ properties: [ig()], sites: [] })).toThrow(/unknown top-level key 'sites'/);
  });

  it('rejects an empty or missing properties list and a non-mapping document', () => {
    expect(() => networkFromYaml({ properties: [] })).toThrow(/no non-empty 'properties:' list/);
    expect(() => networkFromYaml({})).toThrow(/no non-empty 'properties:' list/);
    expect(() => networkFromYaml(null)).toThrow(/must be a mapping/);
    expect(() => networkFromYaml([ig()])).toThrow(/must be a mapping/);
    expect(() => networkFromYaml(file('demo-ig'))).toThrow(/properties\[0\] must be a mapping/);
  });

  it('rejects a name longer than 80 characters', () => {
    expect(networkFromYaml(file(ig({ name: 'D'.repeat(80) }))).properties[0]?.name).toHaveLength(80);
    expect(() => networkFromYaml(file(ig({ name: 'D'.repeat(81) })))).toThrow(/\.name is longer than 80 characters/);
  });

  it('rejects a key outside [a-z0-9-]', () => {
    for (const key of ['Demo-IG', 'demo_ig', '-demo', 'demo-', 'a'.repeat(41)]) {
      expect(() => networkFromYaml(file(ig({ key })))).toThrow(/\.key .* must be 1-40 lower-case letters/);
    }
  });

  it('rejects a url that is not https, is not a URL or carries credentials', () => {
    expect(() => networkFromYaml(file(ig({ url: 'http://instagram.example.com/demo' })))).toThrow(/must be https/);
    expect(() => networkFromYaml(file(ig({ url: 'instagram.example.com/demo' })))).toThrow(/is not a URL/);
    expect(() => networkFromYaml(file(ig({ url: 'https://u:p@instagram.example.com/demo' })))).toThrow(
      /must not carry credentials/,
    );
  });

  it('rejects a web account that is not a bare hostname, or whose url host differs', () => {
    expect(() => networkFromYaml(file(web({ account: 'https://demo-web.example.com' })))).toThrow(
      /must be a bare hostname/,
    );
    expect(() => networkFromYaml(file(web({ url: 'https://other.example.com' })))).toThrow(
      /url host 'other\.example\.com' must equal the web account 'demo-web\.example\.com'/,
    );
  });

  it('rejects a social handle with characters no platform allows', () => {
    expect(() => networkFromYaml(file(ig({ account: 'demo afflino' })))).toThrow(/must be a handle/);
    expect(() => networkFromYaml(file(ig({ account: 'demo/afflino' })))).toThrow(/must be a handle/);
  });
});

describe('networkFromYaml — accepted files', () => {
  it('normalises: trims, lower-cases platform and handle, drops a leading @', () => {
    const { properties, warnings } = networkFromYaml(
      file(ig({ key: ' demo-ig ', platform: 'Instagram', account: '@Demo.Afflino' }), web({ account: 'Demo-Web.Example.com' })),
    );
    expect(warnings).toEqual([]);
    expect(properties[0]).toEqual({
      key: 'demo-ig',
      name: 'Demo Instagram',
      platform: 'instagram',
      account: 'demo.afflino',
      url: 'https://instagram.example.com/demo.afflino',
    });
    expect(properties[1]?.account).toBe('demo-web.example.com');
  });

  it('warns (does not reject) on a url outside the reserved example names', () => {
    const { properties, warnings } = networkFromYaml(
      file(ig({ url: 'https://social.operator.zz/demo.afflino' }), web()),
      'my-network.yaml',
    );
    expect(properties).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^my-network\.yaml properties\[0\] \(demo-ig\): url host 'social\.operator\.zz' is not a reserved example name/,
    );
  });

  it('knows the reserved names (RFC 2606 / RFC 6761)', () => {
    for (const h of ['example.com', 'shop.example.com', 'a.example.net', 'example.org', 'x.example', 'shop.pz-test.invalid', 'a.test', 'localhost.localhost']) {
      expect(isReservedExampleHost(h)).toBe(true);
    }
    for (const h of ['example.zz', 'notexample.com', 'example.com.zz', 'operator.zz']) {
      expect(isReservedExampleHost(h)).toBe(false);
    }
  });
});

describe('loadNetworkFile', () => {
  it('names the file when the YAML itself is broken', async () => {
    const p = path.join(tmp, 'broken.yaml');
    writeFileSync(p, 'properties:\n  - key: [unclosed\n');
    await expect(loadNetworkFile(p)).rejects.toThrow(/broken\.yaml is not valid YAML/);
  });

  it('prefixes validation errors with the file path', async () => {
    const p = path.join(tmp, 'bad-platform.yaml');
    writeFileSync(
      p,
      'properties:\n  - key: demo-x\n    name: Demo X\n    platform: myspace\n    account: demo\n    url: https://x.example.com/demo\n',
    );
    await expect(loadNetworkFile(p)).rejects.toThrow(`${p} properties[0].platform 'myspace'`);
  });
});

describe('placement keys', () => {
  it('are network-<key>-<channel>, one channel per platform, never the shop key', () => {
    expect(placementKeyFor('demo-ig', 'instagram')).toBe('network-demo-ig-instagram_bio');
    expect(placementKeyFor('demo-web', 'web')).toBe('network-demo-web-web_article');
    const channels = Object.values(PLATFORM_CHANNEL);
    expect(new Set(channels).size).toBe(NETWORK_PLATFORMS.length);
    // Channels all contain '_' and keys cannot, so no property key (even 'shop') yields the shop's key.
    for (const platform of NETWORK_PLATFORMS) expect(placementKeyFor('shop', platform)).not.toBe(SHOP_PLACEMENT_KEY);
    expect(SHOP_PLACEMENT_KEY).toBe('network-shop-web');
  });
});

describe('parseNetworkArgs', () => {
  it('reads NETWORK_FILE and WEB_HOST, and flags win over them', () => {
    const env = { NETWORK_FILE: '/etc/afflino/network.yaml', WEB_HOST: 'shop.example.com' };
    expect(parseNetworkArgs([], env)).toEqual({
      networkPath: '/etc/afflino/network.yaml',
      withDemoProgramme: false,
      webHost: 'shop.example.com',
    });
    expect(
      parseNetworkArgs(['--', '--network', '/tmp/n.yaml', '--web-host', 'other.example.com', '--with-demo-programme'], env),
    ).toEqual({ networkPath: '/tmp/n.yaml', withDemoProgramme: true, webHost: 'other.example.com' });
    expect(parseNetworkArgs(['--network=/tmp/m.yaml', '--web-host=x.example.com'], {})).toEqual({
      networkPath: '/tmp/m.yaml',
      withDemoProgramme: false,
      webHost: 'x.example.com',
    });
  });

  it('treats an empty WEB_HOST as unset and refuses unknown or incomplete flags', () => {
    expect(parseNetworkArgs([], { WEB_HOST: '' }).webHost).toBeNull();
    expect(() => parseNetworkArgs(['--sites', 'x'], {})).toThrow(/unknown argument '--sites'/);
    expect(() => parseNetworkArgs(['--network'], {})).toThrow(/--network needs a path/);
    expect(() => parseNetworkArgs(['--network='], {})).toThrow(/--network needs a path/);
    expect(() => parseNetworkArgs(['--web-host'], {})).toThrow(/--web-host needs a hostname/);
  });
});

describe('CLI guards', () => {
  const args = (over: Partial<ReturnType<typeof parseNetworkArgs>> = {}) => ({
    networkPath: '/etc/afflino/network.yaml',
    withDemoProgramme: false,
    webHost: 'shop.example.com',
    ...over,
  });

  it('refuses nothing outside NODE_ENV=production', () => {
    expect(cliRefusal(args({ networkPath: DEFAULT_NETWORK_FILE, withDemoProgramme: true }), {})).toBeNull();
    expect(cliRefusal(args({ networkPath: DEFAULT_NETWORK_FILE }), { NODE_ENV: 'development' })).toBeNull();
  });

  it('under NODE_ENV=production refuses the TEST demo programme and the TEST example network file', () => {
    const prod = { NODE_ENV: 'production' };
    expect(cliRefusal(args({ withDemoProgramme: true }), prod)).toMatch(/^REFUSING: --with-demo-programme/);
    // The default (NETWORK_FILE unset or lost) and an explicit --network to the example are both refused.
    expect(cliRefusal(parseNetworkArgs([], {}), prod)).toMatch(
      /^REFUSING: the example network file .* is TEST data .*; pass --network or NETWORK_FILE$/,
    );
    expect(cliRefusal(parseNetworkArgs(['--network', DEFAULT_NETWORK_FILE], {}), prod)).toMatch(/example network file/);
    expect(cliRefusal(args(), prod)).toBeNull();
  });

  it('says when the demo programme runs without WEB_HOST (no shop placement, no web_placement_id)', () => {
    expect(cliNotices(args({ withDemoProgramme: true, webHost: null }))).toEqual([
      "seed-network: no WEB_HOST: no shop placement, so no web_placement_id (set WEB_HOST or --web-host to the shop's public hostname to get one)",
    ]);
    expect(cliNotices(args({ withDemoProgramme: true }))).toEqual([]);
    expect(cliNotices(args({ webHost: null }))).toEqual([]);
  });

  it('prints a few warnings in full and summarises a long run of them', () => {
    const few = ['a', 'b'];
    expect(warningLines(few)).toEqual(['seed-network: warning: a', 'seed-network: warning: b']);
    const many = Array.from({ length: 404 }, (_, i) => `w${i}`);
    expect(warningLines(many)).toEqual([
      'seed-network: warning: w0',
      'seed-network: warning: w1',
      'seed-network: warning: w2',
      'seed-network: warning: … and 401 more like these (404 in all; expected for a network file of real accounts)',
    ]);
    expect(warningLines(many.slice(0, 5))).toHaveLength(5);
  });
});
