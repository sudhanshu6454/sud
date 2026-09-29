/**
 * DPDP-aligned retention purge.
 *
 * WHAT IT DOES
 * ------------
 * Three data classes, three windows (see ./config.ts):
 *
 *   click_context   clicks.context      — raw click metadata payloads.
 *                     Nulled (SET NULL) when clicks.occurred_at is older than
 *                     the window.
 *   conversion_raw  conversions.raw     — raw provider event payloads.
 *                     Nulled (SET NULL) when conversions.received_at is older
 *                     than the window.
 *   outbox          outbox (whole row)  — published relay rows only
 *                     (published_at IS NOT NULL and older than the window).
 *                     The outbox relay is at-least-once and consumers dedupe
 *                     on envelope.event_id, so a relayed row carries no
 *                     information that isn't already downstream.
 *
 * WHY NULLING, NOT DELETING (clicks / conversions)
 * -------------------------------------------------
 * conversions.click_id → clicks(id) is a foreign key, and ledger_entries /
 * adjustments reference conversions(id). Deleting click or conversion rows
 * would break referential integrity and destroy the audit trail that the
 * ledger balances are derived from. Nulling only the free-text payload
 * columns keeps every row, key, and money figure intact while the raw
 * (potentially personal-data-bearing) blobs age out.
 *
 * INVARIANTS (enforced by construction — this module's SQL never names
 * these tables except to INSERT the audit row)
 * ---------------------------------------------------------------------
 * - ledger_entries, audit_log and adjustments are NEVER modified or deleted
 *   by the purge. Accounting records survive deletion requests (counsel
 *   briefing §1); the ledger is append-only and auditable forever.
 * - Publisher statements stay reproducible: earnings derive from
 *   ledger_entries balances and conversion money columns, never from the
 *   nulled payload blobs (tested in test/retention.test.ts).
 *
 * TENANCY
 * -------
 * The purge loops organisations and runs one transaction per org: the three
 * class statements plus the three audit rows commit atomically per tenant.
 * Every statement carries an explicit org_id predicate.
 *
 * AUDIT
 * -----
 * Each run writes one audit_log row per org per class:
 *   action    = 'retention.purge'
 *   entity    = '<class>'            (click_context | conversion_raw | outbox)
 *   entity_id = '{"window_days":N,"rows_affected":M}'   (machine-readable)
 *   actor_id  = NULL                 (system job, no human actor)
 * Rows are written even when rows_affected = 0 — the row is evidence the
 * scheduled purge ran for that tenant. audit_log itself is never purged.
 */

import type { Pool, PoolClient } from 'pg';
import { createLogger, errorMessage } from '../logging';
import type { RetentionConfig } from './config';

const log = createLogger('retention:purge');

/** Data classes the purge handles. Ledger / audit / adjustments are never among them. */
export const RETENTION_CLASSES = ['click_context', 'conversion_raw', 'outbox'] as const;

export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export interface PurgeClassResult {
  class: RetentionClass;
  window_days: number;
  rows_affected: number;
}

export interface OrgPurgeResult {
  org_id: string;
  dry_run: boolean;
  classes: PurgeClassResult[];
}

export interface RunRetentionPurgeOptions {
  /**
   * When true, counts what would be purged and reports it, but writes
   * nothing — no payload nulling, no outbox deletes, no audit rows.
   */
  dryRun?: boolean;
}

interface ClassSpec {
  class: RetentionClass;
  windowDays: number;
  /**
   * Which timestamp the window is measured from. Documented per class:
   * - click_context:  clicks.occurred_at      (the click event the payload describes)
   * - conversion_raw: conversions.received_at (when the platform took in the provider report)
   * - outbox:         outbox.published_at     (when relay completed; also the
   *                   non-null guard that keeps unrelayed rows forever)
   */
  measuredFrom: string;
  /** Count query for dry-run: ($1 org_id, $2 cutoff timestamptz) -> { n }. */
  countSql: string;
  /** Purge statement: ($1 org_id, $2 cutoff timestamptz). rowCount = rows_affected. */
  purgeSql: string;
}

