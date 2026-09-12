// Pure helpers for scripts/daily-reading.js, split out so they're testable without a live
// WordPress instance: shaping a film's stored signals/samples into what pulse-model.js's
// compute() expects, and shaping compute()'s output into what POST /films/{id}/readings expects.
export function toModelSamples(samples) {
	return (samples || []).map((s) => ({ src: s.src, n: s.n, def: s.def_ct, prob: s.prob_ct, ott: s.ott_ct, no: s.no_ct }));
}

export function buildReading(result, readOn, source = 'cron') {
	return {
		read_on: readOn, buzz: result.buzz, intent: result.intent,
		life_p50: result.mc.life[1], life_p10: result.mc.life[0], life_p90: result.mc.life[2],
		d1_p10: result.mc.d1[0], d1_p50: result.mc.d1[1], d1_p90: result.mc.d1[2], source,
	};
}
