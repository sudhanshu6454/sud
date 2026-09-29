/**
 * Meta export → Afflino network file.
 *
 * Reads the owner's Meta channel exports (one CSV per platform, the
 * "meta-channels-28d-<platform>-<date>.csv" files: columns Channel, Handle,
 * Platform, Channel URL, then the 28-day metrics, which are ignored) and
 * writes the network file `db/seed-network.ts` reads, on stdout. The output
 * is REAL account data: it belongs on the server as /etc/afflino/network.yaml,
 * never in this repository.
 *
 *   tsx db/meta-network.ts <directory or .csv files...> > network.yaml
 *
 * A directory means every *.csv in it, in name order. Rows become properties:
 *   facebook   account = the page's numeric ID from Channel URL (stable, and
 *              present even when the page has no handle), else its vanity name;
 *              key fb-<account>; url https://www.facebook.com/<account>
 *   instagram  account = the handle (Channel URL, else Handle); key
 *              ig-<handle with . and _ as ->; url https://www.instagram.com/<handle>/
 *   other      skipped with a note on stderr (add them to the file by hand)
 * Names are "<Channel> (Facebook)" / "<Channel> (Instagram)"; a channel name
 * that repeats on one platform gets its handle (or page ID) too, because the
 * seed needs unique names. An account listed twice (for example in two
 * exports) is kept once. The result is checked with the seed's own
 * `networkFromYaml` before anything is written, so a file this prints always
 * seeds.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { networkFromYaml, type NetworkPlatform } from './seed-network.ts';

export const META_USAGE = 'usage: tsx db/meta-network.ts <directory or .csv files...> > network.yaml';

const REQUIRED_COLUMNS = ['Channel', 'Handle', 'Platform', 'Channel URL'] as const;
const LABEL: Readonly<Record<'facebook' | 'instagram', string>> = { facebook: 'Facebook', instagram: 'Instagram' };
const NAME_MAX = 80;
const KEY_MAX = 40;

/** RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes, CRLF or LF, a leading BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (quoted) throw new Error('meta-network: a quoted CSV field is never closed');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export interface MetaInput {
  /** File name, used in messages and the output's header. */
  name: string;
  text: string;
}

export interface MetaProperty {
  key: string;
  name: string;
  platform: NetworkPlatform;
  account: string;
  url: string;
}