function classSpecs(config: RetentionConfig): ClassSpec[] {
  return [
    {
      class: 'click_context',
      windowDays: config.clickContextDays,
      measuredFrom: 'clicks.occurred_at',
      countSql: `select count(*)::int as n from clicks
                  where org_id = $1 and context is not null and occurred_at < $2`,
      purgeSql: `update clicks set context = null
                  where org_id = $1 and context is not null and occurred_at < $2`,
    },
    {
      class: 'conversion_raw',
      windowDays: config.conversionRawDays,
      measuredFrom: 'conversions.received_at',
      countSql: `select count(*)::int as n from conversions
                  where org_id = $1 and raw is not null and received_at < $2`,
      purgeSql: `update conversions set raw = null
                  where org_id = $1 and raw is not null and received_at < $2`,
    },
    {
      class: 'outbox',
      windowDays: config.outboxDays,
      measuredFrom: 'outbox.published_at',
      // NOTE on the coalesce() formulation: `published_at is not null and
      // published_at < $2` is the idiomatic form, but pg-mem misuses the
      // partial index `idx_outbox_unpublished ... where published_at is null`
      // and returns zero rows for any bare-column predicate on published_at
      // (verified: plain table without the index works; with it, `is not
      // null` matches nothing). The coalesce form is semantically identical
      // on real Postgres — a NULL published_at becomes now(), which is never
      // older than a past cutoff, so unrelayed rows are still never deleted —
      // and it evaluates correctly under pg-mem because it is an expression,
      // not a bare column reference. One SQL path serves prod and tests.
      countSql: `select count(*)::int as n from outbox
                  where org_id = $1 and coalesce(published_at, now()) < $2`,
      purgeSql: `delete from outbox
                  where org_id = $1 and coalesce(published_at, now()) < $2`,
    },
  ];
}

/** Cutoff instant: rows strictly older than this are purged. Computed in TS
 *  (not SQL interval math) so the comparison is portable across pg-mem and
 *  real Postgres. */
function cutoffFor(windowDays: number): Date {
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
}

type Queryable = Pick<PoolClient, 'query'>;

/**
 * One audit row per (org, class, run). entity_id is a JSON blob so the
 * machine-readable summary (window + affected rows) survives the audit_log
 * schema, which has no details column. Convention documented here and in
 * packages/workers/README.md.
 */
async function writeAuditRow(
  db: Queryable,
  orgId: string,
  cls: RetentionClass,
  windowDays: number,
  rowsAffected: number,
): Promise<void> {
  const entityId = JSON.stringify({ window_days: windowDays, rows_affected: rowsAffected });
  await db.query(
    `insert into audit_log (org_id, actor_id, action, entity, entity_id)
     values ($1, null, 'retention.purge', $2, $3)`,
    [orgId, cls, entityId],
  );
}

/**
 * Run the retention purge for every organisation.
 *
 * Per org: one transaction covering the three class statements plus the
 * three audit rows (atomic per tenant). With dryRun, only counts are
 * reported — nothing is written anywhere.
 *
 * Returns per-org, per-class results (rows_affected per class).
 */
export async function runRetentionPurge(
  pool: Pool,
  config: RetentionConfig,
  options: RunRetentionPurgeOptions = {},
): Promise<OrgPurgeResult[]> {
  const dryRun = options.dryRun ?? false;
  const specs = classSpecs(config);

  const { rows: orgRows } = await pool.query<{ id: string }>(
    `select id from organisations order by id`,
  );

  const results: OrgPurgeResult[] = [];
  for (const orgRow of orgRows) {
    const orgId = String(orgRow.id);
    const classes: PurgeClassResult[] = [];

    if (dryRun) {
      for (const spec of specs) {
        const { rows } = await pool.query<{ n: number }>(spec.countSql, [
          orgId,
          cutoffFor(spec.windowDays),
        ]);
        classes.push({
          class: spec.class,
          window_days: spec.windowDays,
          rows_affected: Number(rows[0]?.n ?? 0),
        });
      }
      log('info', 'retention dry-run: nothing written', { org_id: orgId, classes });
    } else {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const spec of specs) {
          const res = await client.query(spec.purgeSql, [orgId, cutoffFor(spec.windowDays)]);
          const rowsAffected = res.rowCount ?? 0;
          await writeAuditRow(client, orgId, spec.class, spec.windowDays, rowsAffected);
          classes.push({ class: spec.class, window_days: spec.windowDays, rows_affected: rowsAffected });
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        log('error', 'retention purge failed for org; rolled back', {
          org_id: orgId,
          error: errorMessage(error),
        });
        throw error;
      } finally {
        client.release();
      }
      const total = classes.reduce((sum, c) => sum + c.rows_affected, 0);
      log('info', 'retention purge completed for org', {
        org_id: orgId,
        rows_affected_total: total,
        classes,
      });
    }

    results.push({ org_id: orgId, dry_run: dryRun, classes });
  }

  return results;
}
