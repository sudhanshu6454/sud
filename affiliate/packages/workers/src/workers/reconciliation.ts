/**
 * reconciliation worker — STUB.
 *
 * Compares the stub connector's exported reconciliation lines for a date range
 * against the `conversions` table per programme and logs gaps (missing lines,
 * count mismatches, commission total mismatches).
 *
 * Real statement matching (line-level matching, partial collections, FX
 * differences, dispute creation) is a finance-owned TODO — this stub only
 * proves the comparison plumbing.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { StubNetworkConnector } from '../connectors/stub-network';
import { stubProgramme } from '../connectors/fixtures';
import { QUEUE_RECONCILIATION, createRedisConnection } from '../queues';
import { createLogger, errorMessage } from '../logging';

const log = createLogger('worker:reconciliation');

export interface ReconciliationJobData {
  org_id: string;
  /** ISO start (inclusive). Defaults to 24h ago. */
  from?: string;
  /** ISO end (exclusive). Defaults to now. */
  to?: string;
}

interface ProgrammeTotals {
  programme_id: string;
  count: number;
  total_commission_minor: number;
}

export function createReconciliationProcessor(pool: Pool, connector = new StubNetworkConnector()) {
  return async function processReconciliation(job: Job<ReconciliationJobData>): Promise<void> {
    const { org_id: orgId } = job.data;
    const to = job.data.to ?? new Date().toISOString();
    const from =
      job.data.from ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    log('info', 'reconciliation run started', { jobId: job.id, from, to });

    // Provider side: what the connector says happened in the range.
    // ReconciliationLine carries no programme_id, and the stub connector is
    // single-programme in the demo, so all stub lines are attributed to the
    // stub programme for comparison. A real connector's export would be
    // grouped by its own programme/account mapping.
    const lines = await connector.exportReconciliation({ from, to });
    const providerTotals: ProgrammeTotals = {
      programme_id: stubProgramme.id,
      count: lines.length,
      total_commission_minor: lines.reduce((sum, line) => sum + line.commission_minor, 0),
    };

    // Our side: normalised conversions in the range (declined excluded — they
    // carry no payable commission).
    const { rows } = await pool.query<{
      programme_id: string;
      count: string;
      total_commission_minor: string;
    }>(
      `select programme_id,
              count(*) as count,
              coalesce(sum(commission_minor), 0) as total_commission_minor
       from conversions
       where org_id = $1
         and occurred_at >= $2
         and occurred_at < $3
         and status <> 'declined'
       group by programme_id`,
      [orgId, from, to],
    );

    const programmeIds = new Set<string>([
      providerTotals.programme_id,
      ...rows.map((r) => r.programme_id),
    ]);

    let gaps = 0;
    for (const programmeId of programmeIds) {
      const dbRow = rows.find((r) => r.programme_id === programmeId);
      const dbCount = dbRow ? Number(dbRow.count) : 0;
      const dbTotal = dbRow ? Number(dbRow.total_commission_minor) : 0;
      const isStubProgramme = programmeId === providerTotals.programme_id;
      const providerCount = isStubProgramme ? providerTotals.count : 0;
      const providerTotal = isStubProgramme ? providerTotals.total_commission_minor : 0;

      if (providerCount !== dbCount || providerTotal !== dbTotal) {
        gaps += 1;
        log('warn', 'reconciliation gap', {
          jobId: job.id,
          programme_id: programmeId,
          provider_count: providerCount,
          db_count: dbCount,
          provider_commission_minor: providerTotal,
          db_commission_minor: dbTotal,
        });
      }
    }

    log('info', 'reconciliation run finished', {
      jobId: job.id,
      programmes_compared: programmeIds.size,
      gaps,
    });

    // TODO: statement line matching + dispute creation (finance-owned):
    // match individual lines by (provider_account_id, source_transaction_id, line_id),
    // surface unmatched items, partial collections and FX differences, and open
    // disputes with evidence links. See brief §9 settlement controls.
  };
}

export function createReconciliationWorker(
  pool: Pool,
  connection?: Redis,
): Worker<ReconciliationJobData> {
  const worker = new Worker<ReconciliationJobData>(
    QUEUE_RECONCILIATION,
    createReconciliationProcessor(pool),
    { connection: connection ?? createRedisConnection() },
  );
  worker.on('failed', (job, error) => {
    log('error', 'job failed', { jobId: job?.id, error: errorMessage(error) });
  });
  return worker;
}
