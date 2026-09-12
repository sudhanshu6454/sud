// TMDB → tmdb: the daily popularity score, on one scale for every industry.
//
// Why it is worth a slot: TMDB scores Hindi, Telugu, Tamil, Kannada, Malayalam and Hollywood
// titles with the same algorithm, updates every day, is free, and is the only public number that
// lets you say "this Malayalam film is as hot as that Hindi one" without inventing a conversion.
// The score is not an audience count — it is TMDB's own traffic-weighted index — so Pulse
// normalises it on a log scale like every other reach signal.
//
// Commercial use of TMDB data needs a commercial licence from TMDB; the free key covers
// non-commercial use only. Attribution is required wherever the number is shown.
import { getJSON } from '../lib/http.js';
import { log } from '../lib/store.js';

export const name = 'tmdb';
export const fields = ['tmdb'];
export const enabled = () => !!process.env.TMDB_API_KEY;

const API = 'https://api.themoviedb.org/3';
const auth = () => (process.env.TMDB_API_KEY || '').startsWith('eyJ')
  ? { headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` }, q: '' }   // v4 read token
  : { headers: {}, q: `api_key=${encodeURIComponent(process.env.TMDB_API_KEY || '')}` };

/** Resolve a film to a TMDB id: configured id wins, then an exact title+year search. */
export async function resolve(film, opts = {}) {
  if (film.tmdb_id) return { id: +film.tmdb_id, matched: 'configured' };
  const a = auth();
  const year = (film.release_date || '').slice(0, 4);
  const url = `${API}/search/movie?query=${encodeURIComponent(film.title)}${year ? `&year=${year}` : ''}&include_adult=false${a.q ? '&' + a.q : ''}`;
  const j = await getJSON(url, { headers: a.headers, perMinute: 40, fetchImpl: opts.fetchImpl });
  const res = j.results || [];
  if (!res.length) return null;
  const want = film.title.toLowerCase();
  const exact = res.find(r => (r.title || '').toLowerCase() === want || (r.original_title || '').toLowerCase() === want);
  const hit = exact || res[0];
  return { id: hit.id, matched: exact ? 'title+year' : 'first result', title: hit.title, release_date: hit.release_date };
}

export async function run(film_id, film, opts = {}) {
  const r = await resolve(film, opts);
  if (!r) return { signals: {}, meta: {} };
  const a = auth();
  const d = await getJSON(`${API}/movie/${r.id}?append_to_response=watch/providers${a.q ? '&' + a.q : ''}`,
    { headers: a.headers, perMinute: 40, fetchImpl: opts.fetchImpl });
  const pop = Math.round((+d.popularity || 0) * 10) / 10;
  if (!pop) return { signals: {}, meta: {} };
  // OTT availability in India, when TMDB (JustWatch-powered) knows it — context, not a signal.
  const wp = ((d['watch/providers'] || {}).results || {}).IN || {};
  const ott = [...(wp.flatrate || []), ...(wp.rent || [])].map(p => p.provider_name).slice(0, 6);
  log(name, film_id, 'tmdb', pop, { id: r.id, matched: r.matched, vote_average: d.vote_average, vote_count: d.vote_count, ott });
  return {
    signals: { tmdb: pop },
    meta: { tmdb: { source: 'TMDB API · daily popularity', at: new Date().toISOString(),
      raw: { id: r.id, matched: r.matched, title: d.title, release_date: d.release_date,
             popularity: pop, vote_average: d.vote_average, vote_count: d.vote_count,
             runtime: d.runtime, ott_in: ott, attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.' } } }
  };
}
