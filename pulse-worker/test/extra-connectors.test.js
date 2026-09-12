import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.PULSE_DATA_DIR = fs.mkdtempSync('/tmp/pulse-test2-');
process.env.SPOTIFY_CLIENT_ID = 'a'; process.env.SPOTIFY_CLIENT_SECRET = 'b'; process.env.REDDIT_CLIENT_ID = 'c'; process.env.REDDIT_CLIENT_SECRET = 'd';
const { mockFetch, film } = await import('./helpers.js');
const spotify = await import('../connectors/spotify.js');
const reddit = await import('../connectors/reddit.js');

test('spotify → popularity of the most popular configured track', async () => {
  const f = mockFetch([
    { match: 'accounts.spotify.com/api/token', body: { access_token: 'T', expires_in: 3600 } },
    { match: 'api.spotify.com/v1/tracks', body: { tracks: [{ id: 's1', name: 'Title Track', popularity: 71 }, { id: 's2', name: 'Sad Song', popularity: 44 }] } },
  ]);
  const out = await spotify.run('12', { ...film, spotify_track_ids: ['s1', 's2'] }, { fetchImpl: f });
  assert.equal(out.signals.spot, 71);
  assert.equal(out.meta.spot.raw.track, 'Title Track');
});
test('reddit → threads + comments per day, sentiment from busiest threads', async () => {
  const now = Date.now() / 1000;
  const posts = [
    { data: { id: 'p1', permalink: '/r/bollywood/comments/p1/x/', created_utc: now - 3600, num_comments: 140 } },
    { data: { id: 'p2', permalink: '/r/bollywood/comments/p2/y/', created_utc: now - 7200, num_comments: 60 } },
    { data: { id: 'p3', permalink: '/r/bollywood/comments/p3/z/', created_utc: now - 5 * 86400, num_comments: 999 } }, // too old
  ];
  const thread = [{}, { data: { children: Array.from({ length: 40 }, (_, i) => ({ data: { body: i % 5 ? 'Trailer is mast, FDFS booked' : 'bakwaas, wait for OTT', score: i } })) } }];
  const f = mockFetch([
    { match: 'reddit.com/api/v1/access_token', body: { access_token: 'R', expires_in: 3600 } },
    { match: '/search?', body: { data: { children: posts } } },
    { match: '/comments/', body: thread },
  ]);
  const out = await reddit.run('12', film, { fetchImpl: f });
  assert.equal(out.signals.reddit, 2 + 200);
  assert.equal(out.meta.reddit.raw.threads, 2);
  assert.ok(out.signals.sentiment > 60 && out.signals.sentiment < 95, `got ${out.signals.sentiment}`);
  assert.match(out.meta.sentiment.source, /Reddit comments/);
});
