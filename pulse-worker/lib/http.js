// fetch with retry, exponential backoff and a per-host token bucket.
// Honour 429 / Retry-After; never retry 4xx other than 429.
const buckets = new Map();
function take(host, perMinute) {
  const now = Date.now();
  const b = buckets.get(host) || { tokens: perMinute, t: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.t) / 60000) * perMinute);
  b.t = now;
  if (b.tokens < 1) { buckets.set(host, b); return (1 - b.tokens) * (60000 / perMinute); }
  b.tokens -= 1; buckets.set(host, b); return 0;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function getJSON(url, { headers = {}, retries = 3, perMinute = 120, method = 'GET', body, fetchImpl } = {}) {
  const f = fetchImpl || globalThis.fetch;
  const host = new URL(url).host;
  let attempt = 0;
  for (;;) {
    const wait = take(host, perMinute); if (wait) await sleep(wait);
    const res = await f(url, { method, headers: { 'User-Agent': process.env.USER_AGENT || 'ScreenstatPulse/1.0', Accept: 'application/json', ...headers }, body });
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : res.text();
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) {
      const txt = await res.text().catch(() => '');
      throw Object.assign(new Error(`HTTP ${res.status} ${url} ${txt.slice(0, 300)}`), { status: res.status });
    }
    const ra = Number(res.headers.get('retry-after'));
    await sleep(ra ? ra * 1000 : 800 * 2 ** attempt + Math.random() * 400);
    attempt++;
  }
}
