// Reddit API (OAuth client-credentials, "script" app) → reddit: threads + comments per day mentioning the film across Indian-cinema subreddits,
// plus comment texts for the shared sentiment pipeline. Urban/English-skewed audience — a multiplex signal, weighted lightly.
import { getJSON } from '../lib/http.js';
import { log } from '../lib/store.js';
import { filmTerms } from '../lib/match.js';
import * as llm from '../lib/sentiment-llm.js';
import { intentSample } from '../lib/intent.js';

export const name = 'reddit';
export const fields = ['reddit', 'sentiment'];
export const enabled = () => !!process.env.REDDIT_CLIENT_ID && !!process.env.REDDIT_CLIENT_SECRET;
const SUBS = (process.env.REDDIT_SUBS || 'bollywood+BollyBlindsNGossip+IndianCinema+boxoffice').trim();
let tok = { v: null, exp: 0 };
export async function token(fetchImpl) {
  if (tok.v && Date.now() < tok.exp - 30e3) return tok.v;
  const f = fetchImpl || globalThis.fetch;
  const res = await f('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': process.env.USER_AGENT || 'ScreenstatPulse/1.0', Authorization: 'Basic ' + Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64') }, body: 'grant_type=client_credentials' });
  if (!res.ok) throw new Error(`Reddit token HTTP ${res.status}`);
  const j = await res.json(); tok = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 }; return tok.v;
}
export function countRecent(posts, sinceMs) {
  const recent = posts.filter(p => (p.created_utc || 0) * 1000 >= sinceMs);
  return { threads: recent.length, comments: recent.reduce((a, p) => a + (+p.num_comments || 0), 0), recent };
}
export async function run(film_id, film, opts = {}) {
  const t = await token(opts.fetchImpl);
  const H = { Authorization: `Bearer ${t}` };
  const q = filmTerms(film).slice(0, 3).map(x => `"${x.replace(/^#/, '')}"`).join(' OR ');
  const j = await getJSON(`https://oauth.reddit.com/r/${SUBS}/search?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new&t=week&limit=100`, { headers: H, perMinute: 50, fetchImpl: opts.fetchImpl });
  const posts = (j.data?.children || []).map(c => c.data);
  const c = countRecent(posts, Date.now() - 864e5);
  const perDay = c.threads + c.comments;
  log(name, film_id, 'reddit_per_day', perDay, { threads: c.threads, comments: c.comments, subs: SUBS });
  const out = { signals: { reddit: perDay }, meta: { reddit: { source: 'Reddit API', at: new Date().toISOString(), raw: { threads: c.threads, comments: c.comments, subs: SUBS } } } };
  // comments on the two busiest recent threads → sentiment (shared classifier); capped to stay inside rate limits
  const busy = [...c.recent].sort((a, b) => (b.num_comments || 0) - (a.num_comments || 0)).slice(0, 2);
  const texts = [];
  for (const p of busy) { try { const th = await getJSON(`https://oauth.reddit.com${p.permalink}?limit=100&depth=1`, { headers: H, perMinute: 50, fetchImpl: opts.fetchImpl }); for (const ch of th[1]?.data?.children || []) if (ch.data?.body) texts.push({ text: ch.data.body, likes: Math.max(0, +ch.data.score || 0) }); } catch {} }
  const it = intentSample(texts); if (it.n >= 30) { out.samples = [{ src: 'comments', t: new Date().toISOString(), n: it.n, def: it.def, prob: it.prob, ott: it.ott, no: it.no, note: 'Reddit comments' }]; out.meta.intent = { source: 'Reddit comments', at: new Date().toISOString(), raw: it }; }
  if (texts.length >= 20) { const s = await llm.analyse(texts, opts); if (s.pct != null) { out.signals.sentiment = s.pct; out.meta.sentiment = { source: 'Reddit comments · ' + busy.length + ' threads', at: new Date().toISOString(), raw: { n: s.n, scored: s.scored, pos: s.pos, neg: s.neg, spam: s.spam, love: s.love, worry: s.worry, model: s.model } }; } }
  return out;
}
