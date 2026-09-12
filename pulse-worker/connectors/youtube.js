// YouTube Data API v3 → tr24, trTotal, likeRatio, song. 1 quota unit per videos.list (≤50 ids).
import { getJSON } from '../lib/http.js';
import { log, readLog, state, saveState } from '../lib/store.js';
import { toMillion, likeRatio, viewsAt24h } from '../lib/normalise.js';
import * as llm from '../lib/sentiment-llm.js';
import { intentSample } from '../lib/intent.js';
import { analyse as lexicon } from '../lib/sentiment.js';

export const name = 'youtube';
export const fields = ['tr24', 'trTotal', 'likeRatio', 'song', 'sentiment'];
export const enabled = () => !!process.env.YT_API_KEY;

export async function fetchVideos(ids, opts = {}) {
  if (!ids.length) return [];
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids.slice(0, 50).join(',')}&key=${process.env.YT_API_KEY}`;
  const j = await getJSON(url, { perMinute: 60, fetchImpl: opts.fetchImpl });
  return (j.items || []).map(v => ({ id: v.id, title: v.snippet?.title, publishedAt: v.snippet?.publishedAt, channelId: v.snippet?.channelId, views: +v.statistics?.viewCount || 0, likes: +v.statistics?.likeCount || 0 }));
}

// Top-level comments on a video: `relevance` surfaces the most-liked (the crowd's verdict), `time` the freshest.
// 1 quota unit per page of 100. Default 3 pages relevance + 1 page time per video.
export async function fetchComments(videoId, { pagesRelevance = 3, pagesTime = 1, fetchImpl } = {}) {
  const out = new Map();
  for (const [order, pages] of [['relevance', pagesRelevance], ['time', pagesTime]]) {
    let token = '';
    for (let i = 0; i < pages; i++) {
      const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&order=${order}&maxResults=100&textFormat=plainText${token ? `&pageToken=${token}` : ''}&key=${process.env.YT_API_KEY}`;
      let j; try { j = await getJSON(url, { perMinute: 60, fetchImpl }); } catch (e) { if (e.status === 403 || e.status === 404) return [...out.values()]; throw e; } // comments disabled → empty
      for (const it of j.items || []) { const c = it.snippet?.topLevelComment?.snippet; if (c) out.set(it.id, { text: c.textOriginal || c.textDisplay || '', likes: +c.likeCount || 0, at: c.publishedAt, replies: +it.snippet?.totalReplyCount || 0 }); }
      token = j.nextPageToken; if (!token) break;
    }
  }
  return [...out.values()];
}
export async function commentSentiment(film, opts = {}) {
  const videos = [...(film.yt_trailer_ids || []).map(id => ({ id, kind: 'trailer' })), ...(film.yt_teaser_ids || []).map(id => ({ id, kind: 'teaser' })), ...(film.yt_song_ids || []).slice(0, 2).map(id => ({ id, kind: 'song' }))];
  const per = {}; let all = [];
  for (const v of videos.slice(0, 6)) {
    const comments = await fetchComments(v.id, opts);
    if (!comments.length) continue;
    const a = await llm.analyse(comments, opts);
    per[`${v.kind}:${v.id}`] = { kind: v.kind, n: a.n, scored: a.scored, pos: a.pos, neg: a.neg, spam: a.spam, pct: a.pct, love: a.love, worry: a.worry };
    all = all.concat(comments);
  }
  if (!all.length) return null;
  const a = await llm.analyse(all, opts);
  return { ...a, videos: per, intent: intentSample(all) };
}

export async function run(film_id, film, opts = {}) {
  const out = { signals: {}, meta: {} };
  const at = new Date().toISOString();
  const trailers = await fetchVideos(film.yt_trailer_ids || [], opts);
  if (trailers.length) {
    const t = trailers[0]; // the official trailer is first in config
    log(name, film_id, 'trailer_views', t.views, { videoId: t.id, publishedAt: t.publishedAt });
    out.signals.trTotal = toMillion(t.views);
    out.signals.likeRatio = likeRatio(t.likes, t.views);
    out.meta.trTotal = { source: 'YouTube Data API', at, raw: { videoId: t.id, viewCount: t.views } };
    out.meta.likeRatio = { source: 'YouTube Data API', at, raw: { likeCount: t.likes, viewCount: t.views } };
    // tr24: observable only if we logged around publishedAt + 24 h; freeze once computed.
    const st = state();
    if (st.tr24[t.id] != null) { out.signals.tr24 = st.tr24[t.id]; out.meta.tr24 = { source: 'YouTube Data API', at, frozen: true, raw: { videoId: t.id } }; }
    else {
      const rows = readLog(r => r.connector === name && r.field === 'trailer_views' && r.raw?.videoId === t.id);
      const v = viewsAt24h(t.publishedAt, rows);
      if (v != null && Date.now() > new Date(t.publishedAt).getTime() + 864e5) { st.tr24[t.id] = toMillion(v); saveState(st); out.signals.tr24 = st.tr24[t.id]; out.meta.tr24 = { source: 'YouTube Data API', at, frozen: true, raw: { videoId: t.id, interpolatedViews: Math.round(v) } }; }
    }
  }
  // Comments on the trailer, teasers and songs → sentiment (weighted by likes; spam dropped; aspects for the desk)
  if (opts.comments !== false) {
    const cs = await commentSentiment(film, opts);
    if (cs && cs.pct != null && cs.scored >= 30) {
      out.signals.sentiment = cs.pct;
      out.meta.sentiment = { source: 'YouTube comments · ' + Object.keys(cs.videos).length + ' video' + (Object.keys(cs.videos).length === 1 ? '' : 's'), at, raw: { n: cs.n, scored: cs.scored, pos: cs.pos, neg: cs.neg, spam: cs.spam, pct_unweighted: cs.pct_unweighted, love: cs.love, worry: cs.worry, videos: cs.videos, model: cs.model } };
      log(name, film_id, 'sentiment', cs.pct, out.meta.sentiment.raw);
    }
    if (cs && cs.intent && cs.intent.n >= 30) { out.samples = [{ src: 'comments', t: new Date().toISOString(), n: cs.intent.n, def: cs.intent.def, prob: cs.intent.prob, ott: cs.intent.ott, no: cs.intent.no, note: 'YouTube comments · ' + cs.n + ' read, ' + cs.intent.expressed_share + '% stated an intent' }]; out.meta.intent = { source: 'YouTube comments', at, raw: cs.intent }; log(name, film_id, 'intent_definite_share', cs.intent.definite_share, cs.intent); }
  }
  const songs = await fetchVideos(film.yt_song_ids || [], opts);
  if (songs.length) {
    const top = songs.reduce((a, b) => (b.views > a.views ? b : a));
    log(name, film_id, 'song_views', top.views, { videoId: top.id });
    out.signals.song = toMillion(top.views);
    out.meta.song = { source: 'YouTube Data API', at, raw: { videoId: top.id, viewCount: top.views } };
  }
  return out;
}
