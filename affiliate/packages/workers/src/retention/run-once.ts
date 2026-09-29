/**
 * CLI: run the retention purge once and exit.
 *
 *   pnpm --filter @paparazzi/workers purge:retention [--dry-run]
 *
 * Reads DATABASE_URL (required) and the RETENTION_* windows (optional).
 * Prints a machine-readable JSON summary to stdout; exits 0 on success,
 * 1 on failure. --dry-run reports what would be purged without writing
 * anything (no payload nulling, no outbox deletes, no audit rows).
 *
 * Sandbox only: this is the same code path the scheduled BullMQ job runs.
 */

import { Pool } from 'pg';
import { loadRetentionConfig } from './config';
import { runRetentionPurge } from './purge';
import { createLogger, errorMessage } from '../logging';

const log = createLogger('retention:run-once');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured');
  }
  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    log('info', 'dry-run mode: nothing will be written');
  }

  const config = loadRetentionConfig();
  log('info', 'starting retention purge', {
    click_context_days: config.clickContextDays,
    conversion_raw_days: config.conversionRawDays,
    outbox_days: config.outboxDays,
    dry_run: dryRun,
  });

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const results = await runRetentionPurge(pool, config, { dryRun });
    const total = results.reduce(
      (sum, r) => sum + r.classes.reduce((a, c) => a + c.rows_affected, 0),
      0,
    );
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ dry_run: dryRun, orgs: results.length, rows_affected_total: total, results }),
    );
    log('info', 'retention purge finished', {
      orgs: results.length,
      rows_affected_total: total,
      dry_run: dryRun,
    });
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', error: errorMessage(error) }));
  process.exit(1);
});
