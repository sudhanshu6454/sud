#!/usr/bin/env node
/**
 * Applies db/migrations/*.sql in lexical order, one transaction per file,
 * and records each applied file in `schema_migrations`.
 *
 * Usage:  DATABASE_URL=postgresql://... node db/migrate.mjs             # apply pending
 *         DATABASE_URL=postgresql://... node db/migrate.mjs --status    # list applied / pending
 *         DATABASE_URL=postgresql://... node db/migrate.mjs --baseline  # record present files as applied WITHOUT running them
 *    or:  pnpm migrate   (reads DATABASE_URL from the environment / .env)
 *
 * Tracking: `schema_migrations (filename text primary key, applied_at
 * timestamptz not null default now())` is created if absent. A file already
 * recorded there is skipped; each file that runs is recorded inside the same
 * transaction as its SQL, so a failed file leaves neither schema nor record.
 *
 * Databases created before tracking existed (schema already at the latest
 * file, no `schema_migrations` table) make a plain run fail loudly on 0001
 * ("relation ... already exists"). That failure is the signal to run
 * `--baseline`, which records every present file as applied without
 * executing it. Baseline trusts the operator: it does not verify the schema.
 *
 * The `pg` driver is borrowed from the api package's node_modules via
 * createRequire (see db/README.md) so the repo root needs no extra dependency.
 *
 * `runMigrations(databaseUrl, opts)` is exported for other scripts (the
 * money-loop demo applies the same files to a scratch Postgres with it); the
 * CLI below only runs when this file is the entrypoint.
 */
import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, 'migrate.mjs'));
// Resolves to <repo>/packages/api/node_modules/pg — the api package owns the dep.
const { Client } = require('../packages/api/node_modules/pg');

export const MIGRATIONS_DIR = path.join(here, 'migrations');

const TRACKING_TABLE_SQL = `create table if not exists schema_migrations (
  filename text primary key,
  applied_at timestamptz not null default now()
)`;

// Postgres error codes that mean "this object is already there": the
// signature of a database whose schema predates migration tracking.
const ALREADY_EXISTS_CODES = new Set([
  '42P07', // duplicate_table
  '42701', // duplicate_column
  '42710', // duplicate_object (constraint, index, extension ...)
  '42723', // duplicate_function
]);

export class MigrationError extends Error {
  /**
   * @param {string} message
   * @param {{ file?: string, code?: string, hint?: string, cause?: unknown }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'MigrationError';
    this.file = info.file;
    this.code = info.code;
    this.hint = info.hint;
    this.cause = info.cause;
  }
}

/** Lexically sorted *.sql filenames in the migrations directory. */
export async function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
}

async function trackingTableExists(client) {
  const { rows } = await client.query(`select to_regclass('public.schema_migrations') as t`);
  return rows[0]?.t != null;
}

async function readApplied(client) {
  const { rows } = await client.query(
    `select filename, applied_at::text as applied_at from schema_migrations order by filename`,
  );
  return rows.map((r) => ({ filename: String(r.filename), appliedAt: String(r.applied_at) }));
}

/**
 * Run the migration runner against `databaseUrl`.
 *
 * @param {string} databaseUrl
 * @param {{
 *   mode?: 'apply' | 'baseline' | 'status',
 *   dir?: string,
 *   log?: (line: string) => void,
 * }} [opts]
 * @returns {Promise<{
 *   mode: 'apply' | 'baseline' | 'status',
 *   files: string[],
 *   applied: string[],      // files this call executed (apply mode)
 *   recorded: string[],     // files this call recorded (apply + baseline modes)
 *   skipped: string[],      // files already recorded before this call
 *   pending: string[],      // files not recorded when this call finished
 *   trackingTable: boolean, // whether schema_migrations exists when this call finished
 * }>}
 *
 * Throws MigrationError on the first failing file (nothing after it runs);
 * the failed file's own transaction is rolled back.
 */
