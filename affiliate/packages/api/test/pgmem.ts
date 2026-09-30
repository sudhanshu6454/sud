import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';

/**
 * pg-mem test-database factory.
 *
 * pg-mem is an in-memory Postgres reimplementation — good enough for the
 * money-loop tests, but NOT Postgres. Known limitations that bite here:
 *
 * - No real extensions: `create extension "pgcrypto"` is stripped below and
 *   `gen_random_uuid()` is registered as a plain JS function instead.
 * - Exotic constraints are parsed but not all are enforced the way Postgres
 *   enforces them (e.g. `unique nulls not distinct` is rewritten to plain
 *   `unique` because pg-mem chokes on the NULLS NOT DISTINCT syntax; plain
 *   `unique` treats NULLs as distinct, so tests that exercise dedupe with a
 *   NULL line_id must supply an explicit line_id instead).
 * - `alter table ... drop constraint <name>` for inline CHECK constraints:
 *   Postgres auto-names an inline check `ledger_entries_account_check`, but
 *   pg-mem names it `ledger_entries_constraint_1` (N = creation order among
 *   CHECKs on that table; the account check is the first CHECK in
 *   ledger_entries). The name is rewritten below. (UNIQUE constraints keep
 *   their Postgres-style names in pg-mem, so those DROP statements are left
 *   verbatim.) Verified against pg-mem 3.0.14 (pinned in pnpm-lock.yaml); if
 *   a pg-mem upgrade renames these, migration application will fail loudly
 *   here rather than silently misbehaving.
 * - `INSERT ... ON CONFLICT (<cols>) DO NOTHING ... RETURNING` returns the
 *   conflicting row instead of zero rows; the helper rewrites these to the
 *   target-less form (which pg-mem implements correctly). See
 *   rewriteOnConflict below.
 * - `on conflict ... do nothing` is supported and is what these tests rely
 *   on for dedupe assertions.
 * - pg-mem returns bigint columns as JS numbers (not strings) in some paths;
 *   tests coerce with Number(...) rather than assuming string types.
 * - Transactions: BEGIN / COMMIT / ROLLBACK are accepted on pool clients,
 *   but a ROLLBACK sent as its own statement (how the app issues it) undoes
 *   NOTHING in pg-mem 3.0.14 — verified 2026-09-29: begin, update, rollback
 *   as three client.query calls leaves the update in place (only a single
 *   multi-statement string rolls back). `createTestDb({ rollback: true })`
 *   emulates it: BEGIN on a pooled client takes `db.backup()`, ROLLBACK
 *   restores it, COMMIT drops it. There is no isolation: the restore is
 *   database-wide, so writes other connections made in between are undone
 *   too — only for suites whose transactions run one at a time.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'db', 'migrations');

export interface TestDatabase {
  db: IMemoryDb;
  /**
   * pg-mem's pg-compatible Pool class, wrapped with the ON CONFLICT fidelity
   * shim below. Instantiate with `new Pool()`.
   */
  Pool: new () => {
    query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    connect: () => Promise<{
      query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
      release: () => void;
    }>;
    end: () => Promise<void>;
  };
}

/**
 * pg-mem fidelity shim.
 *
 * pg-mem mishandles `INSERT ... ON CONFLICT (<cols>) DO NOTHING ... RETURNING`:
 * on a conflict it returns the EXISTING row instead of zero rows (real
 * Postgres returns zero). The app's dedupe branches key on
 * `rows.length === 0`, so without this shim every duplicate delivery would
 * look like a fresh insert under pg-mem.
 *
 * The target-less form (`ON CONFLICT DO NOTHING`) IS implemented correctly
 * by pg-mem, so the shim drops the column target. This is semantics-preserving
 * for every statement in this repo: the column-targeted unique is always the
 * only constraint that can plausibly conflict (primary keys are random UUIDs
 * minted per attempt), and statements that ignore the result are unaffected
 * either way. `DO UPDATE` forms are left untouched.
 */
function rewriteOnConflict(text: string): string {
  return text.replace(/on\s+conflict\s*\([^)]*\)\s*do\s+nothing/gi, 'on conflict do nothing');
}

/**
 * pg-mem cannot cast timestamptz -> text ("cannot cast type timestamp with
 * time zone to text"); real Postgres can. The app casts timestamps to text
 * only to normalize the driver's string form — every consumer feeds the
 * value to `new Date(...)`, which also accepts the Date objects pg-mem
 * returns natively. So the cast is rewritten away for known timestamp
 * columns. bigint -> text casts are left alone (pg-mem handles those).
 */
function rewriteTimestampCasts(text: string): string {
  return text.replace(
    /\b(occurred_at|received_at|created_at|published_at|fresh_until|last_status_query_at|collected_at|verified_at|expires_at|granted_at|withdrawn_at)::text\b/gi,
    '$1',
  );
}

