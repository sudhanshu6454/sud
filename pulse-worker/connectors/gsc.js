// Google Search Console → gsc (thousand impressions/day for film queries across owned properties, 3-day mean, data lags ~2 days).
import { getJSON } from '../lib/http.js';
import { googleAccessToken } from '../lib/google-auth.js';
import { log } from '../lib/store.js';
import { filmTerms } from '../lib/match.js';

export const name = 'gsc';
export const fields = ['gsc'];
export const enabled = () => !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !!process.env.GSC_PROPERTIES;
const iso = d => d.toISOString().slice(0, 10);

export function aggregate(rowsByProperty) {
  // rows: [{keys:[query,date], impressions, clicks}] — de-duplicate query+date within a property, sum across properties per date.
  const perDate = {}; const queries = {};
  for (const rows of rowsByProperty) {
    const seen = new Set();
    for (const r of rows) {
      const [q, d] = r.keys; const k = q + '|' + d; if (seen.has(k)) continue; seen.add(k);
      perDate[d] = (perDate[d] || 0) + (r.impressions || 0);
      queries[q] = (queries[q] || 0) + (r.impressions || 0);
    }
  }
  const dates = Object.keys(perDate).sort();
  const meanImp = dates.length ? dates.reduce((a, d) => a + perDate[d], 0) / dates.length : 0;
  const top = Object.entries(queries).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([q, i]) => ({ q, impressions: i }));
  return { perDate, meanImp, top, dates };
}
export async function run(film_id, film, opts = {}) {
  const token = await googleAccessToken('https://www.googleapis.com/auth/webmasters.readonly', opts);
  const props = process.env.GSC_PROPERTIES.split(',').map(s => s.trim()).filter(Boolean);
  const end = new Date(Date.now() - 2 * 864e5), start = new Date(Date.now() - 4 * 864e5);
  const terms = filmTerms(film).map(t => t.replace(/^#/, '')).slice(0, 6);
  const rowsByProperty = [];
  for (const p of props) {
    const rows = [];
    for (const term of terms) {
      const body = { startDate: iso(start), endDate: iso(end), dimensions: ['query', 'date'], dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'contains', expression: term }] }], rowLimit: 5000 };
      const j = await getJSON(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(p)}/searchAnalytics/query`, { method: 'POST', body: JSON.stringify(body), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, perMinute: 200, fetchImpl: opts.fetchImpl });
      rows.push(...(j.rows || []));
    }
    rowsByProperty.push(rows);
  }
  const a = aggregate(rowsByProperty);
  log(name, film_id, 'gsc_impressions_per_day', a.meanImp, { dates: a.dates, top: a.top, properties: props.length });
  return { signals: { gsc: Math.round(a.meanImp / 100) / 10 }, meta: { gsc: { source: 'Search Console API', at: new Date().toISOString(), raw: { data_through: iso(end), properties: props.length, top_queries: a.top.slice(0, 5) } } } };
}
