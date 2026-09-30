/**
 * CLI: map the in-house pages to their Meta ids once (the owner's
 * `looks.sh accounts`; node dist/meta/sync-accounts-once.js in the workers
 * image). Needs DATABASE_URL, META_APP_SECRET and META_SYSTEM_USER_TOKEN (the
 * last two from the environment only: never an argument). Flags:
 * [--org-slug afflino] [--subscribe]. Prints counts and handles as JSON;
 * never a token.
 */
import { Pool } from 'pg';
import { DEFAULT_GRAPH_VERSION, GraphClient, PageTokenStore } from './graph';
import { syncMetaAccounts } from './sync-accounts';

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  const secret = process.env.META_APP_SECRET?.trim();
  const token = process.env.META_SYSTEM_USER_TOKEN?.trim();
  if (!url || !secret || !token) {
    console.error('DATABASE_URL, META_APP_SECRET and META_SYSTEM_USER_TOKEN are required (the secrets from the environment)');
    return 2;
  }
  const args = process.argv.slice(2);
  const i = args.indexOf('--org-slug');
  const orgSlug = i >= 0 && args[i + 1] ? (args[i + 1] as string) : 'afflino';
  const graph = new GraphClient({ appSecret: secret, version: process.env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION });
  const tokens = new PageTokenStore(graph, token);
  const pool = new Pool({ connectionString: url });
  try {
    const summary = await syncMetaAccounts(pool, tokens, graph, { orgSlug, subscribe: args.includes('--subscribe') });
    console.log(JSON.stringify(summary, null, 2));
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
