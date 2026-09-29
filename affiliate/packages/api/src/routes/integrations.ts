import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, buildEnvelope } from '@paparazzi/shared';
import { getPool, tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole, type Tenant } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import {
  ingestConversionEvent,
  isAmazonReportPath,
  mapProviderStatus,
  type ConversionIngestInput,
  type IngestOutcome,
  type InternalStatus,
} from '../conversion-ingest.js';
import { postAdjustmentForReversal, toMinorUnits } from '../finance.js';
import { handleProviderCallback } from '../payout-rail.js';
import { postPayoutEntriesForBatch } from '../finance.js';
import { ok, parseOr400 } from './_helpers.js';

const CONNECTOR_ALLOWLIST = ['stub-network'] as const;

const AMAZON_ONLY_BY_REPORT =
  "Amazon.in Associates conversions and returns are written only by its report import (POST /v1/integrations/amazon-associates/reports; an unmatched return: the Amazon CLI's apply-return)";

const ProviderEventBody = z.object({
  kind: z.enum(['conversion', 'reversal']).default('conversion'),
  provider_account_id: z.string().min(1).max(200),
  source_transaction_id: z.string().min(1).max(200),
  line_id: z.string().max(200).optional(),
  // conversion fields (required when kind='conversion')
  returned_click_ref: z.string().max(200).optional(),
  currency: z.string().length(3).optional(),
  eligible_value_minor: z.number().int().min(0).optional(),
  commission_minor: z.number().int().min(0).optional(),
  provider_status: z.string().min(1).max(50).optional(),
  occurred_at: z.string().datetime().optional(),
  // shared / reversal fields
  provider_revision: z.number().int().min(0).optional(),
  reversal_commission_minor: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

type ProviderEvent = z.output<typeof ProviderEventBody>;
type ConversionEvent = ProviderEvent & { kind: 'conversion' };

/**
 * POST /v1/integrations/{connector}/events — provider conversion notifications.
 *
 * kind='conversion' (default):
 *   Delegates to the shared ingestion state machine in
 *   src/conversion-ingest.ts (the same money path the CSV connector uses).
 *   Attribution: returned_click_ref is matched against clicks.click_id.
 *   A miss is NOT an error — the conversion is stored with click_id = NULL
 *   (suspense). Attribution is never guessed.
 *   Dedupe: (provider_account_id, source_transaction_id, line_id) has a
 *   nulls-not-distinct unique constraint. A repeat at the same or lower
 *   provider_revision returns 200 {deduped:true}.
 *   Revision-ordered state machine (see API ASSUMPTIONS.md):
 *     - incoming revision <= stored revision → ignored (200 {deduped:true});
 *     - higher revision → provider_status/provider_revision updated;
 *       transitions received/pending/declined → approved post the ledger
 *       (idempotent via entry keys) and snapshot contract_version_id;
 *       approved is NEVER downgraded — a higher-revision 'pending' is
 *       logged and ignored, a higher-revision 'declined'/'reversed'
 *       creates a reversal adjustment for the full remaining commission.
 *   Approved conversions that cannot be attributed or contracted are
 *   logged and left unposted rather than posted against a guessed publisher.
 *
 * kind='reversal':
 *   Partial or full reversal of a previously recorded conversion.
 *   404 when the original conversion is unknown; 409 when
 *   reversal_commission_minor exceeds the unreversed remainder. Posts
 *   mirror entries via buildAdjustmentEntries snapshotting the ORIGINAL
 *   contract split (idempotency key 'adj:<adjustment_id>').
 */
export async function integrationsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/integrations/:connector/events',
    {
      preHandler: [
        requireAuth,
        // Provider webhooks are machine-to-machine; accept service roles.
        requireRole('network_admin', 'editor'),
        idempotencyCheck,
      ],
    },
    async (req, reply) => {
      const tenant = authed(req);
      const connector = (req.params as { connector?: string }).connector;
      if (!connector || !(CONNECTOR_ALLOWLIST as readonly string[]).includes(connector)) {
        throw new AppError('NOT_FOUND', `Unknown connector '${connector ?? ''}'`, 404);
      }

      const body = parseOr400(ProviderEventBody, req.body);
      // Amazon.in Associates rows come only through its own report import.
      if (await isAmazonReportPath(tenant.org_id, { providerAccountId: body.provider_account_id })) {
        throw new AppError('VALIDATION_ERROR', AMAZON_ONLY_BY_REPORT, 422);
      }
      if (body.kind === 'reversal') {
        return handleReversal(req, reply, tenant, connector, body);
      }
      return handleConversionEvent(req, reply, tenant, connector, body);
    },
  );

  app.post(
    '/v1/integrations/stub-network/payout-callback',
    { preHandler: [requireAuth, requireRole('network_admin'), idempotencyCheck] },
    async (req) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { provider_ref, outcome } = parseOr400(PayoutCallbackBody, req.body);

      const transfer = await handleProviderCallback(getPool(), orgId, provider_ref, outcome);
      if (!transfer) {
        throw new AppError('NOT_FOUND', `No payout transfer with provider_ref '${provider_ref}'`, 404);
      }

      // Batch-level rollup.
      const statuses = await tenantQuery<{ status: string }>(
        orgId,
        `select status from payout_transfers where org_id = $1 and payout_batch_id = $2`,
        [transfer.payout_batch_id],
      );
      const all = statuses.rows.map((r) => r.status);
      let batchStatus = 'processing';
      let ledger: 'posted' | 'skipped' | 'n/a' = 'n/a';
      if (all.length > 0 && all.every((s) => s === 'paid')) {
        await tenantQuery(
          orgId,
          `update payout_batches set status = 'paid' where org_id = $1 and id = $2`,
          [transfer.payout_batch_id],
        );
        ledger = await postPayoutEntriesForBatch(getPool(), { orgId, batchId: transfer.payout_batch_id });
        batchStatus = 'paid';
      } else if (all.some((s) => s === 'failed')) {
        await tenantQuery(
          orgId,
          `update payout_batches set status = 'failed' where org_id = $1 and id = $2`,
          [transfer.payout_batch_id],
        );
        batchStatus = 'failed';
      }

      return ok(req, {
        provider_ref,
        outcome,
        payout_batch_id: transfer.payout_batch_id,
        batch_status: batchStatus,
        ledger,
      });
    },
  );
}

