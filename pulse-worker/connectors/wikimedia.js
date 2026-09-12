// Wikimedia Pageviews API → wiki (thousand views/day, 7-day mean, en + hi articles). Public, no key, User-Agent required.
import { getJSON } from '../lib/http.js';
import { log } from '../lib/store.js';
import { mean } from '../lib/normalise.js';

export const name = 'wikimedia';
export const fields = ['wiki'];
export const enabled = () => true;
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

async function daily(project, title, opts) {
  const end = new Date(Date.now() - 864e5), start = new Date(Date.now() - 8 * 864e5); // last 7 complete days
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${project}/all-access/user/${encodeURIComponent(title)}/daily/${ymd(start)}/${ymd(end)}`;
  try { const j = await getJSON(url, { perMinute: 100, fetchImpl: opts.fetchImpl }); return (j.items || []).map(i => i.views); }
  catch (e) { if (e.status === 404) return []; throw e; }
}
export async function run(film_id, film, opts = {}) {
  if (!film.wiki_title) return { signals: {}, meta: {} };
  const en = await daily('en.wikipedia', film.wiki_title, opts);
  const hi = film.wiki_title_hi ? await daily('hi.wikipedia', film.wiki_title_hi, opts) : [];
  const perDay = mean(en) + mean(hi);
  log(name, film_id, 'wiki_views_per_day', perDay, { en, hi });
  return { signals: { wiki: Math.round(perDay / 100) / 10 }, meta: { wiki: { source: 'Wikimedia Pageviews API', at: new Date().toISOString(), raw: { title: film.wiki_title, days: en.length, mean_en: Math.round(mean(en)), mean_hi: Math.round(mean(hi)) } } } };
}
