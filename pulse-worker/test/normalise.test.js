import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMillion, toThousand, likeRatio, viewsAt24h, idx100 } from '../lib/normalise.js';
import { classify, sentimentPct } from '../lib/sentiment.js';
import { trendingMatchesFilm, textMatchesFilm } from '../lib/match.js';
import { film } from './helpers.js';

test('units', () => {
  assert.equal(toMillion(38_240_000), 38.24);
  assert.equal(toThousand(1_234), 1.2);
  assert.equal(likeRatio(1_568_000, 38_240_000), 41);
  assert.equal(idx100(780, 1000), 78);
  assert.equal(idx100(5, 0), 0);
});
test('tr24 interpolation from bracketing log rows', () => {
  const pub = '2026-09-01T10:00:00Z';
  const rows = [{ at: '2026-09-02T09:00:00Z', value: 36_000_000 }, { at: '2026-09-02T11:00:00Z', value: 40_000_000 }];
  assert.equal(viewsAt24h(pub, rows), 38_000_000);
  assert.equal(viewsAt24h(pub, [rows[1]]), null); // not observable
});
test('hinglish sentiment', () => {
  assert.equal(classify('Trailer toh faadu hai 🔥 FDFS pakka'), 'positive');
  assert.equal(classify('bakwaas lag raha, OTT pe dekhenge'), 'negative');
  assert.equal(classify('release kab hai?'), 'neutral');
  const s = sentimentPct(['mast', 'mast', 'flop', 'kab aa rahi']);
  assert.deepEqual([s.pos, s.neg, s.neutral, s.pct], [2, 1, 1, 67]);
});
test('film matching', () => {
  assert.ok(trendingMatchesFilm('haiwaan trailer', film));
  assert.ok(trendingMatchesFilm('Saif Ali Khan', film));
  assert.ok(!trendingMatchesFilm('nora fatehi', film));
  assert.ok(textMatchesFilm('Akshay is back! #Haiwaan trailer out now', film));
  assert.ok(!textMatchesFilm('Weekend box office update: Drishyam holds', film));
});
