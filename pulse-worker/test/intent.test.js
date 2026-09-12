import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyIntent, intentSample } from '../lib/intent.js';
test('intent classes, Hinglish and English', () => {
  assert.equal(classifyIntent('FDFS pakka bhai 🔥'), 'definite');
  assert.equal(classifyIntent('Booking done for Friday'), 'definite');
  assert.equal(classifyIntent('theatre me dekhenge, can\'t wait'), 'definite');
  assert.equal(classifyIntent('reviews ke baad dekhte hain'), 'conditional');
  assert.equal(classifyIntent('Maybe next week if reviews are good'), 'conditional');
  assert.equal(classifyIntent('OTT pe dekhenge, ticket ke paise bachao'), 'no');
  assert.equal(classifyIntent('theatre me nahi dekhunga'), 'no');
  assert.equal(classifyIntent('pakka dekhunga nahi'), 'no');           // negated definite
  assert.equal(classifyIntent('trailer mast hai'), 'none');            // sentiment, not intent
  assert.equal(classifyIntent("who's watching in 2026?"), 'none');     // spam
});
test('intent sample is poll-shaped and counts only comments that state an intent', () => {
  const s = intentSample([
    'FDFS pakka', 'booking done', 'first day first show', 'can\'t wait', 'theatre me dekhenge',
    'reviews ke baad', 'maybe',
    'OTT pe dekhenge', 'wait for ott', 'skip',
    'trailer mast hai', 'bgm goosebumps', 'release kab hai?', 'first!',
  ]);
  assert.deepEqual([s.n, s.def, s.prob, s.ott, s.no], [10, 5, 2, 2, 1]);
  assert.equal(s.none, 4);
  assert.equal(s.definite_share, 50);
  assert.equal(s.expressed_share, 71);
});
