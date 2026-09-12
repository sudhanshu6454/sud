// Google Trends interest → `search` (0–100 vs benchmark). Driver: SerpApi when SERPAPI_KEY is set; otherwise disabled
// (the editor pastes the Trends CSV into Pulse, or the official Trends API driver is added here once access is granted).
import { getJSON } from '../lib/http.js';
import { log } from '../lib/store.js';
import { mean } from '../lib/normalise.js';

export const name = 'trends';
export const fields = ['search'];
export const enabled = () => !!process.env.SERPAPI_KEY;

export function latestFromTimeline(timeline, filmIdx = 0) {
  // SerpApi interest_over_time.timeline_data: [{date, values:[{query, extracted_value}]}]
  const rows = (timeline || []).map(r => (r.values || []).map(v => +v.extracted_value || 0));
  const last = rows.slice(-2).map(r => r[filmIdx] ?? 0);
  return Math.round(mean(last));
}
export async function run(film_id, film, opts = {}) {
  if (!film.trends_benchmark) return { signals: {}, meta: {} };
  const q = `${film.title},${film.trends_benchmark}`;
  const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(q)}&geo=IN&date=today%203-m&data_type=TIMESERIES&api_key=${process.env.SERPAPI_KEY}`;
  const j = await getJSON(url, { perMinute: 10, fetchImpl: opts.fetchImpl });
  const val = latestFromTimeline(j.interest_over_time?.timeline_data, 0);
  log(name, film_id, 'search', val, { benchmark: film.trends_benchmark, points: (j.interest_over_time?.timeline_data || []).length });
  return { signals: { search: val }, meta: { search: { source: `Google Trends (SerpApi) · vs ${film.trends_benchmark}`, at: new Date().toISOString() } } };
}
