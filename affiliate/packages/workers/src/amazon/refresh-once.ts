/**
 * CLI: run the Amazon offer refresh once and exit (the same code path as the
 * hourly job on the feeds queue).
 *
 *   node dist/amazon/refresh-once.js        (workers image; tsx src/amazon/refresh-once.ts in the repo)
 *
 * Reads DATABASE_URL (required) and the AMAZON_CREATORS_* credentials
 * (optional: without them only the price expiry, AMAZON_PRICE_MAX_AGE_HOURS, runs). Prints a JSON
 * summary to stdout; exits 0 on success, 1 on failure. Never prints a
 * credential.
 */
import { Pool } from 'pg';
import { createLogger, errorMessage } from '../logging';
import { refreshAmazonOffers } from './refresh';
import { CreatorsApiClient, creatorsApiConfigFromEnv } from './creators-api';

const log = createLogger('amazon:refresh-once');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const summary = await refreshAmazonOffers(pool, {
      clientFor: (account) => {
        const cfg = creatorsApiConfigFromEnv(process.env, account);
        return cfg ? new CreatorsApiClient(cfg) : null;
      },
      log: (level, message, fields) => log(level, message, fields),
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'fatal', error: errorMessage(error) }));
  process.exit(1);
});