export interface MetaNetwork {
  properties: MetaProperty[];
  counts: Record<string, number>;
  /** Rows left out, one line each (unsupported platform, no usable account). */
  skipped: string[];
  /** Accounts listed more than once; the first is kept. */
  duplicates: number;
  yaml: string;
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function fitKey(prefix: string, raw: string, taken: Set<string>): string {
  const base = `${prefix}-${slug(raw)}`.slice(0, KEY_MAX).replace(/-+$/, '');
  let key = base;
  for (let n = 2; taken.has(key); n++) {
    const tail = `-${n}`;
    key = `${base.slice(0, KEY_MAX - tail.length).replace(/-+$/, '')}${tail}`;
  }
  taken.add(key);
  return key;
}

function fitName(channel: string, suffix: string): string {
  const full = `${channel} ${suffix}`;
  if (full.length <= NAME_MAX) return full;
  return `${channel.slice(0, NAME_MAX - suffix.length - 2).trimEnd()}… ${suffix}`;
}

interface Row {
  channel: string;
  handle: string;
  platform: string;
  url: string;
  at: string;
}

function rowsOf(input: MetaInput): Row[] {
  const table = parseCsv(input.text);
  if (table.length === 0) return [];
  const header = table[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  for (const name of REQUIRED_COLUMNS) {
    if (col(name) < 0) {
      throw new Error(`meta-network: ${input.name} has no '${name}' column (needs ${REQUIRED_COLUMNS.join(', ')})`);
    }
  }
  return table.slice(1).map((cells, i) => ({
    channel: tidy(cells[col('Channel')] ?? ''),
    handle: tidy(cells[col('Handle')] ?? ''),
    platform: tidy(cells[col('Platform')] ?? '').toLowerCase(),
    url: tidy(cells[col('Channel URL')] ?? ''),
    at: `${input.name}:${i + 2}`,
  }));
}

function accountOf(row: Row): { account: string; url: string } | null {
  if (row.platform === 'facebook') {
    const m = /^https?:\/\/(?:www\.|m\.|web\.)?facebook\.com\/(?:profile\.php\?id=)?([A-Za-z0-9.]+)\/?(?:[?#].*)?$/i.exec(row.url);
    const account = (m?.[1] ?? row.handle.replace(/^@/, '')).toLowerCase();
    if (!/^[a-z0-9.]+$/.test(account)) return null;
    return { account, url: `https://www.facebook.com/${account}` };
  }
  if (row.platform === 'instagram') {
    const m = /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(?:[?#].*)?$/i.exec(row.url);
    const account = (m?.[1] ?? row.handle.replace(/^@/, '')).toLowerCase();
    if (!/^[a-z0-9._]+$/.test(account)) return null;
    return { account, url: `https://www.instagram.com/${account}/` };
  }
  return null;
}

/** Convert the exports; throws when the result would not seed. `now` only stamps the header. */
export function metaToNetwork(inputs: MetaInput[], now: Date = new Date()): MetaNetwork {
  const rows = inputs.flatMap(rowsOf);
  const skipped: string[] = [];
  let duplicates = 0;
  const seenAccounts = new Set<string>();
  const kept: Array<Row & { account: string; url: string }> = [];
  for (const row of rows) {
    if (row.platform !== 'facebook' && row.platform !== 'instagram') {
      skipped.push(`${row.at}: platform '${row.platform || '(empty)'}' is not converted (add it to the network file by hand)`);
      continue;
    }
    const got = accountOf(row);
    if (!got) {
      skipped.push(`${row.at}: no usable ${row.platform} account in Channel URL '${row.url}' or Handle '${row.handle}'`);
      continue;
    }
    const id = `${row.platform}/${got.account}`;
    if (seenAccounts.has(id)) {
      duplicates++;
      continue;
    }
    seenAccounts.add(id);
    kept.push({ ...row, ...got });
  }

  const repeats = new Map<string, number>();
  for (const r of kept) {
    const k = `${r.platform}/${(r.channel || r.handle || r.account).toLowerCase()}`;
    repeats.set(k, (repeats.get(k) ?? 0) + 1);
  }
  const keys = new Set<string>();
  const names = new Set<string>();
  const properties: MetaProperty[] = kept.map((r) => {
    const platform = r.platform as 'facebook' | 'instagram';
    const channel = r.channel || r.handle || r.account;
    const repeated = (repeats.get(`${platform}/${channel.toLowerCase()}`) ?? 0) > 1;
    let name = fitName(channel, repeated ? `(${LABEL[platform]}, ${r.handle || r.account})` : `(${LABEL[platform]})`);
    if (names.has(name.toLowerCase())) name = fitName(channel, `(${LABEL[platform]}, ${r.account})`);
    names.add(name.toLowerCase());
    const key = fitKey(platform === 'facebook' ? 'fb' : 'ig', r.account, keys);
    return { key, name, platform, account: r.account, url: r.url };
  });

  // The seed's own rules; throws on anything it would reject.
  networkFromYaml({ properties }, 'converted Meta export');

  const counts: Record<string, number> = {};
  for (const p of properties) counts[p.platform] = (counts[p.platform] ?? 0) + 1;
  const q = (s: string) => JSON.stringify(s);
  const lines = [
    '# Afflino in-house publisher network: REAL accounts, not TEST data.',
    `# Written by db/meta-network.ts on ${now.toISOString()} from ${inputs.map((i) => i.name).join(', ')}:`,
    `# ${Object.entries(counts).map(([p, n]) => `${n} ${p}`).join(', ')} (${properties.length} properties).`,
    '# Keep it on the server at /etc/afflino/network.yaml. It is not in the repository.',
    'properties:',
    ...properties.map(
      (p) => `  - {key: ${p.key}, name: ${q(p.name)}, platform: ${p.platform}, account: ${q(p.account)}, url: ${q(p.url)}}`,
    ),
  ];
  return { properties, counts, skipped, duplicates, yaml: `${lines.join('\n')}\n` };
}

/** Directories become their *.csv files (name order); files are taken as given. */
export async function expandInputs(args: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const a of args) {
    if ((await stat(a)).isDirectory()) {
      const found = (await readdir(a)).filter((f) => /\.csv$/i.test(f)).sort();
      out.push(...found.map((f) => path.join(a, f)));
    } else {
      out.push(a);
    }
  }
  return out;
}

const isMainEntry =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  main().catch((err) => {
    console.error('meta-network failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    console.error(META_USAGE);
    process.exit(2);
  }
  const files = await expandInputs(args);
  if (files.length === 0) throw new Error(`no .csv files in ${args.join(', ')}`);
  const inputs = await Promise.all(files.map(async (f) => ({ name: path.basename(f), text: await readFile(f, 'utf8') })));
  const result = metaToNetwork(inputs);
  if (result.properties.length === 0) throw new Error('the exports hold no Facebook or Instagram account');
  process.stdout.write(result.yaml);
  const byPlatform = Object.entries(result.counts).map(([p, n]) => `${p} ${n}`).join(', ');
  console.error(
    `meta-network: ${result.properties.length} properties (${byPlatform}) from ${inputs.length} file(s): ` +
      `${inputs.map((i) => i.name).join(', ')}; ${result.duplicates} repeated account(s) kept once; ` +
      `${result.skipped.length} row(s) skipped`,
  );
  const shown = result.skipped.length > 5 ? result.skipped.slice(0, 3) : result.skipped;
  for (const s of shown) console.error(`meta-network: skipped ${s}`);
  if (shown.length < result.skipped.length) console.error(`meta-network: … and ${result.skipped.length - shown.length} more skipped`);
}
