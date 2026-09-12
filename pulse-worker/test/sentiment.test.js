import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, analyse, merge, isSpam, aspectsOf } from '../lib/sentiment.js';

test('negation flips polarity (Hinglish and English)', () => {
  assert.equal(classify('acting bilkul achhi nahi, story bakwaas'), 'negative');
  assert.equal(classify('not bad at all, trailer mast hai'), 'positive');   // "not bad" → positive, "mast" → positive
  assert.equal(classify('ye flop nahi hoga, blockbuster hai'), 'positive');  // "flop nahi" negated negative
  assert.equal(classify('boring nahi laga'), 'positive');
  assert.equal(classify('trailer mast nahi hai'), 'negative');     // post-negation, Hindi word order
  assert.equal(classify('story achhi hai, but VFX kharab'), 'neutral'); // one for, one against — negation must not cross the clause
});
test('spam and filler are dropped, not counted as neutral', () => {
  assert.ok(isSpam("Who's watching in 2026?"));
  assert.ok(isSpam('First!'));
  assert.ok(isSpam('1 like = 1 respect for Akshay'));
  assert.ok(isSpam('subscribe to my channel'));
  assert.ok(!isSpam('Trailer dekh ke goosebumps aa gaye'));
});
test('likes weight the verdict: one upvoted complaint outweighs many idle cheers', () => {
  const a = analyse([
    { text: 'mast trailer 🔥', likes: 0 }, { text: 'mast trailer 🔥', likes: 0 }, { text: 'mast trailer 🔥', likes: 0 },
    { text: 'VFX bilkul cheap lag raha hai, disappointed', likes: 9999 },
  ]);
  assert.equal(a.pct_unweighted, 75);
  assert.ok(a.pct < 50, `weighted pct should be < 50, got ${a.pct}`);
  assert.equal(a.worry[0].label, 'VFX / scale');
});
test('aspects: what they love vs what worries them', () => {
  assert.deepEqual(aspectsOf('BGM aur action goosebumps 🔥'), ['Action', 'Music / BGM', 'Hype / trailer cut']);
  const a = analyse([
    { text: 'Akshay is back, action sequences are peak 🔥', likes: 120 },
    { text: 'BGM killer hai, goosebumps', likes: 80 },
    { text: 'story same purani lag rahi, south copy', likes: 60 },
    { text: 'OTT pe dekhenge, ticket ke paise barbaad', likes: 30 },
    { text: "who's watching in 2026", likes: 500 },
  ]);
  assert.equal(a.spam, 1);
  assert.equal(a.pos, 2); assert.equal(a.neg, 2);
  assert.ok(a.love.map(x => x.label).includes('Lead star'));
  assert.ok(a.worry.map(x => x.label).includes('Remake / copy concern'));
  assert.ok(a.worry.map(x => x.label).includes('Will wait for OTT'));
});
test('merge weights sources by scored volume', () => {
  const yt = { n: 400, scored: 380, pos: 300, neg: 80, spam: 20, pct: 79, love: [{ label: 'Action', weight: 40 }], worry: [{ label: 'VFX / scale', weight: 12 }] };
  const net = { n: 40, scored: 38, pos: 10, neg: 28, spam: 2, pct: 26, love: [], worry: [{ label: 'Story / writing', weight: 9 }] };
  const m = merge({ youtube: yt, 'meta-network': net });
  assert.equal(m.n, 418);
  assert.ok(m.pct > 70 && m.pct < 79, `expected between 70 and 79, got ${m.pct}`); // 380 comments dominate 38
  assert.equal(m.by.youtube.pct, 79);
  assert.equal(m.love[0].label, 'Action');
});
