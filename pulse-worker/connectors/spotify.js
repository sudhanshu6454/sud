// Spotify Web API (client-credentials) → spot: popularity (0–100) of the film's most popular configured track.
import { getJSON } from '../lib/http.js';
import { log } from '../lib/store.js';

export const name = 'spotify';
export const fields = ['spot'];
export const enabled = () => !!process.env.SPOTIFY_CLIENT_ID && !!process.env.SPOTIFY_CLIENT_SECRET;
let tok = { v: null, exp: 0 };
export async function token(fetchImpl) {
  if (tok.v && Date.now() < tok.exp - 30e3) return tok.v;
  const f = fetchImpl || globalThis.fetch;
  const res = await f('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64') }, body: 'grant_type=client_credentials' });
  if (!res.ok) throw new Error(`Spotify token HTTP ${res.status}`);
  const j = await res.json(); tok = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 }; return tok.v;
}
export async function run(film_id, film, opts = {}) {
  const ids = (film.spotify_track_ids || []).slice(0, 10); if (!ids.length) return { signals: {}, meta: {} };
  const t = await token(opts.fetchImpl);
  const j = await getJSON(`https://api.spotify.com/v1/tracks?ids=${ids.join(',')}`, { headers: { Authorization: `Bearer ${t}` }, perMinute: 60, fetchImpl: opts.fetchImpl });
  const tracks = (j.tracks || []).filter(Boolean).map(x => ({ id: x.id, name: x.name, popularity: +x.popularity || 0 }));
  if (!tracks.length) return { signals: {}, meta: {} };
  const top = tracks.reduce((a, b) => (b.popularity > a.popularity ? b : a));
  log(name, film_id, 'spot', top.popularity, { tracks });
  return { signals: { spot: top.popularity }, meta: { spot: { source: 'Spotify Web API', at: new Date().toISOString(), raw: { track: top.name, popularity: top.popularity, tracks: tracks.length } } } };
}
