// Google Trends "Trending now" RSS (India) → `trending` events per film. Public, no key. Poll every 30 min.
import { getJSON } from '../lib/http.js';
import { log } from '../lib/store.js';
import { trendingMatchesFilm } from '../lib/match.js';

export const name = 'trends-rss';
export const fields = [];
export const enabled = () => true;

export function parseRSS(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const g = tag => (b.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`)) || [])[1]?.trim() || '';
    items.push({ title: g('title'), traffic: g('ht:approx_traffic'), pubDate: g('pubDate'), news: g('ht:news_item_title') });
  }
  return items;
}
export async function fetchTrending(geo = 'IN', opts = {}) {
  const xml = await getJSON(`https://trends.google.com/trending/rss?geo=${geo}`, { perMinute: 4, headers: { Accept: 'application/rss+xml, text/xml' }, fetchImpl: opts.fetchImpl });
  return parseRSS(xml);
}
export async function run(film_id, film, opts = {}) {
  const items = opts.items || await fetchTrending('IN', opts);
  const hit = items.find(i => trendingMatchesFilm(i.title, film));
  if (!hit) return { signals: {}, meta: {} };
  log(name, film_id, 'trending', hit.traffic, hit);
  return { signals: {}, meta: {}, trending: { title: hit.title, traffic: hit.traffic, at: new Date().toISOString(), source: 'Google Trends · Trending now (IN)' } };
}
