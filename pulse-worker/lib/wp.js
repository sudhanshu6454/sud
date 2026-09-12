// Post a payload to the WordPress plugin (Application Password auth). Falls back to a file when WP_URL is blank.
import { writePayload } from './store.js';
export async function ingest(film_id, payload, { fetchImpl } = {}) {
  const base = (process.env.WP_URL || '').replace(/\/$/, '');
  if (!base) return { mode: 'file', path: writePayload(film_id, payload) };
  const auth = 'Basic ' + Buffer.from(`${process.env.WP_USER}:${process.env.WP_APP_PASSWORD}`).toString('base64');
  const f = fetchImpl || globalThis.fetch;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await f(`${base}/wp-json/sspulse/v1/films/${film_id}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(payload) });
    if (res.ok) return { mode: 'wp', film: await res.json() };
    if (res.status === 422) throw new Error(`WordPress rejected payload: ${await res.text()}`); // validation — do not retry
    if (attempt === 2) throw new Error(`WordPress ingest failed: HTTP ${res.status}`);
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
  }
}