const PayoutCallbackBody = z.object({
  provider_ref: z.string().min(1).max(200),
  outcome: z.enum(['paid', 'failed', 'unknown']),
});

function requireConversionFields(body: ProviderEvent): asserts body is ConversionEvent {
  const missing = (['currency', 'eligible_value_minor', 'commission_minor', 'provider_status', 'occurred_at'] as const).filter(
    (f) => body[f] === undefined,
  );
  if (missing.length > 0) {
    throw new AppError('VALIDATION_ERROR', `kind 'conversion' requires: ${missing.join(', ')}`, 400);
  }
}

async function handleConversionEvent(
  req: FastifyRequest,
  reply: FastifyReply,
  tenant: Tenant,
  connector: string,
  body: ProviderEvent,
) {
  requireConversionFields(body);
  const orgId = tenant.org_id;

  const input: ConversionIngestInput = {
    connector,
    receivedVia: 'api',
    // Webhook events carry no programme_id; the shared machine resolves it
    // (click chain → single active programme for the connector).
    programmeId: null,
    providerAccountId: body.provider_account_id,
    sourceTransactionId: body.source_transaction_id,
    lineId: body.line_id ?? null,
    returnedClickRef: body.returned_click_ref ?? null,
    currency: (body.currency as string).toUpperCase(),
    eligibleValueMinor: body.eligible_value_minor as number,
    commissionMinor: body.commission_minor as number,
    providerStatus: body.provider_status as string,
    providerRevision: body.provider_revision ?? 0,
    occurredAt: body.occurred_at as string,
  };

  let outcome: IngestOutcome;
  try {
    outcome = await ingestConversionEvent(orgId, input, req.log);
  } catch (err) {
    if (err instanceof Error && err.message === 'CONVERSION_PROGRAMME_UNKNOWN') {
      throw new AppError(
        'VALIDATION_ERROR',
        'Cannot resolve a programme for this conversion (no attributable click and no single active programme for the connector)',
        422,
      );
    }
    if (err instanceof Error && err.message === 'CONVERSION_PROGRAMME_CONNECTOR_MISMATCH') {
      // e.g. a returned_click_ref of a click on an Amazon link.
      throw new AppError('VALIDATION_ERROR', AMAZON_ONLY_BY_REPORT, 422);
    }
    throw err;
  }

  switch (outcome.kind) {
    case 'created':
      return reply
        .code(202)
        .send(ok(req, { conversion_id: outcome.conversionId, status: outcome.status, ledger: outcome.ledger }));
    case 'deduped':
      return reply.code(200).send(ok(req, { deduped: true }));
    case 'status_changed':
      return reply
        .code(200)
        .send(ok(req, { conversion_id: outcome.conversionId, status: outcome.status, ledger: outcome.ledger }));
    case 'auto_reversed':
      return reply.code(200).send(
        ok(req, {
          conversion_id: outcome.conversionId,
          status: outcome.status as InternalStatus,
          auto_reversed: outcome.autoReversed,
          adjustment_id: outcome.adjustmentId,
          ledger: outcome.ledger,
        }),
      );
  }
}

