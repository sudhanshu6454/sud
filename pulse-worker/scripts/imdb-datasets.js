#!/usr/bin/env node
// IMDb non-commercial datasets → rating and vote velocity for every tracked film.
//
// IMDb publishes title.ratings.tsv.gz and title.basics.tsv.gz to datasets.imdbws.com, refreshed
// daily. Rating is the post-release word-of-mouth signal Pulse already uses; *votes per day* is
// the better one, because it measures how many people cared enough to rate, and it moves days
// before any trade figure does.
//
// LICENCE — read this before running it in production. The datasets are licensed for personal
// and NON-COMMERCIAL use only. Screenstat is a commercial site, so this script is provided for
// model calibration on your own machine, not for publishing IMDb numbers on screenstat.in.
// For commercial use, licence the data from IMDb (via AWS Data Exchange) first. The script
// refuses to run unless you acknowledge that with IMDB_DATASETS_ACK=non-commercial.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline';
import { loadEnv } from '../lib/env.js';

loadEnv();
const BASE = 'https://datasets.imdbws.com';
const DIR = 'data/imdb';

if (process.env.IMDB_DATASETS_ACK !== 'non-commercial') {
  console.error('Refusing to run: IMDb datasets are licensed for personal and non-commercial use only.');
  console.error('Set IMDB_DATASETS_ACK=non-commercial to use them for local calibration, or licence the data from IMDb for production.');
  process.exit(2);
}

async function fetchGz(file) {
  fs.mkdirSync(DIR, { recursive: true });
  const out = path.join(DIR, file.replace(/\.gz$/, ''));
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  await pipeline(res.body, zlib.createGunzip(), fs.createWriteStream(out));
  console.log(`${file} → ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
  return out;
}

/** Stream a TSV, keeping only rows whose first column is in `ids` (or matching `keep`). */
async function scan(file, keep) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let head = null; const out = [];
  for await (const line of rl) {
    const c = line.split('\t');
    if (!head) { head = c; continue; }
    const row = Object.fromEntries(head.map((h, i) => [h, c[i]]));
    if (keep(row)) out.push(row);
  }
  return out;
}

const films = fs.existsSync('config/films.json') ? JSON.parse(fs.readFileSync('config/films.json', 'utf8')) : {};
const wanted = new Map();                                   // tconst → film id
for (const [id, f] of Object.entries(films)) if (f.imdb_id) wanted.set(f.imdb_id, id);
const titles = new Set(Object.values(films).map(f => (f.title || '').toLowerCase()));

const basics = await fetchGz('title.basics.tsv.gz');
const ratings = await fetchGz('title.ratings.tsv.gz');

// Resolve ids for films configured by title only
const found = await scan(basics, r => r.titleType === 'movie' &&
  (wanted.has(r.tconst) || titles.has((r.primaryTitle || '').toLowerCase()) || titles.has((r.originalTitle || '').toLowerCase())));
for (const r of found) {
  if (wanted.has(r.tconst)) continue;
  const id = Object.entries(films).find(([, f]) => (f.title || '').toLowerCase() === (r.primaryTitle || '').toLowerCase()
    || (f.title || '').toLowerCase() === (r.originalTitle || '').toLowerCase());
  if (id) wanted.set(r.tconst, id[0]);
}

const rate = await scan(ratings, r => wanted.has(r.tconst));
const snapPath = path.join(DIR, 'ratings-history.json');
const hist = fs.existsSync(snapPath) ? JSON.parse(fs.readFileSync(snapPath, 'utf8')) : {};
const today = new Date().toISOString().slice(0, 10);
const out = {};
for (const r of rate) {
  const film = wanted.get(r.tconst);
  const votes = +r.numVotes || 0, avg = +r.averageRating || 0;
  (hist[film] ||= {})[today] = { votes, avg, tconst: r.tconst };
  const days = Object.keys(hist[film]).sort();
  const prev = days[days.indexOf(today) - 1];
  const perDay = prev ? Math.round((votes - hist[film][prev].votes) / Math.max(1, (new Date(today) - new Date(prev)) / 864e5)) : null;
  out[film] = { tconst: r.tconst, imdbRating: avg, votes, votes_per_day: perDay, since: prev || null };
}
fs.writeFileSync(snapPath, JSON.stringify(hist, null, 1));
fs.writeFileSync(path.join(DIR, 'today.json'), JSON.stringify(out, null, 1));
console.log(`\nMatched ${Object.keys(out).length} of ${Object.keys(films).length} configured films.`);
for (const [id, v] of Object.entries(out)) {
  console.log(`  film ${id} · ${v.tconst} · ${v.imdbRating} from ${v.votes.toLocaleString('en-IN')} votes` +
    (v.votes_per_day != null ? ` · ${v.votes_per_day.toLocaleString('en-IN')} new votes/day since ${v.since}` : ' · first snapshot'));
}
console.log(`\nWrote ${path.join(DIR, 'today.json')}. Paste imdbRating into Pulse → Live run; votes/day is the faster word-of-mouth read.`);