/**
 * pg-mem does not evaluate `col = any($N)` when $N is bound to a JS array —
 * it silently matches zero rows (real Postgres expands the array). Expand
 * such predicates into an OR-chain, splicing the array elements into the
 * parameter list and renumbering later placeholders. Predicates whose
 * parameter is not a JS array are left untouched.
 */
function expandAnyParams(
  text: string,
  params: unknown[],
): { text: string; params: unknown[] } {
  const anyRe = /([\w."]+)\s*=\s*any\(\$(\d+)\)(?!\d)/gi;
  type AnyMatch = { start: number; end: number; col: string; idx: number; values: unknown[] };
  const matches: AnyMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = anyRe.exec(text)) !== null) {
    const idx = Number(m[2]);
    const v = params[idx - 1];
    if (Array.isArray(v)) {
      matches.push({ start: m.index, end: m.index + m[0].length, col: m[1], idx, values: v });
    }
  }
  if (matches.length === 0) return { text, params };

  // New parameter list + old->new index map (1-based).
  const indexMap = new Map<number, number[]>();
  const newParams: unknown[] = [];
  for (let i = 1; i <= params.length; i++) {
    const mt = matches.find((x) => x.idx === i);
    const nums: number[] = [];
    if (mt) {
      for (const v of mt.values) {
        newParams.push(v);
        nums.push(newParams.length);
      }
    } else {
      newParams.push(params[i - 1]);
      nums.push(newParams.length);
    }
    indexMap.set(i, nums);
  }

  const renumber = (chunk: string): string =>
    chunk.replace(/\$(\d+)(?!\d)/g, (_s, n) => {
      const mapped = indexMap.get(Number(n));
      return mapped && mapped[0] !== undefined ? `$${mapped[0]}` : `$${n}`;
    });

  let out = '';
  let pos = 0;
  for (const mt of matches) {
    out += renumber(text.slice(pos, mt.start));
    const nums = indexMap.get(mt.idx) ?? [];
    out += nums.length === 0 ? '(false)' : `(${nums.map((n) => `${mt.col} = $${n}`).join(' or ')})`;
    pos = mt.end;
  }
  out += renumber(text.slice(pos));
  return { text: out, params: newParams };
}

/** Apply all pg-mem SQL fidelity shims (each documented above). */
function rewriteForPgMem(text: string): string {
  return rewriteTimestampCasts(rewriteOnConflict(text));
}

/**
 * pg-mem types every bound parameter as `text` inside a SELECT list — even
 * when the JS value is a number — and then rejects `insert ... select`
 * when a select item's type does not match the target column. Real Postgres
 * coerces the unknown-typed parameter to the column type instead. The app
 * passes String(amount_minor) for the payout_items insert, which is valid on
 * Postgres. Rewrite the SELECT-list amount placeholder with an explicit
 * `::bigint` cast (the column's real type) so pg-mem accepts it. Scoped to
 * the payout_items insert; the numeric-string parameter is located by value
 * rather than by position so tenantQuery's org_id prepend does not matter.
 */
function coercePayoutItemAmount(
  text: string,
  params: unknown[],
): { text: string; params: unknown[] } {
  if (!/insert\s+into\s+payout_items/i.test(text)) return { text, params };
  const idx = params.findIndex((p) => typeof p === 'string' && /^-?\d+$/.test(p));
  if (idx < 0) return { text, params };
  const placeholder = `$${idx + 1}`;
  const newText = text.replace(
    new RegExp(`(select[\\s\\S]*?)${placeholder.replace('$', '\\$')}(?!\\d)`, 'i'),
    `$1${placeholder}::bigint`,
  );
  const next = [...params];
  next[idx] = Number(params[idx]);
  return { text: newText, params: next };
}

/** Rewrite text shims, coerce strict params, then expand any($N) array params. */
function adaptQuery(
  text: string,
  params: unknown[] | undefined,
): { text: string; params: unknown[] } {
  const c = coercePayoutItemAmount(text, params ?? []);
  return expandAnyParams(rewriteForPgMem(c.text), c.params);
}

/**
 * Build a fresh in-memory database with every migration in db/migrations
 * applied in lexical order. Each test file should call this in beforeAll (or
 * beforeEach for full isolation) — pg-mem databases are cheap to create.
 */
