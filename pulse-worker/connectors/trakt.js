// Trakt → antic: how many people have put the film on a list before it opens.
//
// Trakt publishes an "anticipated" chart built from watchlist adds — the closest thing to a
// public, global, pre-release intent count. It skews Western and online, so it is worth three
// points out of a hundred, not thirty: for a Hollywood release in India it is a real leading
// indicator, for a Malayalam release it is close to noise, and Pulse weights it accordingly.
//
// Free: register a client id at trakt.tv/oauth/applications. Rate limit 1,000 calls / 5 min.
import { getJSON } from '../lib/http.js';
import { log } from '../lib/store.js';

export const name = 'trakt';
export const fields = ['antic'];
export const enabled = () => !!process.env.TRAKT_CLIENT_ID;

const API = 'https://api.trakt.tv';
const H = () => ({ 'trakt-api-version': '2', 'trakt-api-key': process.env.TRAKT_CLIENT_ID, 'Content-Type': 'application/json' });

/** Page through the anticipated chart and find this film; returns list_count (people). */
export async function anticipated(pages = 4, opts = {}) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    const j = await getJSON(`${API}/movies/anticipated?page=${p}&limit=100&extended=full`, { headers: H(), perMinute: 100, fetchImpl: opts.fetchImpl });
    if (!Array.isArray(j) || !j.length) break;
    out.push(...j);
    if (j.length < 100) break;
  }
  return out;
}

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function run(film_id, film, opts = {}) {
  const list = opts.anticipatedCache || await anticipated(opts.pages || 4, opts);
  const want = [film.title, ...(film.aliases || [])].map(norm);
  const year = +(film.release_date || '').slice(0, 4) || 0;
  const hit = list.find(x => {
    const m = x.movie || x;
    if (!want.includes(norm(m.title))) return false;
    return !year || !m.year || Math.abs(m.year - year) <= 1;
  });
  if (!hit) return { signals: {}, meta: {} };
  const m = hit.movie || hit;
  const people = +hit.list_count || 0;         // watchlist adds
  const rank = list.indexOf(hit) + 1;
  if (!people) return { signals: {}, meta: {} };
  const k = Math.round(people / 100) / 10;     // Pulse wants thousands
  log(name, film_id, 'antic', k, { people, rank, trakt_id: (m.ids || {}).trakt, slug: (m.ids || {}).slug });
  return {
    signals: { antic: k },
    meta: { antic: { source: 'Trakt API · anticipated (watchlist adds)', at: new Date().toISOString(),
      raw: { people, thousand: k, rank_in_anticipated: rank, listed_of: list.length,
             trakt_id: (m.ids || {}).trakt, imdb: (m.ids || {}).imdb,
             note: 'Trakt users skew Western and online; add Letterboxd watchlist and Rotten Tomatoes “want to see” from the clipper for a fuller count.' } } }
  };
}