async function handleReversal(
  req: FastifyRequest,
  reply: FastifyReply,
  tenant: Tenant,
  connector: string,
  body: ProviderEvent,
) {
  const orgId = tenant.org_id;
  const reversalMinor = body.reversal_commission_minor;
  if (reversalMinor === undefined) {
    throw new AppError('VALIDATION_ERROR', "kind 'reversal' requires reversal_commission_minor", 400);
  }

  const original = await findConversionForReversal(
    orgId,
    body.provider_account_id,
    body.source_transaction_id,
    body.line_id ?? null,
  );
  if (!original) {
    throw new AppError('NOT_FOUND', 'Original conversion not found for this reversal', 404);
  }
  if (await isAmazonReportPath(orgId, { programmeId: original.programme_id })) {
    throw new AppError('VALIDATION_ERROR', AMAZON_ONLY_BY_REPORT, 422);
  }

  const remainder = await unreversedRemainderForReversal(orgId, original.id, original.commission_minor);
  if (reversalMinor > remainder) {
    throw new AppError(
      'CONFLICT',
      `Reversal of ${reversalMinor} minor units exceeds the unreversed remainder ${remainder} for conversion ${original.id}`,
      409,
    );
  }

  const adjustmentId = randomUUID();
  await tenantQuery(
    orgId,
    `insert into adjustments (id, org_id, conversion_id, kind, commission_delta_minor, reason)
     values ($2, $1, $3, 'reversal', $4, $5)`,
    [adjustmentId, original.id, String(reversalMinor), body.reason ?? null],
  );
  const ledger = await postAdjustmentForReversal(getPool(), {
    adjustmentId,
    conversionId: original.id,
  });
  if (ledger === 'skipped') {
    req.log.info(
      { adjustmentId, conversionId: original.id },
      'reversal recorded without ledger entries: original conversion was never posted',
    );
  }

  await writeReversalOutbox(orgId, {
    adjustment_id: adjustmentId,
    conversion_id: original.id,
    org_id: orgId,
    connector,
    reversal_commission_minor: reversalMinor,
    provider_revision: body.provider_revision ?? 0,
    ledger,
  });
  return reply.code(202).send(ok(req, { adjustment_id: adjustmentId, conversion_id: original.id, ledger }));
}

/** Reversal-path lookups (kept here; the shared machine owns the conversion path). */
async function findConversionForReversal(
  orgId: string,
  providerAccountId: string,
  sourceTransactionId: string,
  lineId: string | null,
): Promise<{ id: string; commission_minor: string; programme_id: string } | null> {
  const { rows } = await tenantQuery<{ id: string; commission_minor: string; programme_id: string }>(
    orgId,
    `select id, commission_minor::text as commission_minor, programme_id
       from conversions
      where org_id = $1
        and provider_account_id = $2
        and source_transaction_id = $3
        and (line_id = $4 or (line_id is null and $4::text is null))`,
    [providerAccountId, sourceTransactionId, lineId],
  );
  return rows[0] ?? null;
}

async function unreversedRemainderForReversal(
  orgId: string,
  conversionId: string,
  commissionMinor: string,
): Promise<number> {
  const { rows } = await tenantQuery<{ reversed_minor: string | null }>(
    orgId,
    `select sum(commission_delta_minor)::text as reversed_minor
       from adjustments
      where org_id = $1 and conversion_id = $2 and kind = 'reversal'`,
    [conversionId],
  );
  return Math.max(toMinorUnits(commissionMinor) - Number(rows[0]?.reversed_minor ?? 0), 0);
}

async function writeReversalOutbox(orgId: string, payload: Record<string, unknown>): Promise<void> {
  const envelope = buildEnvelope({ source: 'api', event_type: 'conversion.reversed', payload });
  await tenantQuery(
    orgId,
    `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
     values ($2, $1, $3, $4::jsonb, $5, now())`,
    [randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
  );
}

// Re-exported for tests that exercise the status vocabulary.
export { mapProviderStatus };
