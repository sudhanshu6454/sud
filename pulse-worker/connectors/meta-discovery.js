// Instagram Business Discovery → official: how hard the official machine is pushing this film,
// and how hard the audience is pushing back.
//
// The registry lists 80 Instagram accounts that matter to Indian and world cinema — studios
// (YRF, Dharma, Mythri, Sun Pictures, Hombale, Aashirvad), labels (T-Series, Aditya Music,
// Think Music), platforms (Netflix India, Prime Video, JioHotstar) and the trade and celebrity
// pages. Business Discovery is the sanctioned way to read them: you query a *public professional
// account* from an account you own, and Meta returns followers, media count and the recent media
// with like and comment counts. No scraping, no login sharing, no comment texts.
//
// The signal is engagement on that account's posts ABOUT THIS FILM, indexed against the same
// accounts' own trailing baseline — so a T-Series post does not automatically outrank a Wayfarer
// post, and a film is only "hot on the official channels" relative to what those channels
// normally do.
import fs from 'node:fs';
import { getJSON } from '../lib/http.js';
import { log, state, saveState } from '../lib/store.js';
import { textMatchesFilm } from '../lib/match.js';
import { idx100 } from '../lib/normalise.js';

export const name = 'meta-discovery';
export const fields = ['official'];
export const enabled = () => !!process.env.META_SYSTEM_USER_TOKEN && fs.existsSync('config/sources.json');
const G = 'https://graph.facebook.com/v21.0';
const tok = () => process.env.META_SYSTEM_USER_TOKEN;

/** Read one public professional account through an owned IG user id. */
export async function discover(selfIgId, username, opts = {}) {
  const f = 'business_discovery.username(' + username + '){followers_count,media_count,media.limit(25){caption,like_count,comments_count,timestamp,permalink}}';
  const j = await getJSON(`${G}/${selfIgId}?fields=${encodeURIComponent(f)}&access_token=${tok()}`, { perMinute: 150, fetchImpl: opts.fetchImpl });
  const bd = j.business_discovery;
  if (!bd) return null;
  return {
    username,
    followers: +bd.followers_count || 0,
    media_count: +bd.media_count || 0,
    media: (bd.media?.data || []).map(m => ({
      text: m.caption || '', t: m.timestamp,
      eng: (+m.like_count || 0) + (+m.comments_count || 0), permalink: m.permalink,
    })),
  };
}

/** Which registry accounts to read for a film: its industry plus the always-on globals. */
export function accountsFor(film, sources) {
  const want = (film.industries || [film.industry || 'Hindi']).map(s => String(s).toLowerCase());
  return (sources.instagram || []).filter(a => {
    if (a.enabled === false) return false;
    if (!a.industries || !a.industries.length) return true;
    return a.industries.some(i => want.includes(String(i).toLowerCase()));
  });
}

/** Index this film's official-account engagement against the same accounts' trailing maximum. */
export function scoreFilm(film, accounts, st) {
  const day = new Date().toISOString().slice(0, 10);
  const cutoff = Date.now() - 3 * 864e5;
  const hits = [];
  let E = 0;
  for (const a of accounts) {
    for (const m of a.media || []) {
      if (new Date(m.t).getTime() < cutoff) continue;
      if (!textMatchesFilm(m.text, film)) continue;
      E += m.eng;
      hits.push({ account: a.username, eng: m.eng, t: m.t, permalink: m.permalink });
    }
  }
  st.officialDaily ||= {};
  (st.officialDaily[day] ||= {})[film.title] = E;
  let max = 0; const keep = {};
  for (const [d, films] of Object.entries(st.officialDaily)) {
    if (Date.now() - new Date(d).getTime() > 90 * 864e5) continue;
    keep[d] = films;
    for (const v of Object.values(films)) max = Math.max(max, v);
  }
  st.officialDaily = keep;
  hits.sort((a, b) => b.eng - a.eng);
  return { E, max, official: idx100(E, max), hits, accounts: accounts.length,
           baseline_days: Object.keys(keep).length };
}

export async function run(film_id, film, opts = {}) {
  const sources = opts.sources || JSON.parse(fs.readFileSync('config/sources.json', 'utf8'));
  const selfIg = opts.selfIgId || process.env.IG_SELF_USER_ID || (sources.self_ig_user_id || '');
  if (!selfIg) throw new Error('meta-discovery needs IG_SELF_USER_ID (any owned IG professional account id from config/assets.json)');
  const list = accountsFor(film, sources);
  if (!list.length) return { signals: {}, meta: {} };
  const read = [];
  for (const a of list) {
    try { const r = opts.discoverImpl ? await opts.discoverImpl(selfIg, a.username, opts) : await discover(selfIg, a.username, opts); if (r) read.push(r); }
    catch (e) { console.warn(`[meta-discovery] @${a.username}: ${e.message}`); }
  }
  if (!read.length) return { signals: {}, meta: {} };
  const st = state(); const sc = scoreFilm(film, read, st); saveState(st);
  const raw = { engagement_72h: sc.E, accounts_read: read.length, network_90d_max: sc.max,
                baseline_days: sc.baseline_days, top: sc.hits.slice(0, 6),
                followers_reached: read.reduce((a, r) => a + r.followers, 0) };
  log(name, film_id, 'official', sc.official, raw);
  return { signals: { official: sc.official },
           meta: { official: { source: 'Instagram Business Discovery · ' + read.length + ' official accounts', at: new Date().toISOString(), raw } } };
}
