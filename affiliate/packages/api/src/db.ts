import { Pool, type QueryResult, type QueryResultRow } from 'pg';

/**
 * TENANT-SCOPING INVARIANT
 * ========================
 * Every SQL query issued by the API MUST be scoped to a single organisation.
 * Convention: `$1` is ALWAYS the tenant's `org_id`, and every query string
 * must reference `org_id` (the `tenantQuery` helper enforces this at runtime).
 * There are no cross-org reads or writes anywhere in this service.
 *
 * Money columns are `bigint` in Postgres; `pg` returns them as strings.
 * Convert with `Number(...)` and validate via `assertMinorUnits` from
 * `@paparazzi/shared` before doing arithmetic. See src/finance.ts.
 */

if (!process.env.DATABASE_URL) {
  // Fail fast: running without a database would silently break the invariant above.
  throw new Error('DATABASE_URL is required');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Modest pool; the API is I/O-bound on short tenant-scoped queries.
  max: 20,
});

/**
 * Test seam (exact contract name — the demo/test harnesses depend on it).
 *
 * Swaps the pool that `tenantQuery` (and, via `getPool()`, the finance
 * helpers and route handlers) use. Production behavior is unchanged: the
 * module-level `pool` above stays the default until someone calls this.
 * Used with pg-mem's pg adapter to exercise DB-touching logic without a
 * real Postgres.
 */
let activePool: Pool = pool;

export function __setPool(p: Pool): void {
  activePool = p;
}

/** The pool currently in effect (module default, or the test override). */
export function getPool(): Pool {
  return activePool;
}

/**
 * Run a tenant-scoped query. `$1` is always the org_id; remaining params
 * follow in order. Throws if the query text does not reference `org_id`,
 * so an unscoped query fails loudly instead of leaking cross-tenant data.
 */
export async function tenantQuery<T extends QueryResultRow = QueryResultRow>(
  orgId: string,
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  if (!/\borg_id\b/.test(text)) {
    throw new Error('tenantQuery invariant violated: query text must reference org_id');
  }
  return activePool.query<T>(text, [orgId, ...params]);
}
