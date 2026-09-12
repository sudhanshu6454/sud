#!/usr/bin/env node
// Runs the real pulse-model.js compute() for every tracked, filled film and posts the result to
// WordPress. This replaces what class-cron.php did in PHP before v1.7 - the model grew a
// stochastic core the handover itself says not to hand-port, so WordPress no longer computes;
// it only watches (see class-cron.php's admin_notice) for a day this script did not run.
//   node scripts/daily-reading.js [--film 12] [--dry-run]
import { loadEnv, env } from '../lib/env.js';
import { getJSON } from '../lib/http.js';
import { compute } from '../lib/pulse-model.js';
import { toModelSamples, buildReading } from '../lib/reading.js';
loadEnv();

const args = {};
{ const av = process.argv.slice(2); for (let i = 0; i < av.length; i++) { const m = av[i].match(/^--([^=]+)(?:=(.*))?$/); if (!m) continue; if (m[2] !== undefined) args[m[1]] = m[2]; else if (av[i + 1] && !av[i + 1].startsWith('--')) args[m[1]] = av[++i]; else args[m[1]] = true; } }
const dry = !!args['dry-run'];

const base = (env('WP_URL') || '').replace(/\/$/, '');
if (!base) { console.error('WP_URL is not set - nothing to read films from or post readings to'); process.exit(1); }
const user = env('WP_USER'), pass = env('WP_APP_PASSWORD');
if (!user || !pass) { console.error('WP_USER / WP_APP_PASSWORD are not set'); process.exit(1); }
const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD

async function postReading(id, reading) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const res = await fetch(`${base}/wp-json/sspulse/v1/films/${id}/readings`, {
			method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body: JSON.stringify(reading),
		});
		if (res.ok) return res.json();
		if (res.status === 422 || res.status === 404) throw new Error(`WordPress rejected reading: HTTP ${res.status} ${await res.text()}`);
		if (attempt === 2) throw new Error(`post reading failed: HTTP ${res.status}`);
		await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
	}
}

const films = await getJSON(`${base}/wp-json/sspulse/v1/films`, { headers: { Authorization: auth }, perMinute: 60 });
const only = args.film && args.film !== true ? [String(args.film)] : null;

let failures = 0, ran = 0;
for (const film of films) {
	if (only && !only.includes(String(film.id))) continue;
	if (film.status !== 'tracking' || film.unfilled) continue;
	try {
		const opts = film.actual_days ? { actualDays: film.actual_days } : {};
		const r = compute(film.signals, toModelSamples(film.samples), opts);
		const reading = buildReading(r, today);
		ran++;
		if (dry) { console.log(`${film.title}: dry run -> ${JSON.stringify(reading)}`); continue; }
		await postReading(film.id, reading);
		console.log(`${film.title}: buzz ${r.buzz.toFixed(1)} · d1 p50 ${r.mc.d1[1].toFixed(2)} · life p50 ${r.mc.life[1].toFixed(2)}`);
	} catch (e) {
		failures++; console.error(`[${film.title}] ${e.message}`);
	}
}
console.log(`\n${ran} film(s) read · ${failures} failure(s)`);
process.exit(failures ? 2 : 0);