export function createTestDb(opts: { rollback?: boolean } = {}): TestDatabase {
  const db = newDb();

  // Stand-in for the pgcrypto extension: the schema only uses gen_random_uuid().
  // impure: true is ESSENTIAL — pg-mem simplifies "pure" functions by
  // evaluating them once and reusing the result, which would hand every row
  // the same UUID and break primary keys.
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    impure: true,
    implementation: () => randomUUID(),
  });

  // char_length(text): a Postgres builtin pg-mem lacks; 0007's CHECKs use it
  // (length bounds of names, labels, evidence). Characters, not bytes, as in
  // Postgres.
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (t: string | null) => (t === null || t === undefined ? null : [...t].length),
  });

  // Advisory locks (the Amazon report import runs one file at a time per
  // account, src/amazon/report-import.ts): pg-mem has none, so they are
  // emulated database-wide with a set of held keys — enough for the tests to
  // hold a lock and see a second import refused. No session semantics.
  const heldLocks = new Set<number>();
  db.public.registerFunction({
    name: 'hashtext',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (t: string) => {
      let h = 0;
      for (let i = 0; i < t.length; i += 1) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0;
      return h;
    },
  });
  db.public.registerFunction({
    name: 'pg_try_advisory_lock',
    args: [DataType.integer],
    returns: DataType.bool,
    impure: true,
    implementation: (k: number) => {
      if (heldLocks.has(k)) return false;
      heldLocks.add(k);
      return true;
    },
  });
  db.public.registerFunction({
    name: 'pg_advisory_unlock',
    args: [DataType.integer],
    returns: DataType.bool,
    impure: true,
    implementation: (k: number) => heldLocks.delete(k),
  });

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error(`no migrations found in ${MIGRATIONS_DIR}`);
  }
  for (const file of files) {
    let sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // pg-mem has no extension mechanism.
    sql = sql.replace(/^\s*create extension[^;]*;/gim, '');
    // pg-mem does not parse `unique nulls not distinct`.
    sql = sql.replace(/unique nulls not distinct/gi, 'unique');
    // pg-mem evaluates a CHECK of `col in (…)` on a NULL as false (Postgres: unknown, so the row passes).
    // look_items.match_type is nullable by design (an Amazon shelf item has no verdict: "Unverified match"):
    // the Postgres meaning is spelled out for pg-mem.
    sql = sql.replace(/match_type text check \(match_type in \('exact','similar'\)\)/gi, "match_type text check (match_type is null or match_type in ('exact','similar'))");
    // pg-mem names inline CHECK constraints <table>_constraint_<N>, not the
    // Postgres auto-name <table>_<column>_check (see header comment).
    sql = sql.replace(
      /drop constraint ledger_entries_account_check/gi,
      'drop constraint ledger_entries_constraint_1',
    );
    // Same for the memberships role check (0007 adds 'rights_reviewer'): the
    // first CHECK of memberships, auto-named memberships_role_check by Postgres.
    sql = sql.replace(/drop constraint memberships_role_check/gi, 'drop constraint memberships_constraint_1');
    // Partial indexes (0007): pg-mem answers ANY query whose WHERE shares a
    // predicate with a partial index's WHERE (even just `piece_id is not
    // null`) from that index alone, returning only its rows (verified
    // 2026-09-30 on pg-mem 3.0.14). So:
    //   - the two whose predicate is only `<col> is not null` become plain
    //     unique indexes (NULLs are distinct: the same constraint);
    //   - the two look_items ones (one EXACT per piece, a product once per
    //     piece, over rows not removed) are not created here; the API
    //     pre-checks both (409), and scripts/celebrity-looks-pg.ts proves the
    //     indexes themselves on a real PostgreSQL.
    sql = sql.replace(/(create unique index uq_(?:assets_org_kind_key|looks_org_library_ref) on [^;]*?\))\s*where [^;]*;/gi, '$1;');
    sql = sql.replace(/create unique index uq_look_items_piece_(?:exact|variant) on[^;]*;/gi, '');
    db.public.none(sql);
  }

  const adapters = db.adapters.createPg();
  const BasePool = adapters.Pool as unknown as new () => {
    query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
    connect: () => Promise<{
      query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
      release: () => void;
    }>;
    end: () => Promise<void>;
  };

  // Wrap query entry points so the ON CONFLICT shim applies to both
  // pool.query and pooled-client.query (the workers use client.query inside
  // transactions).
  class TestPool extends BasePool {
    override async query(text: string, params?: unknown[]) {
      const adapted = adaptQuery(text, params);
      return super.query(adapted.text, adapted.params);
    }
    override async connect() {
      const client = await super.connect();
      const origQuery = client.query.bind(client);
      // Only with opts.rollback (see the header): BEGIN snapshots the whole
      // database, ROLLBACK restores it, COMMIT forgets it.
      let snapshot: ReturnType<IMemoryDb['backup']> | null = null;
      client.query = ((t: string, p?: unknown[]) => {
        if (opts.rollback) {
          const verb = t.trim().replace(/;$/, '').toLowerCase();
          if (verb === 'begin') snapshot = db.backup();
          else if (verb === 'commit') snapshot = null;
          else if (verb === 'rollback' && snapshot) {
            snapshot.restore();
            snapshot = null;
            return Promise.resolve({ rows: [] });
          }
        }
        const adapted = adaptQuery(t, p);
        return origQuery(adapted.text, adapted.params);
      }) as typeof client.query;
      return client;
    }
  }

  return { db, Pool: TestPool };
}
