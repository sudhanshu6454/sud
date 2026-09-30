/**
 * CLI: run the analytics rollups once and exit (node dist/analytics/rollup-once.js
 * in the workers image; tsx src/analytics/rollup-once.ts in the repo).
 * DATABASE_URL required. `--days <n>` recomputes the last n IST days of clicks
 * (default 2). Prints the summary as JSON.
 */
import { Pool } from 'pg';
import { runRollups } from './rollup';
import { loadRetentionConfig } from '../retention/config';

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    return 2;
  }
  const i = process.argv.indexOf('--days');
  const days = i >= 0 ? Number(process.argv[i + 1]) : 2;
  if (!Number.isInteger(days) || days < 1 || days > 400) {
    console.error('--days is 1..400');
    return 2;
  }
  const pool = new Pool({ connectionString: url });
  try {
    const retention = loadRetentionConfig();
    console.log(
      JSON.stringify(
        await runRollups(pool, { clickDays: days, replyDays: Math.max(8, days), replyRetentionDays: retention.replyEventsDays, clickContextDays: retention.clickContextDays }),
        null,
        2,
      ),
    );
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
