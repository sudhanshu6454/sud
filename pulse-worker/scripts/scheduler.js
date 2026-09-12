#!/usr/bin/env node
// Runs the worker's own schedule (README.md §5) inside the container, so `docker compose up -d
// pulse-worker` needs nothing external - no host cron, no systemd timers. A minute tick checks
// each job's schedule in Asia/Kolkata and spawns it as a child process (same CLI entry points
// documented in the README), so `node run.js --connector ...` behaves identically run by hand or
// by this scheduler.
import { spawn } from 'node:child_process';
import { loadEnv } from '../lib/env.js';
loadEnv();

const JOBS = [
	{ name: 'trends-rss', everyMinutes: 30, cmd: ['run.js', '--connector', 'trends-rss'] },
	{ name: 'six-hourly', times: ['00:00', '06:00', '12:00', '18:00'], cmd: ['run.js', '--connector', 'youtube,meta-hashtags,meta-network,meta-discovery,reddit,trakt'] },
	{ name: 'daily-ingest', times: ['08:30'], cmd: ['run.js', '--connector', 'wikimedia,gsc,trends,spotify,tmdb'] },
	// after 08:30 ingestion, never before (README §5) - the plugin's own watchdog checks at 10:00 IST
	{ name: 'daily-reading', times: ['09:00'], cmd: ['scripts/daily-reading.js'] },
];

function nowIST() {
	const s = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }); // "DD/MM/YYYY, HH:MM:SS"
	const [datePart, timePart] = s.split(', ');
	const [dd, mm, yyyy] = datePart.split('/');
	return { date: `${yyyy}-${mm}-${dd}`, hm: timePart.slice(0, 5), minutes: (+timePart.slice(0, 2)) * 60 + (+timePart.slice(3, 5)) };
}

function runJob(job) {
	console.log(`[scheduler] ${new Date().toISOString()} running ${job.name}: node ${job.cmd.join(' ')}`);
	const child = spawn(process.execPath, job.cmd, { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
	child.on('exit', (code) => console.log(`[scheduler] ${job.name} exited ${code}`));
	child.on('error', (e) => console.error(`[scheduler] ${job.name} failed to start: ${e.message}`));
}

const lastRun = {}; // job.name -> the bucket (date, or date+times-slot, or date+30min-bucket) last run
function tick() {
	const { date, hm, minutes } = nowIST();
	for (const job of JOBS) {
		try {
			if (job.everyMinutes) {
				const bucket = `${date}T${Math.floor(minutes / job.everyMinutes)}`;
				if (lastRun[job.name] !== bucket) { lastRun[job.name] = bucket; runJob(job); }
			} else if (job.times.includes(hm) && lastRun[job.name] !== `${date}T${hm}`) {
				lastRun[job.name] = `${date}T${hm}`; runJob(job);
			}
		} catch (e) { console.error(`[scheduler] ${job.name}: ${e.message}`); }
	}
}

console.log('[scheduler] started - ' + JOBS.map((j) => j.name).join(', '));
tick();
setInterval(tick, 60_000);
