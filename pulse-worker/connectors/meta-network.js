// Screenstat network engagement across owned IG accounts + FB Pages → net (0–100 vs 90-day network max) and sentiment (%).
import fs from 'node:fs';
import { getJSON } from '../lib/http.js';
import { log, state, saveState } from '../lib/store.js';
import { textMatchesFilm } from '../lib/match.js';
import * as llm from '../lib/sentiment-llm.js';
import { intentSample } from '../lib/intent.js';
import { idx100 } from '../lib/normalise.js';

export const name = 'meta-network';
export const fields = ['net', 'sentiment'];
export const enabled = () => !!process.env.META_SYSTEM_USER_TOKEN && fs.existsSync('config/assets.json');
const G = 'https://graph.facebook.com/v21.0';
const tok = () => process.env.META_SYSTEM_USER_TOKEN;
const since = () => Math.floor((Date.now() - 3 * 864e5) / 1000);

async function igPosts(ig, opts) {
  const j = await getJSON(`${G}/${ig.ig_user_id}/media?fields=id,caption,timestamp,like_count,comments_count,permalink&since=${since()}&limit=50&access_token=${tok()}`, { perMinute: 150, fetchImpl: opts.fetchImpl });
  return (j.data || []).map(m => ({ id: m.id, text: m.caption || '', t: m.timestamp, eng: (m.like_count || 0) + (m.comments_count || 0), kind: 'ig' }));
}
async function fbPosts(pg, opts) {
  const j = await getJSON(`${G}/${pg.page_id}/posts?fields=id,message,created_time,shares,reactions.summary(total_count),comments.summary(total_count)&since=${since()}&limit=50&access_token=${tok()}`, { perMinute: 150, fetchImpl: opts.fetchImpl });
  return (j.data || []).map(p => ({ id: p.id, text: p.message || '', t: p.created_time, eng: (p.reactions?.summary?.total_count || 0) + (p.comments?.summary?.total_count || 0) + (p.shares?.count || 0), kind: 'fb' }));
}
async function comments(post, opts) {
  const field = post.kind === 'ig' ? 'text' : 'message';
  const j = await getJSON(`${G}/${post.id}/comments?fields=${field},like_count&limit=100&access_token=${tok()}`, { perMinute: 150, fetchImpl: opts.fetchImpl });
  return (j.data || []).map(c => ({ text: c[field] || '', likes: +c.like_count || 0 }));
}
// Compute for ALL films at once (one network pull), then hand each film its slice.
export async function pullNetwork(assets, opts = {}) {
  const posts = [];
  for (const ig of assets.ig || []) try { posts.push(...await igPosts(ig, opts)); } catch (e) { console.warn(`[meta-network] IG ${ig.username}: ${e.message}`); }
  for (const pg of assets.fb || []) try { posts.push(...await fbPosts(pg, opts)); } catch (e) { console.warn(`[meta-network] FB ${pg.name}: ${e.message}`); }
  return posts;
}
export function scoreFilm(film, posts, st) {
  const day = new Date().toISOString().slice(0, 10);
  const cutoff = Date.now() - 864e5;
  const mine = posts.filter(p => new Date(p.t).getTime() >= cutoff && textMatchesFilm(p.text, film));
  const E = mine.reduce((a, p) => a + p.eng, 0);
  (st.networkDaily[day] ||= {})[film.title] = E;
  // trailing 90-day max across all films
  let max = 0; const keep = {};
  for (const [d, films] of Object.entries(st.networkDaily)) { if (Date.now() - new Date(d).getTime() > 90 * 864e5) continue; keep[d] = films; for (const v of Object.values(films)) max = Math.max(max, v); }
  st.networkDaily = keep;
  return { E, max, net: idx100(E, max), posts: mine };
}
export async function run(film_id, film, opts = {}) {
  const assets = opts.assets || JSON.parse(fs.readFileSync('config/assets.json', 'utf8'));
  const posts = opts.posts || await pullNetwork(assets, opts);
  const st = state(); const sc = scoreFilm(film, posts, st); saveState(st);
  const out = { signals: { net: sc.net }, meta: { net: { source: 'Meta Graph · owned pages', at: new Date().toISOString(), raw: { engagement_24h: sc.E, network_90d_max: sc.max, tagged_posts: sc.posts.length, baseline_days: Object.keys(st.networkDaily).length } } } };
  log(name, film_id, 'net', sc.net, out.meta.net.raw);
  // sentiment from comments on the film's tagged posts (cap 500)
  const texts = [];
  for (const p of sc.posts.slice(0, 20)) { if (texts.length >= 500) break; try { texts.push(...await comments(p, opts)); } catch {} }
  if (texts.length >= 20) {
    const it = intentSample(texts); if (it.n >= 30) { out.samples = [{ src: 'comments', t: new Date().toISOString(), n: it.n, def: it.def, prob: it.prob, ott: it.ott, no: it.no, note: 'Comments on your pages · ' + texts.length + ' read' }]; out.meta.intent = { source: 'Comments on your pages', at: new Date().toISOString(), raw: it }; }
    const s = await llm.analyse(texts, opts);
    if (s.pct != null) { out.signals.sentiment = s.pct; out.meta.sentiment = { source: 'Comments on your pages · ' + sc.posts.length + ' posts', at: new Date().toISOString(), raw: { n: s.n, scored: s.scored, pos: s.pos, neg: s.neg, spam: s.spam, love: s.love, worry: s.worry, model: s.model } }; log(name, film_id, 'sentiment', s.pct, out.meta.sentiment.raw); }
  }
  return out;
}
