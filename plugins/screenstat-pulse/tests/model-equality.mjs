// Pins app/pulse-model.js (v1.7, copied verbatim from the handover) against every acceptance
// fixture in HANDOVER-WORLD.md §5. There is no PHP compute() anymore - see class-model.php's
// docblock - so this replaces the old tests/model-equality.php, which called a method that no
// longer exists. Run:  node tests/model-equality.mjs
//
// Fixtures A-E take their input from data/examples.json rather than from literals retyped here,
// so a stale examples file fails this test instead of quietly shipping a "Load example films"
// button that produces a different film from the one the handover documents. That is not
// hypothetical: examples.json went stale in the v1.7 upgrade and this is what catches it.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compute, inferWom, GROUPS, INDUSTRY, INDKEYS } from '../app/pulse-model.js';

let checked = 0, fail = 0;
function eq(label, got, want, tol = 0.01) {
	checked++;
	const ok = Math.abs(got - want) <= tol * Math.max(1, Math.abs(got), Math.abs(want));
	if (ok) { console.log(`  ok   ${label}: ${got}`); } else { fail++; console.log(`  FAIL ${label}: got ${got}, expected ${want}`); }
}
function same(label, got, want) {
	checked++;
	if (got === want) { console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}: got ${got}, expected ${want}`); }
}

const examples = JSON.parse(readFileSync(new URL('../data/examples.json', import.meta.url), 'utf8'));
const rakt = examples.find(e => e.title === 'Raktdhaar');
if (!rakt) { console.log('FAIL: data/examples.json has no Raktdhaar to test against'); process.exit(1); }
const samples = rakt.samples.map(x => ({ src: x.src, n: x.n, def: x.def, prob: x.prob, ott: x.ott, no: x.no }));
same('examples.json carries the four fixture-A samples', samples.length, 4);

console.log('Fixture A: Raktdhaar + all four samples (incl. the auto comments sample)');
const A = compute(rakt.s, samples, {});
eq('buzz', A.buzz, 83.6);
eq('intent (lakh)', A.intent / 1e5, 65.2);
eq('day 1 cr', A.gross[0], 63.97);
eq('lifetime cr', A.life, 633.62);
eq('pHit', A.pHit, 0.95);
same('verdict', A.verdict[0], 'Hit');

console.log('Fixture B: same, no samples');
const B = compute(rakt.s, [], {});
eq('buzz', B.buzz, 83.6);
eq('life P10', B.mc.life[0], 349.57);
eq('life P50', B.mc.life[1], 541.70);
eq('life P90', B.mc.life[2], 833.35);

console.log('Fixture C: same, three polls only (no comments sample)');
const C = compute(rakt.s, samples.filter(x => x.src !== 'comments'), {});
eq('day 1 cr', C.gross[0], 57.92);
eq('lifetime cr', C.life, 575.20);

console.log('Fixture D: same + actualDays [61.2, 74.5, 88.0]');
const D = compute(rakt.s, samples, { actualDays: [61.2, 74.5, 88.0] });
eq('womObs', D.womObs, 0.852);
eq('week 1 cr', D.week1, 376.72);
eq('life P10', D.mc.life[0], 637.33);
eq('life P50', D.mc.life[1], 732.02);
eq('life P90', D.mc.life[2], 835.67);

// The industry dimension end to end. Overrides come from the model's own INDUSTRY table, so this
// fails if a constant moves - which is the point, since nothing else re-checks that table.
console.log('Fixture E: same signals, industry switched (with that industry\'s ATP/screens/seats)');
const E_EXPECTED = { telugu: [34.03, 338.78], tamil: [31.11, 308.91], kannada: [22.29, 222.43], malayalam: [21.00, 208.41], hollywood: [48.03, 479.65] };
for (const [key, [d1, life]] of Object.entries(E_EXPECTED)) {
	const ind = INDUSTRY[key];
	const r = compute({ ...rakt.s, industry: key, atp: ind.atp, screens: ind.screens, seats: ind.seats }, samples, {});
	eq(`${key} day 1 cr`, r.gross[0], d1);
	eq(`${key} lifetime cr`, r.life, life);
}
same('INDUSTRY covers every key INDKEYS declares', INDKEYS.every(k => !!INDUSTRY[k]), true);

console.log('Fixture F: a newly tracked film with untouched defaults');
// Mirrors SSPulse_Rest::default_signals() in includes/class-rest.php - keep the two in step.
const defaults = { tr24: 5, trTotal: 15, likeRatio: 35, search: 35, wiki: 3, imdb: 0, gsc: 0, tmdb: 0, posts: 20, net: 20, official: 0, reddit: 0, sentiment: 62, bms: 80, antic: 0, adv: 0, song: 20, spot: 0, star: 40, screens: 1500, shows: 4, seats: 190, atp: 180, budget: 50, days: 30, runtime: 140, holiday: 'auto', comp: 'auto', cert: 'UA', event: 'none', franchise: '0', remake: '0', genre: 'action', dubbed: '0', industry: 'hindi', advShare: 0.42, advFrac: 0.5, kInt: 3.8, bias: 0.25 };
const F = compute(defaults, [], {});
eq('buzz', F.buzz, 32.7);
eq('day 1 cr', F.mc.d1[1], 2.43);
eq('lifetime cr', F.mc.life[1], 22.66);

console.log('Fixture G: weight integrity');
same('GROUPS group weights sum to 100', GROUPS.reduce((a, g) => a + g.w, 0), 100);
let fieldSum = 0;
for (const g of GROUPS) for (const f of g.fields) if (f.w) fieldSum += f.w;
same('field weights + quality 6 sum to 100', fieldSum + 6, 100);

console.log('Fixture H: inferWom(3.52, true)');
eq('inferWom', inferWom(3.52, true), 0.711);

// pulse-worker imports its own copy so it can run the real model in Node. Two copies drift
// silently; a hash check is the cheapest way to make that loud.
console.log('Model integrity: the plugin and worker copies are the same file');
const hash = p => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');
same('app/pulse-model.js === pulse-worker/lib/pulse-model.js', hash('../app/pulse-model.js'), hash('../../../pulse-worker/lib/pulse-model.js'));

// The sspulse_industry seed is hand-typed from the same constants. Its note strings carry en
// dashes, a possessive and a multiplication sign that an ASCII-flattening editor silently eats -
// which already happened once. Compare against the model's own strings, not against a memory of them.
console.log('Seed integrity: class-seed.php industry notes match INDUSTRY');
const seedSrc = readFileSync(new URL('../includes/class-seed.php', import.meta.url), 'utf8');
for (const key of INDKEYS) {
	same(`${key} note present verbatim in the PHP seed`, seedSrc.includes(INDUSTRY[key].note), true);
}

console.log(`\n${checked} values checked, ${fail} mismatches`);
process.exit(fail ? 1 : 0);
