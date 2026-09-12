import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute } from '../lib/pulse-model.js';
import { toModelSamples, buildReading } from '../lib/reading.js';

test('toModelSamples maps the plugin\'s samples row shape to what compute() reads', () => {
	const out = toModelSamples([{ src: 'ig', n: 2140, def_ct: 920, prob_ct: 640, ott_ct: 400, no_ct: 180 }]);
	assert.deepEqual(out, [{ src: 'ig', n: 2140, def: 920, prob: 640, ott: 400, no: 180 }]);
});
test('toModelSamples tolerates no samples', () => { assert.deepEqual(toModelSamples(undefined), []); assert.deepEqual(toModelSamples([]), []); });

test('buildReading shapes compute() output into the POST /readings body, tagged source: cron', () => {
	const rakt = { tr24: 38, trTotal: 96, likeRatio: 41, search: 82, wiki: 64, imdb: 38, gsc: 42, tmdb: 410, posts: 210, net: 78, official: 82, sentiment: 71, bms: 1400, antic: 46, song: 140, star: 84,
		screens: 4200, shows: 5, seats: 200, atp: 240, budget: 260, days: 12, holiday: '1', comp: 'none', franchise: '1', remake: '0', genre: 'action', dubbed: '0', runtime: 158, cert: 'UA', event: 'none', adv: 0, spot: 71, reddit: 340, advShare: 0.42, advFrac: 0.5, kInt: 3.8, bias: 0.25 };
	const r = compute(rakt, [], {});
	const reading = buildReading(r, '2026-09-12');
	assert.equal(reading.read_on, '2026-09-12');
	assert.equal(reading.source, 'cron');
	assert.ok(Math.abs(reading.buzz - 83.6) < 0.5, `buzz ~83.6, got ${reading.buzz}`);
	assert.equal(reading.life_p10, r.mc.life[0]);
	assert.equal(reading.life_p50, r.mc.life[1]);
	assert.equal(reading.life_p90, r.mc.life[2]);
	assert.equal(reading.d1_p50, r.mc.d1[1]);
	assert.ok(reading.life_p10 < reading.life_p50 && reading.life_p50 < reading.life_p90);
});
