// Raw API numbers → the exact units pulse-model.js expects. Keep every conversion here and unit-tested.
export const toMillion = n => Math.round((n / 1e6) * 100) / 100;          // views → million, 2 dp
export const toThousand = n => Math.round((n / 1e3) * 10) / 10;           // count → thousand, 1 dp
export const likeRatio = (likes, views) => (views > 0 ? Math.round((likes / views) * 1000) : 0); // per 1,000 views
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const pct = (k, n) => (n > 0 ? Math.round((k / n) * 100) : 0);
export const idx100 = (v, max) => (max > 0 ? Math.round(clamp((v / max) * 100, 0, 100)) : 0);
// Interpolate the view count at publishedAt + 24 h from two log rows bracketing it.
export function viewsAt24h(publishedAt, rows) {
  const target = new Date(publishedAt).getTime() + 864e5;
  const pts = rows.map(r => ({ t: new Date(r.at).getTime(), v: r.value })).sort((a, b) => a.t - b.t);
  const before = [...pts].reverse().find(p => p.t <= target), after = pts.find(p => p.t >= target);
  if (before && after && after.t !== before.t) return before.v + ((after.v - before.v) * (target - before.t)) / (after.t - before.t);
  if (before && after) return before.v;
  return null; // not observable
}