export async function runMigrations(databaseUrl, opts = {}) {
  const mode = opts.mode ?? 'apply';
  const dir = opts.dir ?? MIGRATIONS_DIR;
  const log = opts.log ?? (() => {});
  if (!databaseUrl) throw new MigrationError('migrate: DATABASE_URL is not set (see .env.example)');
  if (!['apply', 'baseline', 'status'].includes(mode)) {
    throw new MigrationError(`migrate: unknown mode '${mode}'`);
  }

  const files = await listMigrationFiles(dir);
  const result = {
    mode,
    files,
    applied: [],
    recorded: [],
    skipped: [],
    pending: [],
    trackingTable: false,
  };

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    // -- status: read-only ---------------------------------------------------
    if (mode === 'status') {
      result.trackingTable = await trackingTableExists(client);
      const applied = result.trackingTable ? await readApplied(client) : [];
      const appliedSet = new Set(applied.map((a) => a.filename));
      for (const f of files) {
        if (appliedSet.has(f)) result.skipped.push(f);
        else result.pending.push(f);
      }
      // Files recorded in the table but missing from disk are worth knowing about.
      result.unknownRecorded = applied.map((a) => a.filename).filter((f) => !files.includes(f));
      result.appliedAt = Object.fromEntries(applied.map((a) => [a.filename, a.appliedAt]));
      return result;
    }

    await client.query(TRACKING_TABLE_SQL);
    result.trackingTable = true;
    const already = new Set((await readApplied(client)).map((a) => a.filename));

    if (files.length === 0) {
      log('migrate: no migration files found');
      return result;
    }

    for (const file of files) {
      if (already.has(file)) {
        result.skipped.push(file);
        log(`migrate: skipping ${file} (already recorded)`);
        continue;
      }

      // -- baseline: record without running ----------------------------------
      if (mode === 'baseline') {
        await client.query(`insert into schema_migrations (filename) values ($1)`, [file]);
        result.recorded.push(file);
        log(`migrate: baseline recorded ${file} (not executed)`);
        continue;
      }

      // -- apply: run + record in one transaction ----------------------------
      const sql = await readFile(path.join(dir, file), 'utf8');
      log(`migrate: applying ${file} ...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(`insert into schema_migrations (filename) values ($1)`, [file]);
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* already broken; nothing to roll back */
        }
        const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : undefined;
        const message = err instanceof Error ? err.message : String(err);
        let hint;
        if (code && ALREADY_EXISTS_CODES.has(code) && result.applied.length === 0) {
          hint =
            'The schema already contains objects this file creates, and schema_migrations has no ' +
            'record of it. If this database was created before migration tracking existed and its ' +
            'schema is already current, record the present files without running them: ' +
            'node db/migrate.mjs --baseline   (then re-run node db/migrate.mjs; it will be a no-op). ' +
            'If the schema is NOT current, do not baseline: fix the database by hand first.';
        }
        throw new MigrationError(`migrate: ${file} FAILED: ${message}`, { file, code, hint, cause: err });
      }
      result.applied.push(file);
      result.recorded.push(file);
      log(`migrate: applied ${file}`);
    }
    return result;
  } finally {
    await client.end().catch(() => {});
  }
}

// -- CLI ---------------------------------------------------------------------
const isMainEntry =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainEntry) {
  const args = process.argv.slice(2);
  let mode = 'apply';
  for (const a of args) {
    if (a === '--baseline') mode = 'baseline';
    else if (a === '--status') mode = 'status';
    else if (a === '--help' || a === '-h') {
      console.log('usage: node db/migrate.mjs [--status | --baseline]');
      process.exit(0);
    } else {
      console.error(`migrate: unknown argument '${a}' (expected --status or --baseline)`);
      process.exit(2);
    }
  }

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('migrate: DATABASE_URL is not set (see .env.example)');
    process.exit(1);
  }

  try {
    const r = await runMigrations(DATABASE_URL, { mode, log: (l) => console.log(l) });
    if (mode === 'status') {
      if (!r.trackingTable) {
        console.log(
          'migrate: no schema_migrations table — nothing is recorded as applied. ' +
            'A fresh database: run node db/migrate.mjs. A database whose schema is already current: ' +
            'run node db/migrate.mjs --baseline.',
        );
      }
      for (const f of r.files) {
        const at = r.appliedAt?.[f];
        console.log(`  ${at ? 'applied' : 'pending'}  ${f}${at ? `  (${at})` : ''}`);
      }
      for (const f of r.unknownRecorded ?? []) {
        console.log(`  recorded but not on disk  ${f}`);
      }
      console.log(`migrate: ${r.skipped.length} applied, ${r.pending.length} pending`);
      process.exit(0);
    }
    if (mode === 'baseline') {
      console.log(
        `migrate: baseline recorded ${r.recorded.length} file(s), ${r.skipped.length} already recorded`,
      );
      process.exit(0);
    }
    console.log(
      `migrate: ${r.applied.length} migration(s) applied, ${r.skipped.length} already applied`,
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof MigrationError) {
      console.error(err.message);
      if (err.hint) console.error(`migrate: ${err.hint}`);
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    console.error('migrate: stopped on first failure');
    process.exit(1);
  }
}
