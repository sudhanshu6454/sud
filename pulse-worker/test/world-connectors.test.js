import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.PULSE_DATA_DIR = fs.mkdtempSync('/tmp/pulse-test3-');
process.env.TMDB_API_KEY = 'k'; process.env.TRAKT_CLIENT_ID = 't';
process.env.META_SYSTEM_USER_TOKEN = 'm'; process.env.KOBIS_KEY = 'q';
const { mockFetch, film } = await import('./helpers.js');
const tmdb = await import('../connectors/tmdb.js');
const trakt = await import('../connectors/trakt.js');
const disc = await import('../connectors/meta-discovery.js');
const kobis = await import('../connectors/kobis.js');

test('tmdb → popularity, resolved by title + year, with India watch providers', async () => {
  const f = mockFetch([
    { match: '/search/movie', body: { results: [
      { id: 99, title: 'Haiwaan Returns', release_date: '2026-01-01' },
      { id: 555, title: 'Haiwaan', original_title: 'हैवान', release_date: '2026-09-11' }] } },
    { match: '/movie/555', body: { id: 555, title: 'Haiwaan', release_date: '2026-09-11', popularity: 412.37,
      vote_average: 7.1, vote_count: 320, runtime: 151,
      'watch/providers': { results: { IN: { flatrate: [{ provider_name: 'Netflix' }], rent: [{ provider_name: 'Prime Video' }] } } } } },
  ]);
  const out = await tmdb.run('12', { ...film, release_date: '2026-09-11' }, { fetchImpl: f });
  assert.equal(out.signals.tmdb, 412.4);
  assert.equal(out.meta.tmdb.raw.id, 555);
  assert.equal(out.meta.tmdb.raw.matched, 'title+year');   // exact title beat the first result
  assert.deepEqual(out.meta.tmdb.raw.ott_in, ['Netflix', 'Prime Video']);
  assert.match(out.meta.tmdb.raw.attribution, /not endorsed or certified by TMDB/);
});

test('tmdb → a configured id skips the search call entirely', async () => {
  const f = mockFetch([{ match: '/movie/777', body: { id: 777, title: 'Haiwaan', popularity: 12 } }]);
  const out = await tmdb.run('12', { ...film, tmdb_id: 777 }, { fetchImpl: f });
  assert.equal(out.meta.tmdb.raw.matched, 'configured');
  assert.ok(!f.calls.some(c => c.url.includes('/search/')));
});

test('trakt → watchlist adds become antic in thousands, year-tolerant match', async () => {
  const list = [
    { list_count: 41200, movie: { title: 'Some Other Film', year: 2026, ids: { trakt: 1 } } },
    { list_count: 18640, movie: { title: 'Haiwaan', year: 2027, ids: { trakt: 42, slug: 'haiwaan-2026', imdb: 'tt9' } } },
  ];
  const out = await trakt.run('12', { ...film, release_date: '2026-09-11' }, { anticipatedCache: list });
  assert.equal(out.signals.antic, 18.6);           // 18,640 people → 18.6 thousand
  assert.equal(out.meta.antic.raw.rank_in_anticipated, 2);
  assert.equal(out.meta.antic.raw.trakt_id, 42);
});

test('trakt → a film that is not on the chart emits nothing rather than a zero', async () => {
  const out = await trakt.run('12', film, { anticipatedCache: [{ list_count: 10, movie: { title: 'Nope', year: 2026, ids: {} } }] });
  assert.deepEqual(out.signals, {});
});

test('meta-discovery → official is indexed against the accounts’ own trailing maximum', async () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 9 * 864e5).toISOString();
  const discoverImpl = async (self, username) => ({
    username, followers: username === 'yrf' ? 4_000_000 : 900_000, media_count: 100,
    media: username === 'yrf'
      ? [{ text: 'Haiwaan trailer out now', t: now, eng: 120_000, permalink: 'p1' },
         { text: 'Something else', t: now, eng: 50_000, permalink: 'p2' },
         { text: 'Haiwaan first look', t: old, eng: 999_999, permalink: 'p3' }]   // outside the 72 h window
      : [{ text: 'haiwaan movie booking open', t: now, eng: 30_000, permalink: 'p4' }],
  });
  const sources = { instagram: [
    { username: 'yrf', industries: ['Hindi'] },
    { username: 'mythriofficial', industries: ['Telugu'] },
    { username: 'bookmyshowin', industries: ['Hindi', 'Telugu'] },
    { username: 'off', industries: ['Hindi'], enabled: false },
  ] };
  const picked = disc.accountsFor({ industries: ['Hindi'] }, sources).map(a => a.username);
  assert.deepEqual(picked, ['yrf', 'bookmyshowin']);      // Telugu-only and disabled excluded

  const out = await disc.run('12', { ...film, industries: ['Hindi'] }, { sources, selfIgId: '17841000', discoverImpl });
  assert.equal(out.meta.official.raw.engagement_72h, 150_000);   // 120k + 30k, the 9-day-old post ignored
  assert.equal(out.signals.official, 100);                        // first reading sets the baseline
  assert.equal(out.meta.official.raw.accounts_read, 2);
  assert.equal(out.meta.official.raw.top[0].account, 'yrf');
  assert.equal(out.meta.official.raw.followers_reached, 4_900_000);
});

// Runs after the test above, so the network maximum is already 150,000 from that film.
test('meta-discovery → a smaller film reads below the network’s established maximum', async () => {
  const now = new Date().toISOString();
  const discoverImpl = async (self, username) => ({ username, followers: 1000, media_count: 10,
    media: [{ text: 'Dilli Se Dubai poster', t: now, eng: 15_000, permalink: 'q1' }] });
  const sources = { instagram: [{ username: 'yrf', industries: ['Hindi'] }] };
  const out = await disc.run('13', { title: 'Dilli Se Dubai', aliases: [], industries: ['Hindi'] }, { sources, selfIgId: '17841000', discoverImpl });
  assert.equal(out.meta.official.raw.engagement_72h, 15_000);
  assert.equal(out.meta.official.raw.network_90d_max, 150_000);
  assert.ok(out.signals.official < 100 && out.signals.official > 0, `got ${out.signals.official}`);
});

test('kobis → daily rows become the calibration the advance leg is checked against', async () => {
  const f = mockFetch([{ match: 'searchDailyBoxOfficeList', body: { boxOfficeResult: { dailyBoxOfficeList: [
    { rank: '1', movieNm: '어쩔수가없다', openDt: '2026-09-04', audiCnt: '210000', audiAcc: '1050000', salesAmt: '2100000000', salesAcc: '10000000000', scrnCnt: '1400', showCnt: '5600' },
    { rank: '2', movieNm: 'Another', openDt: '2026-08-20', audiCnt: '60000', audiAcc: '900000', salesAmt: '540000000', salesAcc: '8000000000', scrnCnt: '700', showCnt: '2400' },
  ] } } }]);
  const day = await kobis.daily('20260911', { fetchImpl: f });
  const rows = kobis.calibration(day);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].day1_share, 0.2);                 // 210,000 of 1,050,000 so far
  assert.equal(rows[0].won_per_admission, 10000);
  assert.equal(rows[0].per_show, 38);
  const out = await kobis.run(null, null, { day });
  assert.deepEqual(out.signals, {});                      // calibration only — never a Pulse signal
  assert.equal(out.meta.kobis.raw.won_per_admission_median, 9500);
});
