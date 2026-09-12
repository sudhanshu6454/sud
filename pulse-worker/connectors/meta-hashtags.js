// Instagram Graph API Hashtag Search → posts (thousand posts/day). 30 unique hashtags per IG account per rolling 7 days.
import { getJSON } from '../lib/http.js';
import { log, state, saveState } from '../lib/store.js';
import { toThousand } from '../lib/normalise.js';

export const name = 'meta-hashtags';
export const fields = ['posts'];
export const enabled = () => !!process.env.META_SYSTEM_USER_TOKEN;
const G = 'https://graph.facebook.com/v21.0';
const tok = () => process.env.META_SYSTEM_USER_TOKEN;

// Slot accounting: refuse a 31st unique hashtag on an account within 7 days.
export function reserveSlot(st, account, hashtag) {
  const now = Date.now(); st.hashtagSlots[account] = (st.hashtagSlots[account] || []).filter(s => now - s.at < 7 * 864e5);
  const slots = st.hashtagSlots[account];
  const existing = slots.find(s => s.h === hashtag); if (existing) return true;
  if (slots.length >= 30) return false;
  slots.push({ h: hashtag, at: now }); return true;
}
export async function hashtagId(account, q, opts) {
  const j = await getJSON(`${G}/ig_hashtag_search?user_id=${account}&q=${encodeURIComponent(q)}&access_token=${tok()}`, { perMinute: 150, fetchImpl: opts.fetchImpl });
  return j.data?.[0]?.id;
}
export async function recentMedia(account, hid, opts) {
  const ids = new Set(); let url = `${G}/${hid}/recent_media?user_id=${account}&fields=id,timestamp&limit=50&access_token=${tok()}`;
  const since = Date.now() - 864e5;
  for (let page = 0; url && page < 10; page++) {
    const j = await getJSON(url, { perMinute: 150, fetchImpl: opts.fetchImpl });
    for (const m of j.data || []) if (new Date(m.timestamp).getTime() >= since) ids.add(m.id);
    url = j.paging?.next; if ((j.data || []).some(m => new Date(m.timestamp).getTime() < since)) break;
  }
  return ids;
}
export async function run(film_id, film, opts = {}) {
  const account = film.hashtag_account; if (!account || !(film.hashtags || []).length) return { signals: {}, meta: {} };
  const st = state(); const ids = new Set(); const skipped = [];
  for (const h of film.hashtags.slice(0, 5)) {
    if (!reserveSlot(st, account, h)) { skipped.push(h); continue; }
    const hid = (st.hashtagIds ||= {})[h] || (st.hashtagIds[h] = await hashtagId(account, h, opts));
    if (!hid) continue;
    for (const id of await recentMedia(account, hid, opts)) ids.add(id);
  }
  saveState(st);
  const coverage = +process.env.HASHTAG_COVERAGE || 2.5;
  const perDay = ids.size * coverage;
  log(name, film_id, 'posts_per_day', perDay, { sampled: ids.size, coverage, skipped });
  if (skipped.length) console.warn(`[meta-hashtags] ${film.title}: hashtag budget exhausted on ${account}, skipped ${skipped.join(', ')}`);
  return { signals: { posts: toThousand(perDay) }, meta: { posts: { source: 'Meta Graph · hashtag search', at: new Date().toISOString(), raw: { sampled: ids.size, coverage } } } };
}
