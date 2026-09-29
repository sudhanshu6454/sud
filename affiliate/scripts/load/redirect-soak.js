#!/usr/bin/env node
/**
 * Redirect soak — dependency-free load probe for GET /r/{token}.
 *
 * Why a plain node script: this repo's sandbox has no k6/autocannon and no
 * network installs; the script needs nothing beyond the node stdlib so it
 * runs identically on a laptop, in CI, or on a staging box.
 *
 * What it measures: server-side processing time of the redirect hot path.
 * The service 302s (or serves the paused page) WITHOUT fetching the
 * merchant — there is no merchant time on this path — so measured TTFB is
 * the service processing time the brief's bar refers to.
 *
 * Usage (against a REAL deployment — staging/prod-like, never pg-mem):
 *
 *   BASE_URL=https://redirect.staging.example.com \
 *   R_TOKEN=<token minted via POST /v1/links> \
 *   node scripts/load/redirect-soak.js            # soak: 500 rps, 15 min
 *
 *   node scripts/load/redirect-soak.js --smoke    # smoke: 50 rps, 30 s
 *
 * Env overrides: TARGET_RPS, DURATION_S, WARMUP_S.
 *
 * It CANNOT run meaningfully here: pg-mem is an in-process JS reimplementation
 * of Postgres, so any numbers produced in this sandbox say nothing about the
 * real hot path. The brief's pre-pilot gates (recorded in
 * docs/pilot-checklist.md) are: 500 rps sustained for 15 min, p95 < 150 ms
 * service processing, 99.9% redirect availability, p75 LCP ≤ 2.5 s on the PWA.
 *
 * Bars enforced by this script: p95 < 150 ms and error rate < 0.1%.
 * Exit codes: 0 = PASS, 1 = FAIL (bars missed), 2 = misconfiguration.
 */

import http from 'node:http';
import https from 'node:https';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const TOKENS = (process.env.R_TOKEN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SMOKE = process.argv.includes('--smoke');
const TARGET_RPS = Number(process.env.TARGET_RPS ?? (SMOKE ? 50 : 500));
const DURATION_S = Number(process.env.DURATION_S ?? (SMOKE ? 30 : 900));
const WARMUP_S = Number(process.env.WARMUP_S ?? 3);
const P95_BAR_MS = 150;
const ERROR_BAR = 0.001; // 0.1%

if (TOKENS.length === 0) {
  console.error(
    'misconfiguration: set R_TOKEN to a comma-separated list of live link tokens ' +
      '(mint via POST /v1/links against the target deployment first)',
  );
  process.exit(2);
}
if (!Number.isFinite(TARGET_RPS) || TARGET_RPS <= 0 || !Number.isFinite(DURATION_S) || DURATION_S <= 0) {
  console.error('misconfiguration: TARGET_RPS and DURATION_S must be positive numbers');
  process.exit(2);
}

const proto = BASE_URL.startsWith('https') ? https : http;
const agent = new (BASE_URL.startsWith('https') ? https.Agent : http.Agent)({
  keepAlive: true,
  maxSockets: Math.max(256, TARGET_RPS),
});

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function fire(token) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const req = proto.get(
      `${BASE_URL}/r/${token}`,
      { agent, timeout: 10000 },
      (res) => {
        res.resume(); // drain; we only need status + timing
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          resolve({ ms, status: res.statusCode ?? 0 });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ms: 10000, status: 0, timeout: true });
    });
    req.on('error', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ms, status: 0, error: true });
    });
  });
}

async function main() {
  const profile = SMOKE ? 'smoke' : 'soak';
  console.log(
    `redirect ${profile}: ${TARGET_RPS} rps for ${DURATION_S}s (+${WARMUP_S}s warmup) -> ${BASE_URL}/r/{token} ` +
      `(${TOKENS.length} token(s))`,
  );

  const latencies = [];
  let sent = 0;
  let errors = 0;
  let timedOut = 0;
  const statusCounts = new Map();
  const t0 = Date.now();
  const endAt = t0 + (WARMUP_S + DURATION_S) * 1000;
  let tokenIdx = 0;

  // Fixed-rate scheduler: every 25 ms, dispatch however many requests the
  // elapsed wall-clock says we owe. Busy-loop-free and self-correcting.
  await new Promise((resolve) => {
    const tick = setInterval(() => {
      const now = Date.now();
      if (now >= endAt) {
        clearInterval(tick);
        resolve();
        return;
      }
      const elapsedS = (now - t0) / 1000;
      const owed = Math.floor(elapsedS * TARGET_RPS) - sent;
      for (let i = 0; i < owed; i++) {
        sent += 1;
        const token = TOKENS[tokenIdx++ % TOKENS.length];
        const inWarmup = elapsedS < WARMUP_S;
        fire(token).then(({ ms, status, timeout }) => {
          if (inWarmup) return;
          statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
          if (timeout || status === 0 || status >= 500) {
            errors += 1;
            if (timeout) timedOut += 1;
          } else {
            latencies.push(ms);
          }
        });
      }
    }, 25);
  });

  // Let in-flight requests land (up to the 10 s request timeout).
  await new Promise((r) => setTimeout(r, 11000));

  latencies.sort((a, b) => a - b);
  const measured = latencies.length + errors;
  const achievedRps = measured / DURATION_S;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const errorRate = measured === 0 ? 1 : errors / measured;

  console.log(`sent=${sent} measured=${measured} achieved_rps=${achievedRps.toFixed(1)}`);
  console.log(
    `latency_ms p50=${p50.toFixed(1)} p95=${p95.toFixed(1)} p99=${p99.toFixed(1)} ` +
      `(n=${latencies.length})`,
  );
  console.log(
    `errors=${errors} (timeouts=${timedOut}) error_rate=${(errorRate * 100).toFixed(3)}% ` +
      `status=${JSON.stringify(Object.fromEntries(statusCounts))}`,
  );

  const p95ok = p95 < P95_BAR_MS;
  const errok = errorRate < ERROR_BAR;
  console.log(`bar p95 < ${P95_BAR_MS}ms: ${p95ok ? 'PASS' : 'FAIL'}`);
  console.log(`bar error rate < ${ERROR_BAR * 100}%: ${errok ? 'PASS' : 'FAIL'}`);
  console.log(p95ok && errok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(p95ok && errok ? 0 : 1);
}

main().catch((err) => {
  console.error('soak crashed:', err);
  process.exit(1);
});
