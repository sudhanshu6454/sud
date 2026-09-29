#!/usr/bin/env node
/**
 * Applies db/migrations/*.sql in lexical order, one transaction per file.
 *
 * Usage:  DATABASE_URL=postgresql://... node db/migrate.mjs
 *    or:  pnpm migrate   (reads DATABASE_URL from the environment / .env)
 *
 * The `pg` driver is borrowed from the api package's node_modules via
 * createRequire (see db/README.md) so the repo root needs no extra dependency.
 */
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, 'migrate.mjs'));
// Resolves to <repo>/packages/api/node_modules/pg — the api package owns the dep.
const { Client } = require('../packages/api/node_modules/pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('migrate: DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const dir = path.join(here, 'migrations');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  console.log('migrate: no migration files found');
  process.exit(0);
}

let failed = false;
for (const file of files) {
  const client = new Client({ connectionString: DATABASE_URL });
  const sql = await readFile(path.join(dir, file), 'utf8');
  process.stdout.write(`migrate: applying ${file} ... `);
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('ok');
  } catch (err) {
    failed = true;
    try {
      await client.query('ROLLBACK');
    } catch {
      /* already broken; nothing to roll back */
    }
    console.log('FAILED');
    console.error(err instanceof Error ? err.message : err);
    await client.end().catch(() => {});
    break;
  }
  await client.end();
}

if (failed) {
  console.error('migrate: stopped on first failure');
  process.exit(1);
}
console.log(`migrate: ${files.length} migration(s) applied`);
