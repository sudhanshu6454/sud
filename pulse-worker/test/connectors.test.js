import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.PULSE_DATA_DIR = fs.mkdtempSync('/tmp/pulse-test-');
process.env.YT_API_KEY = 'k'; process.env.META_SYSTEM_USER_TOKEN = 't'; process.env.SERPAPI_KEY = 's';
const { mockFetch, film } = await import('./helpers.js');
const youtube = await import('../connectors/youtube.js');
const wikimedia = await import('../connectors/wikimedia.js');
const rss = await import('../connectors/trends-rss.js');
const trends = await import('../connectors/trends.js');
const gsc = await import('../connectors/gsc.js');
const hashtags = await import('../connectors/meta-hashtags.js');
const network = await import('../connectors/meta-network.js');

test('youtube → trTotal, likeRatio, song', async () => {
  const f = mockFetch([
    { match: 'id=TRAILER1', body: { items: [{ id: 'TRAILER1', snippet: { title: 'Haiwaan | Official Trailer', publishedAt: '2026-08-20T08:30:00Z', channelId: 'C1' }, statistics: { viewCount: '96400000', likeCount: '3952000' } }] } },
    { match: 'id=SONG1,SONG2', body: { items: [{ id: 'SONG1', snippet: {}, statistics: { viewCount: '140300000', likeCount: '1' } }, { id: 'SONG2', snippet: {}, statistics: { viewCount: '9000000', likeCount: '1' } }] } },
  ]);
  const out = await youtube.run('12', film, { fetchImpl: f, comments: false });
  assert.equal(out.signals.trTotal, 96.4);
  assert.equal(out.signals.likeRatio, 41);
  assert.equal(out.signals.song, 140.3);
  assert.equal(out.signals.tr24, undefined); // trailer published before tracking began → not observable
  assert.equal(out.meta.trTotal.source, 'YouTube Data API');
});
test('youtube comments → like-weighted sentiment with aspects, spam dropped, comments-disabled video tolerated', async () => {
  const mk = (text, likes) => ({ id: 'c' + Math.random(), snippet: { totalReplyCount: 0, topLevelComment: { snippet: { textOriginal: text, likeCount: String(likes), publishedAt: '2026-09-01T00:00:00Z' } } } });
  const relevance = { items: [
    ...Array.from({ length: 20 }, () => mk('Akshay is back! action peak 🔥 FDFS pakka', 300)),
    ...Array.from({ length: 10 }, () => mk('BGM goosebumps, theatre me dekhenge', 50)),
    ...Array.from({ length: 6 }, () => mk('VFX cheap lag raha, story south copy, OTT pe dekhenge', 900)),
    ...Array.from({ length: 5 }, () => mk("who's watching in 2026?", 2000)),
  ] };
  const time = { items: Array.from({ length: 10 }, () => mk('release kab hai?', 0)) };
  const f = mockFetch([
    { match: 'commentThreads?part=snippet&videoId=TRAILER1&order=relevance', body: relevance },
    { match: 'commentThreads?part=snippet&videoId=TRAILER1&order=time', body: time },
    { match: 'videoId=SONG1', body: { error: { code: 403, message: 'commentsDisabled' } }, status: 403 },
    { match: 'videoId=SONG2', body: { items: [] } },
    { match: 'id=TRAILER1', body: { items: [{ id: 'TRAILER1', snippet: { publishedAt: '2026-08-20T08:30:00Z' }, statistics: { viewCount: '96400000', likeCount: '3952000' } }] } },
    { match: 'id=SONG1,SONG2', body: { items: [] } },
  ]);
  const out = await youtube.run('12', film, { fetchImpl: f });
  assert.ok(out.signals.sentiment >= 55 && out.signals.sentiment <= 80, `got ${out.signals.sentiment}`);
  const r = out.meta.sentiment.raw;
  assert.equal(r.spam, 5);
  assert.equal(r.pos, 30); assert.equal(r.neg, 6); assert.equal(r.n, 51);
  assert.ok(r.love.map(x => x.label).includes('Lead star'));
  assert.ok(r.love.map(x => x.label).includes('Will watch in theatre'));
  assert.ok(r.worry.map(x => x.label).includes('VFX / scale'));
  assert.ok(r.worry.map(x => x.label).includes('Will wait for OTT'));
  assert.match(out.meta.sentiment.source, /YouTube comments · 1 video/);
  assert.ok(out.samples && out.samples[0].src === 'comments', 'comment intent sample emitted');
  assert.equal(out.samples[0].def, 30);   // 20 'FDFS pakka' + 10 'theatre me dekhenge' state definite intent
  assert.equal(out.samples[0].ott, 6);    // 'OTT pe dekhenge' complaints
});
test('wikimedia → wiki (7-day mean, en+hi, thousand)', async () => {
  const days = v => ({ items: Array.from({ length: 7 }, () => ({ views: v })) });
  const f = mockFetch([{ match: 'en.wikipedia', body: days(60_000) }, { match: 'hi.wikipedia', body: days(4_100) }]);
  const out = await wikimedia.run('12', { ...film, wiki_title_hi: 'हैवान_(फ़िल्म)' }, { fetchImpl: f });
  assert.equal(out.signals.wiki, 64.1);
  assert.equal(out.meta.wiki.raw.days, 7);
});
test('wikimedia missing article → no signal, no throw', async () => {
  const f = mockFetch([{ match: 'en.wikipedia', body: { type: 'not_found' }, status: 404 }]);
  const out = await wikimedia.run('12', film, { fetchImpl: f });
  assert.equal(out.signals.wiki, 0);
});
test('trends rss → trending event when film or cast trends', async () => {
  const xml = fs.readFileSync(new URL('./fixtures/trending-in.xml', import.meta.url), 'utf8');
  const items = rss.parseRSS(xml);
  assert.equal(items.length, 3);
  assert.equal(items[0].traffic, '200+');
  const out = await rss.run('12', film, { items });
  assert.equal(out.trending.title, 'haiwaan trailer');
  const none = await rss.run('12', { title: 'Drishyam: The Conclusion', aliases: [], cast: [] }, { items });
  assert.equal(none.trending, undefined);
});
test('trends (serpapi) → search = mean of last two points for the film column', async () => {
  const tl = [[60, 100], [70, 40], [74, 9], [81, 9]].map(([a, b], i) => ({ date: 'w' + i, values: [{ query: 'Haiwaan', extracted_value: String(a) }, { query: 'Jawan', extracted_value: String(b) }] }));
  const f = mockFetch([{ match: 'serpapi.com', body: { interest_over_time: { timeline_data: tl } } }]);
  const out = await trends.run('12', film, { fetchImpl: f });
  assert.equal(out.signals.search, 78);
  assert.match(out.meta.search.source, /vs Jawan/);
});
test('gsc aggregate → sum across properties, de-dupe within, 3-day mean, top queries', () => {
  const a = gsc.aggregate([
    [{ keys: ['haiwaan review', '2026-09-05'], impressions: 20_000 }, { keys: ['haiwaan review', '2026-09-05'], impressions: 20_000 }, { keys: ['haiwaan', '2026-09-06'], impressions: 50_000 }],
    [{ keys: ['haiwaan trailer', '2026-09-05'], impressions: 10_000 }, { keys: ['haiwaan advance booking', '2026-09-06'], impressions: 4_000 }],
  ]);
  assert.deepEqual(a.perDate, { '2026-09-05': 30_000, '2026-09-06': 54_000 });
  assert.equal(a.meanImp, 42_000);
  assert.equal(a.top[0].q, 'haiwaan');
});
test('meta hashtags → posts with coverage factor and 30-slot budget', async () => {
  process.env.HASHTAG_COVERAGE = '2.5';
  const media = n => ({ data: Array.from({ length: n }, (_, i) => ({ id: 'm' + i, timestamp: new Date().toISOString() })) });
  const f = mockFetch([
    { match: 'ig_hashtag_search?user_id=178400001&q=haiwaantrailer', body: { data: [{ id: 'H2' }] } },
    { match: 'ig_hashtag_search', body: { data: [{ id: 'H1' }] } },
    { match: '/H1/recent_media', body: media(40) }, { match: '/H2/recent_media', body: media(40) },
  ]);
  const out = await hashtags.run('12', film, { fetchImpl: f });
  assert.equal(out.signals.posts, 0.1); // 40 unique ids (same m0..m39 across both tags) × 2.5 = 100 posts/day = 0.1 thousand
  const st = { hashtagSlots: {} };
  for (let i = 0; i < 30; i++) assert.ok(hashtags.reserveSlot(st, 'acc', 'tag' + i));
  assert.ok(!hashtags.reserveSlot(st, 'acc', 'tag31'));
  assert.ok(hashtags.reserveSlot(st, 'acc', 'tag3')); // re-query of an existing slot is free
});
test('meta network → net vs 90-day max and sentiment from comments', async () => {
  const now = new Date().toISOString();
  const posts = [
    { id: 'p1', text: 'Akshay is back #Haiwaan trailer out', t: now, eng: 12_000, kind: 'ig' },
    { id: 'p2', text: 'Haiwaan booking opens today', t: now, eng: 8_000, kind: 'fb' },
    { id: 'p3', text: 'Drishyam 3 first look', t: now, eng: 50_000, kind: 'ig' },
  ];
  const f = mockFetch([{ match: '/p1/comments', body: { data: Array.from({ length: 30 }, (_, i) => ({ text: i % 4 ? 'faadu trailer 🔥' : 'bakwaas', like_count: 0 })) } }, { match: '/comments', body: { data: [] } }]);
  const out = await network.run('12', film, { assets: { ig: [], fb: [] }, posts, fetchImpl: f });
  assert.equal(out.meta.net.raw.engagement_24h, 20_000);
  assert.equal(out.signals.net, 100); // first day: this film IS the network max
  assert.equal(out.signals.sentiment, 73); // 22 positive / (22 + 8 negative), equal weights
  assert.match(out.meta.sentiment.source, /Comments on your pages/);
  // a bigger film the same day lowers this one's index
  const out2 = await network.run('13', { title: 'Drishyam: The Conclusion', aliases: ['drishyam 3'], hashtags: [] }, { assets: { ig: [], fb: [] }, posts, fetchImpl: f });
  assert.equal(out2.signals.net, 100);
  const out3 = await network.run('12', film, { assets: { ig: [], fb: [] }, posts, fetchImpl: f });
  assert.equal(out3.signals.net, 40); // 20,000 / 50,000
});
