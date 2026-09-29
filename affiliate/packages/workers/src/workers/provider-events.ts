/**
 * provider-events worker.
 *
 * Normalises raw provider conversion notifications (webhooks, polled reports,
 * manual imports) into the `conversions` table, idempotently:
 *
 *   1. Verify the event envelope integrity (hashPayload vs payload_hash).
 *   2. Validate the RawConversion shape; assert money fields are integer minor units.
 *   3. Resolve the programme from job data (the API knows the integration it
 *      came from; RawConversion carries no programme_id by design).
 *   4. Resolve returned_click_ref -> clicks.id. On NO match the conversion is
 *      stored with click_id = NULL (the suspense queue). WE NEVER GUESS.
 *   5. INSERT ... ON CONFLICT (provider_account_id, source_transaction_id, line_id)
 *      DO NOTHING — duplicate deliveries collapse to one financial effect.
 *   6. On insert, write a transactional outbox row (event_type 'conversion.normalized').
 *   7. On conflict (the provider natural key already exists), run the
 *      revision-ordered state machine (see packages/api/ASSUMPTIONS.md):
 *      incoming revision <= stored revision → ignore; higher revision →
 *      update provider_status/provider_revision and apply the transition.
 *      Approved is terminal for the status column: a higher-revision
 *      'declined'/'reversed' after approval creates a reversal adjustment
 *      for the full remaining commission instead of flipping the status;
 *      a higher-revision 'pending' after approval is logged and ignored.
 *
 * Ledger posting: transitions INTO 'approved' (fresh insert or
 * received/pending/declined → approved) post the double-entry rows via the
 * local ledger-mirror (same builders and idempotency keys as the API's
 * finance module). Re-posting is a no-op through the (idempotency_key,
 * account) dedupe, so the API inline path and this worker can never
 * double-post the same conversion.
 */

import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool, PoolClient } from 'pg';
import {
  AppError,
  assertMinorUnits,
  buildEnvelope,
  hashPayload,
  type ConversionStatus,
  type EventEnvelope,
  type MinorUnits,
  type RawConversion,
} from '@paparazzi/shared';
import { QUEUE_PROVIDER_EVENTS, createRedisConnection } from '../queues';
import { createLogger, errorMessage } from '../logging';
import {
  deterministicUuid,
  postAdjustmentForReversalMirror,
  postLedgerForConversionMirror,
} from '../ledger-mirror';

const log = createLogger('worker:provider-events');

export interface ProviderEventsJobData {
  /** Envelope whose payload is a RawConversion. */
  envelope: EventEnvelope;
  /** Tenant scope — EVERY SQL query includes org_id (brief §11). */
  org_id: string;
  /**
   * Programme this event belongs to. Set by the API when enqueueing (it knows
   * the integration route). RawConversion intentionally carries no
   * programme_id; if absent we do NOT guess — log and leave for the
   * connector-registry TODO below.
   */
  programme_id?: string;
}

/**
 * Provider status -> internal ConversionStatus (the DB enum).
 *
 * LOCAL MAP — temporary. The connector is the authority on provider-specific
 * status vocabularies, so this must be delegated to
 * connector.normaliseStatus(provider_status) once the connector registry
 * exists (TODO). Until then, anything unrecognised stays 'pending' — never
 * assume approval. The provider-side 'reversed' normalises to internal
 * 'declined': the reversal's financial effect is produced by the
 * state machine (auto-reversal adjustment), not an in-place status flip —
 * the DB enum has no 'reversed'.
 */
const PROVIDER_STATUS_MAP: Record<string, ConversionStatus> = {
  approved: 'approved',
  declined: 'declined',
  reversed: 'declined',
};

function mapStatus(providerStatus: string): ConversionStatus {
  return PROVIDER_STATUS_MAP[providerStatus.toLowerCase()] ?? 'pending';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requiredString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('VALIDATION_ERROR', `raw conversion missing required field: ${field}`, 422);
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  return typeof value === 'string' ? value : null;
}

function requiredMinorUnits(payload: Record<string, unknown>, field: string): MinorUnits {
  const value = payload[field];
  // assertMinorUnits takes a number; narrow first so misuse fails loudly.
  if (typeof value !== 'number') {
    throw new AppError('VALIDATION_ERROR', `raw conversion field ${field} must be a number`, 422);
  }
  assertMinorUnits(value);
  return value;
}

/**
 * Validate an unknown job payload into a RawConversion.
 *
 * NOTE: this shape check is duplicated in StubNetworkConnector.handleWebhook.
 * It belongs in @paparazzi/shared as a single `parseRawConversion` helper —
 * see ASSUMPTIONS.md. Kept local here so the worker stays connector-agnostic.
 */
