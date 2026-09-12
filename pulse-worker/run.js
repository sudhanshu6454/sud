#!/usr/bin/env node
// Screenstat Pulse worker — node run.js [--film 12|all] [--connector youtube,wikimedia,...] [--dry-run]
import fs from 'node:fs';
import { loadEnv } from './lib/env.js';
import { ingest } from './lib/wp.js';
import { writePayload } from './lib/store.js';
import * as youtube from './connectors/youtube.js';
import * as wikimedia from './connectors/wikimedia.js';
import * as trendsRss from './connectors/trends-rss.js';
import * as trends from './connectors/trends.js';
import * as gsc from './connectors/gsc.js';
import * as metaHashtags from './connectors/meta-hashtags.js';
import * as metaNetwork from './connectors/meta-network.js';
import * as spotify from './connectors/spotify.js';
import * as reddit from './connectors/reddit.js';
import * as tmdb from './connectors/tmdb.js';
import * as trakt from './connectors/trakt.js';
import * as metaDiscovery from './connectors/meta-discovery.js';
import * as kobis from './connectors/kobis.js';
import { merge as mergeSentiment } from './lib/sentiment.js';
loadEnv();

const CONNECTORS = { youtube, wikimedia, 'trends-rss': trendsRss, trends, gsc, 'meta-hashtags': metaHashtags, 'meta-network': metaNetwork, 'meta-discovery': metaDiscovery, spotify, reddit, tmdb, trakt, kobis };
const args = {};
{ const av = process.argv.slice(2); for (let i = 0; i < av.length; i++) { const m = av[i].match(/^--([^=]+)(?:=(.*))?$/); if (!m) continue; if (m[2] !== undefined) args[m[1]] = m[2]; else if (av[i + 1] && !av[i + 1].startsWith('--')) args[m[1]] = av[++i]; else args[m[1]] = true; } }
const dry = !!args['dry-run'];
const only = args.connector ? String(args.connector).split(',') : Object.keys(CONNECTORS);

if (!fs.existsSync('config/films.json')) { console.error('config/films.json missing — copy films.example.json and fill it in'); process.exit(1); }
const films = JSON.parse(fs.readFileSync('config/films.json', 'utf8'));
const ids = args.film && args.film !== 'all' && args.film !== true ? [String(args.film)] : Object.keys(films);

// One network pull shared by every film (meta-network is expensive).
let shared = {};
if (only.includes('meta-network') && metaNetwork.enabled()) {
  try { const assets = JSON.parse(fs.readFileSync('config/assets.json', 'utf8')); shared.posts = await metaNetwork.pullNetwork(assets); shared.assets = assets; }
  catch (e) { console.warn(`[meta-network] network pull failed: ${e.message}`); }
}
let trendingItems = null;
if (only.includes('trends-rss')) { try { trendingItems = await trendsRss.fetchTrending('IN'); } catch (e) { console.warn(`[trends-rss] ${e.message}`); } }
// The Trakt anticipated chart is one list for every film — fetch it once, not once per film.
if (only.includes('trakt') && trakt.enabled()) {
  try { shared.anticipatedCache = await trakt.anticipated(4); } catch (e) { console.warn(`[trakt] ${e.message}`); }
}
// Business Discovery reads the same official accounts for every film in an industry — read once.
if (only.includes('meta-discovery') && metaDiscovery.enabled()) {
  try { shared.sources = JSON.parse(fs.readFileSync('config/sources.json', 'utf8')); }
  catch (e) { console.warn(`[meta-discovery] config/sources.json: ${e.message}`); }
}

let failures = 0;
for (const id of ids) {
  const film = films[id];
  const payload = { source: 'pulse-worker/1.0', fetched_at: new Date().toISOString(), film: film.title, signals: {}, meta: {} };
  for (const key of only) {
    const c = CONNECTORS[key]; if (!c) { console.warn(`unknown connector ${key}`); continue; }
    if (!c.enabled()) { continue; }
    try {
      const opts = key === 'meta-network' || key === 'meta-discovery' ? shared
        : key === 'trakt' ? { anticipatedCache: shared.anticipatedCache }
        : key === 'trends-rss' && trendingItems ? { items: trendingItems } : {};
      const out = await c.run(id, film, opts);
      if (out.meta?.sentiment) { (payload._sent ||= {})[key] = { ...out.meta.sentiment.raw, source: out.meta.sentiment.source }; delete out.signals.sentiment; delete out.meta.sentiment; }
      if (out.samples) { (payload._samples ||= []).push(...out.samples); }
      if (out.meta?.intent) { (payload._intent ||= {})[key] = out.meta.intent.raw; delete out.meta.intent; }
      Object.assign(payload.signals, out.signals); Object.assign(payload.meta, out.meta);
      if (out.trending) payload.trending = out.trending;
    } catch (e) { failures++; console.error(`[${key}] ${film.title}: ${e.message}`); }
  }
  if (payload._samples) {
    // one pooled 'comments' sample per run: every stated intent across YouTube, your pages and Reddit is one vote
    const agg = payload._samples.reduce((a, x) => ({ n: a.n + x.n, def: a.def + x.def, prob: a.prob + x.prob, ott: a.ott + x.ott, no: a.no + x.no }), { n: 0, def: 0, prob: 0, ott: 0, no: 0 });
    payload.samples = [{ src: 'comments', t: new Date().toISOString(), ...agg, note: payload._samples.map(x => x.note).join(' + ') }];
    payload.meta.intent = { source: 'Comment intent · ' + Object.keys(payload._intent || {}).join(' + '), at: new Date().toISOString(), raw: { pooled: agg, by: payload._intent, model: 'intent-hinglish-v1' } };
    delete payload._samples; delete payload._intent;
  }
  if (payload._sent) {
    const m = mergeSentiment(payload._sent);
    if (m.pct != null) { payload.signals.sentiment = m.pct; payload.meta.sentiment = { source: Object.values(payload._sent).map(x => x.source).join(' + '), at: new Date().toISOString(), raw: { n: m.n, pct: m.pct, love: m.love, worry: m.worry, by: m.by, model: m.model } }; }
    delete payload._sent;
  }
  const has = Object.keys(payload.signals).length || payload.trending;
  if (!has) { console.log(`${film.title}: nothing fetched (enable connectors in .env / config)`); continue; }
  if (dry) { const p = writePayload(id, payload); console.log(`${film.title}: dry run → ${p}\n  ${JSON.stringify(payload.signals)}${payload.trending ? '\n  trending: ' + payload.trending.title + ' ' + payload.trending.traffic : ''}`); }
  else { try { const r = await ingest(id, payload); console.log(`${film.title}: ${r.mode === 'wp' ? 'posted to WordPress' : 'written to ' + r.path} · ${JSON.stringify(payload.signals)}`); } catch (e) { failures++; console.error(`[ingest] ${film.title}: ${e.message}`); } }
}
const enabled = Object.entries(CONNECTORS).filter(([k, c]) => only.includes(k) && c.enabled()).map(([k]) => k);
console.log(`\nconnectors enabled: ${enabled.join(', ') || 'none'} · failures: ${failures}`);
process.exit(failures ? 2 : 0);
