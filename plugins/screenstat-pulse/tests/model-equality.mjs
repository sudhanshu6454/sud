// Pins app/pulse-model.js (v1.7, copied verbatim from the handover) against the acceptance
// fixtures in HANDOVER-WORLD.md §5. There is no PHP compute() anymore - see class-model.php's
// docblock - so this replaces the old tests/model-equality.php, which called a method that no
// longer exists. Run:  node tests/model-equality.mjs
import { compute, inferWom, GROUPS } from '../app/pulse-model.js';

let checked = 0, fail = 0;
function close(a, b, tol = 0.01) {
	checked++;
	const ok = Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
	if (!ok) { fail++; console.log(`  FAIL: got ${a}, expected ${b}`); }
	else { console.log(`  ok   ${a} ~= ${b}`); }
	return ok;
}
function same(a, b, label) {
	checked++;
	if (a !== b) { fail++; console.log(`  FAIL ${label}: got ${a}, expected ${b}`); }
	else { console.log(`  ok   ${label}`); }
}

const defaultS = { tr24: 5, trTotal: 15, likeRatio: 35, search: 35, wiki: 3, imdb: 0, gsc: 0, tmdb: 0, posts: 20, net: 20, official: 0, reddit: 0, sentiment: 62, bms: 80, antic: 0, adv: 0, song: 20, spot: 0, star: 40, screens: 1500, shows: 4, seats: 190, atp: 180, budget: 50, days: 30, runtime: 140, holiday: 'auto', comp: 'auto', cert: 'UA', event: 'none', franchise: '0', remake: '0', genre: 'action', dubbed: '0', industry: 'hindi', advShare: 0.42, advFrac: 0.5, kInt: 3.8, bias: 0.25 };

const rakt = { tr24: 38, trTotal: 96, likeRatio: 41, search: 82, wiki: 64, imdb: 38, gsc: 42, tmdb: 410, posts: 210, net: 78, official: 82, sentiment: 71, bms: 1400, antic: 46, song: 140, star: 84,
	screens: 4200, shows: 5, seats: 200, atp: 240, budget: 260, days: 12, holiday: '1', comp: 'none', franchise: '1', remake: '0', genre: 'action', dubbed: '0', runtime: 158, cert: 'UA', event: 'none', adv: 0, spot: 71, reddit: 340, advShare: 0.42, advFrac: 0.5, kInt: 3.8, bias: 0.25 };

console.log('Fixture F: default new film');
const rF = compute(defaultS, [], {});
close(rF.buzz, 32.7, 0.02);
close(rF.mc.d1[1], 2.43, 0.02);
close(rF.mc.life[1], 22.66, 0.02);

console.log('Fixture B: Raktdhaar, no samples');
const rB = compute(rakt, [], {});
close(rB.buzz, 83.6, 0.02);
close(rB.mc.life[0], 349.57, 0.02);
close(rB.mc.life[1], 541.70, 0.02);
close(rB.mc.life[2], 833.35, 0.02);

console.log('Fixture G: GROUPS weights');
const groupSum = GROUPS.reduce((a, g) => a + g.w, 0);
same(groupSum, 100, 'group weight sum');
let fieldSum = 0;
for (const g of GROUPS) for (const f of g.fields) if (f.w) fieldSum += f.w;
same(fieldSum + 6, 100, 'field weight sum + quality');

console.log('Fixture H: inferWom');
close(inferWom(3.52, true), 0.711, 0.01);

console.log(`\n${checked} values checked, ${fail} mismatches`);
process.exit(fail ? 1 : 0);