function parseRawConversion(payload: unknown): RawConversion {
  if (!isRecord(payload)) {
    throw new AppError('VALIDATION_ERROR', 'provider event payload must be an object', 422);
  }
  const providerRevision = payload['provider_revision'];
  if (providerRevision !== undefined && typeof providerRevision !== 'number') {
    throw new AppError('VALIDATION_ERROR', 'provider_revision must be a number when present', 422);
  }
  return {
    provider_account_id: requiredString(payload, 'provider_account_id'),
    source_transaction_id: requiredString(payload, 'source_transaction_id'),
    line_id: optionalString(payload, 'line_id'),
    returned_click_ref: optionalString(payload, 'returned_click_ref'),
    currency: requiredString(payload, 'currency'),
    eligible_value_minor: requiredMinorUnits(payload, 'eligible_value_minor'),
    commission_minor: requiredMinorUnits(payload, 'commission_minor'),
    provider_status: requiredString(payload, 'provider_status'),
    provider_revision: typeof providerRevision === 'number' ? providerRevision : undefined,
    occurred_at: requiredString(payload, 'occurred_at'),
    received_at: requiredString(payload, 'received_at'),
    raw: payload['raw'],
  };
}

interface StoredConversionRow {
  id: string;
  status: string;
  provider_revision: number;
  commission_minor: string;
  currency: string;
  contract_version_id: string | null;
  click_id: string | null;
  programme_id: string;
}

interface TxnClient {
  query: PoolClient['query'];
}

/** Commission not yet reversed by prior reversal adjustments. */
async function unreversedRemainder(
  db: TxnClient,
  orgId: string,
  conversionId: string,
  commissionMinor: string,
): Promise<number> {
  const { rows } = await db.query<{ reversed_minor: string | null }>(
    `select sum(commission_delta_minor)::text as reversed_minor
       from adjustments
      where org_id = $1 and conversion_id = $2 and kind = 'reversal'`,
    [orgId, conversionId],
  );
  const commission = typeof commissionMinor === 'string' ? Number(commissionMinor) : commissionMinor;
  return Math.max(commission - Number(rows[0]?.reversed_minor ?? 0), 0);
}

async function writeOutboxRow(
  db: TxnClient,
  orgId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const envelope = buildEnvelope({ source: 'workers', event_type: eventType, payload });
  await db.query(
    `insert into outbox (org_id, event_type, payload, payload_hash, occurred_at)
     values ($1, $2, $3::jsonb, $4, now())`,
    [orgId, eventType, JSON.stringify(envelope), envelope.payload_hash],
  );
}

/**
 * Revision-ordered state machine for an event whose provider natural key
 * already exists in `conversions`. Mirrors the API integrations route:
 *
 * - incoming revision <= stored revision → ignore (duplicate/stale);
 * - stored 'approved' is terminal: higher-revision 'declined'/'reversed'
 *   creates a reversal adjustment for the full remaining commission (never
 *   flips the status); higher-revision 'pending' is logged and ignored;
 * - otherwise the transition is applied, and a transition INTO 'approved'
 *   posts the ledger (idempotent) and snapshots contract_version_id.
 */
async function applyRevisionUpdate(
  pool: Pool,
  job: Job<ProviderEventsJobData>,
  raw: RawConversion,
  status: ConversionStatus,
  orgId: string,
): Promise<void> {
  const incomingRevision = raw.provider_revision ?? 0;
  const stored = await pool.query<StoredConversionRow>(
    `select id, status, provider_revision,
            commission_minor::text as commission_minor, currency,
            contract_version_id, click_id, programme_id
       from conversions
      where org_id = $1
        and provider_account_id = $2
        and source_transaction_id = $3
        and (line_id = $4 or (line_id is null and $4::text is null))`,
    [orgId, raw.provider_account_id, raw.source_transaction_id, raw.line_id],
  );
  const s = stored.rows[0];
  if (!s) {
    log('warn', 'conversion conflict could not be resolved; skipping', { jobId: job.id });
    return;
  }
  if (incomingRevision <= s.provider_revision) {
    log('info', 'duplicate/stale provider event ignored', {
      jobId: job.id,
      conversion_id: s.id,
      incoming_revision: incomingRevision,
      stored_revision: s.provider_revision,
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    if (s.status === 'approved') {
      // Approved is terminal for the status column — never downgrade it.
      if (status === 'declined') {
        const remainder = await unreversedRemainder(client, orgId, s.id, s.commission_minor);
        let adjustmentId: string | null = null;
        if (remainder > 0) {
          adjustmentId = deterministicUuid(`auto-reversal:${s.id}:${incomingRevision}`);
          await client.query(
            `insert into adjustments (id, org_id, conversion_id, kind, commission_delta_minor, reason)
             values ($1, $2, $3, 'reversal', $4, $5)
             on conflict (id) do nothing`,
            [
              adjustmentId,
              orgId,
              s.id,
              String(remainder),
              `provider reported '${raw.provider_status}' at revision ${incomingRevision} after approval`,
            ],
          );
        }
        await client.query(
          `update conversions set provider_status = $2, provider_revision = $3
            where id = $4 and org_id = $1`,
          [orgId, raw.provider_status, incomingRevision, s.id],
        );
        await writeOutboxRow(client, orgId, 'conversion.reversed', {
          conversion_id: s.id,
          org_id: orgId,
          status: 'approved',
          auto_reversed: adjustmentId !== null,
          adjustment_id: adjustmentId,
          provider_revision: incomingRevision,
        });
        await client.query('commit');
        if (adjustmentId) {
          const ledger = await postAdjustmentForReversalMirror(pool, {
            adjustmentId,
            conversionId: s.id,
          });
          log('info', 'auto-reversal adjustment processed', {
            jobId: job.id,
            conversion_id: s.id,
            adjustment_id: adjustmentId,
            ledger,
          });
        }
        return;
      }
      await client.query(
        `update conversions set provider_status = $2, provider_revision = $3
          where id = $4 and org_id = $1`,
        [orgId, raw.provider_status, incomingRevision, s.id],
      );
      if (status === 'pending') {
        log('info', "higher-revision 'pending' arrived after 'approved'; downgrade ignored", {
          jobId: job.id,
          conversion_id: s.id,
          incoming_revision: incomingRevision,
        });
      }
      await client.query('commit');
      return;
    }

    // stored received/pending/declined — apply the transition.
    await client.query(
      `update conversions set status = $2, provider_status = $3, provider_revision = $4
        where id = $5 and org_id = $1`,
      [orgId, status, raw.provider_status, incomingRevision, s.id],
    );
    await writeOutboxRow(client, orgId, 'conversion.status_changed', {
      conversion_id: s.id,
      org_id: orgId,
      from_status: s.status,
      to_status: status,
      provider_revision: incomingRevision,
    });
    await client.query('commit');

    if (status === 'approved') {
      const ledger = await postLedgerForConversionMirror(pool, {
        id: s.id,
        org_id: orgId,
        programme_id: s.programme_id,
        click_id: s.click_id,
        currency: s.currency,
        commission_minor: s.commission_minor,
      });
      if (ledger === 'skipped') {
        log('warn', 'approved conversion left unposted: unattributable or no approved contract', {
          jobId: job.id,
          conversion_id: s.id,
        });
      } else {
        log('info', 'conversion posted to ledger on approved transition', {
          jobId: job.id,
          conversion_id: s.id,
        });
      }
    }
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function createProviderEventsProcessor(pool: Pool) {  return async function processProviderEvent(job: Job<ProviderEventsJobData>): Promise<void> {
    const { envelope, org_id: orgId, programme_id: programmeId } = job.data;
    if (typeof orgId !== 'string' || orgId.length === 0) {
      // Tenant scope is mandatory and must be supplied by the producer.
      throw new AppError('INTERNAL', 'provider event job is missing org_id', 500);
    }

    if (hashPayload(envelope.payload) !== envelope.payload_hash) {
      log('error', 'envelope payload_hash mismatch; dropping job', {
        jobId: job.id,
        event_id: envelope.event_id,
      });
      // TODO: dead-letter queue with replay controls.
      return;
    }

    const raw = parseRawConversion(envelope.payload);

    if (!programmeId) {
      log('warn', 'provider event missing programme_id; skipping', {
        jobId: job.id,
        event_id: envelope.event_id,
        provider_account_id: raw.provider_account_id,
        source_transaction_id: raw.source_transaction_id,
      });
      // TODO: resolve programme via the programmes table by
      // (connector, provider_account_id) once the connector registry exists.
      // Do NOT guess from the payload alone.
      return;
    }

    // ------------------------------------------------------------------
    // CORE INVARIANT: unknown attribution stays unknown.
    //
    // returned_click_ref is matched deterministically against clicks.click_id.
    // If it matches nothing, the conversion is stored with click_id = NULL and
    // lands in the suspense queue for HUMAN review. We NEVER guess a publisher
    // from IP address, timestamps, or device fingerprints (brief §8) — a
    // wrong guess would manufacture a payable sale to the wrong party.
    // ------------------------------------------------------------------
    let clickUuid: string | null = null;
    if (raw.returned_click_ref) {
      const found = await pool.query<{ id: string }>(
        'select id from clicks where click_id = $1 and org_id = $2',
        [raw.returned_click_ref, orgId],
      );
      clickUuid = found.rows[0]?.id ?? null;
      if (clickUuid === null) {
        log('warn', 'returned_click_ref matched no click; routing to suspense queue', {
          jobId: job.id,
          returned_click_ref: raw.returned_click_ref,
          source_transaction_id: raw.source_transaction_id,
        });
      }
    } else {
      log('warn', 'conversion arrived without returned_click_ref; routing to suspense queue', {
        jobId: job.id,
        source_transaction_id: raw.source_transaction_id,
      });
    }

    const status = mapStatus(raw.provider_status);

    // Conversion insert + outbox write share one transaction so the DB commit
    // and the downstream event stay consistent (transactional outbox, brief §10).
    const client = await pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query<{ id: string }>(
        `insert into conversions
           (org_id, programme_id, provider_account_id, source_transaction_id, line_id,
            returned_click_ref, click_id, currency, eligible_value_minor, commission_minor,
            provider_status, provider_revision, status, occurred_at, received_at, raw)
         values
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
         -- Bare ON CONFLICT (no arbiter): pg-mem does not honour multi-column
         -- arbiters; the row is re-selected below so a skip always resolves
         -- to the canonical row.
         on conflict do nothing
         returning id`,
        [
          orgId,
          programmeId,
          raw.provider_account_id,
          raw.source_transaction_id,
          raw.line_id,
          raw.returned_click_ref,
          clickUuid,
          raw.currency,
          raw.eligible_value_minor,
          raw.commission_minor,
          raw.provider_status,
          // provider_revision is NOT NULL in the domain model; 0 = "no revision info".
          raw.provider_revision ?? 0,
          status,
          raw.occurred_at,
          raw.received_at,
          JSON.stringify(raw.raw ?? null),
        ],
      );

      const row = inserted.rows[0];
      if (!row) {
        // The provider natural key already exists: this is either a duplicate
        // delivery or a newer revision of a known conversion. Roll back the
        // empty transaction and run the revision-ordered state machine.
        await client.query('rollback');
        await applyRevisionUpdate(pool, job, raw, status, orgId);
        return;
      }

      // Outbox row carries the full envelope so consumers can verify integrity
      // and dedupe on event_id (at-least-once delivery).
      const outboxEnvelope = buildEnvelope({
        source: 'workers',
        source_account_id: raw.provider_account_id,
        event_type: 'conversion.normalized',
        payload: {
          conversion_id: row.id,
          org_id: orgId,
          programme_id: programmeId,
          click_id: clickUuid,
          status,
          provider_account_id: raw.provider_account_id,
          source_transaction_id: raw.source_transaction_id,
          currency: raw.currency,
          eligible_value_minor: raw.eligible_value_minor,
          commission_minor: raw.commission_minor,
        },
      });
      await client.query(
        `insert into outbox (org_id, event_type, payload, payload_hash, occurred_at)
         values ($1, $2, $3::jsonb, $4, now())`,
        [orgId, 'conversion.normalized', JSON.stringify(outboxEnvelope), outboxEnvelope.payload_hash],
      );

      await client.query('commit');
      log('info', 'conversion.normalized', {
        jobId: job.id,
        conversion_id: row.id,
        status,
        click_id: clickUuid,
        suspense: clickUuid === null,
      });

      if (status === 'approved') {
        // Fresh approved conversion: post the ledger (idempotent via the
        // (idempotency_key, account) dedupe — the API inline path can never
        // double-post it) and snapshot the contract version used.
        const ledger = await postLedgerForConversionMirror(pool, {
          id: row.id,
          org_id: orgId,
          programme_id: programmeId,
          click_id: clickUuid,
          currency: raw.currency,
          commission_minor: String(raw.commission_minor),
        });
        if (ledger === 'skipped') {
          log('warn', 'approved conversion left unposted: unattributable or no approved contract', {
            jobId: job.id,
            conversion_id: row.id,
            click_id: clickUuid,
          });
        }
      }
    } catch (error) {
      await client.query('rollback');
      throw error instanceof AppError
        ? error
        : new AppError('INTERNAL', `provider event processing failed: ${errorMessage(error)}`, 500);
    } finally {
      client.release();
    }
  };
}

/** Start a Worker on the provider-events queue. The caller owns pool/connection lifecycles. */
export function createProviderEventsWorker(pool: Pool, connection?: Redis): Worker<ProviderEventsJobData> {
  const worker = new Worker<ProviderEventsJobData>(
    QUEUE_PROVIDER_EVENTS,
    createProviderEventsProcessor(pool),
    { connection: connection ?? createRedisConnection() },
  );
  worker.on('failed', (job, error) => {
    log('error', 'job failed', {
      jobId: job?.id,
      code: error instanceof AppError ? error.code : 'INTERNAL',
      error: error.message,
    });
  });
  return worker;
}
