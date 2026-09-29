import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@paparazzi/shared';
import { getPool, tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import {
  assertBooksBalancedOrThrow,
  computeCollectedAllocation,
  computeEligibleEarnings,
} from '../finance.js';
import { initiateTransfers, queryTransferStatus } from '../payout-rail.js';
import { ok, parseOr400 } from './_helpers.js';

const PrepareBatchBody = z.object({
  currency: z.string().length(3),
});

const BATCH_PREPARE_ROLES = ['finance_operator', 'finance_approver', 'network_admin'];
const BATCH_APPROVE_ROLES = ['finance_approver', 'network_admin'];
const BATCH_DISBURSE_ROLES = ['finance_operator', 'network_admin'];

interface PublisherBatched {
  publisher_id: string;
  batched_minor: string;
}

interface PublisherThreshold {
  publisher_id: string;
  threshold_minor: string;
}

/**
 * Payout batches.
 *
 * POST /v1/payout-batches — prepare:
 *   1. Gate: books must balance for (org, currency) → 409 LEDGER_IMBALANCE.
 *   2. Eligible earnings per publisher = publisher share of approved
 *      conversions past the programme's returns window, minus reversal
 *      adjustments, minus amounts already in live (non-failed/cancelled)
 *      batches — then CAPPED by collected cash: per (programme, currency)
 *      the merchant_settlements pool is allocated pro-rata by
 *      eligible-earnings share (see API ASSUMPTIONS.md).
 *   3. Only publishers strictly above their payout threshold are included.
 *      Threshold assumption: the MAX payout_threshold_minor across the
 *      publisher's approved contracts (conservative; see ASSUMPTIONS.md).
 *   4. Creates the batch (status 'pending_approval', prepared_by = caller)
 *      plus payout_items. Row-level idempotency_key: on conflict the existing
 *      batch is returned with 200 instead of creating a duplicate.
 *   Nobody qualifying → 422.
 *
 * POST /v1/payout-batches/{id}/approve:
 *   - Maker-checker: the preparer cannot approve their own batch → 403.
 *   - Only 'pending_approval' batches can be approved → 409 otherwise.
 *
 * POST /v1/payout-batches/{id}/disburse:
 *   - Requires status 'approved' → 409 otherwise.
 *   - Creates one payout_transfers row per payout item
 *     (provider_ref 'stub-<uuid>', idempotency_key
 *     'transfer:<batch_id>:<publisher_id>'), hands them to the payout rail,
 *     and moves the batch to 'processing'. Re-calling is idempotent: the
 *     transfer rows collapse on their idempotency key and the rail skips
 *     transfers that are already past 'initiated'.
 *
 * POST /v1/payout-transfers/{providerRef}/status-query:
 *   - Asks the (fake) provider for a transfer's current status and records
 *     last_status_query_at. A transfer stuck in 'unknown' may only be
 *     re-initiated within 5 minutes of a fresh status query — the disburse
 *     path throws TRANSFER_STATUS_UNKNOWN otherwise, so an ambiguous
 *     transfer can never be blind-retried into a double payout.
 */
export async function payoutsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/payout-batches',
    { preHandler: [requireAuth, requireRole(...BATCH_PREPARE_ROLES), idempotencyCheck] },
    async (req, reply) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { currency } = parseOr400(PrepareBatchBody, req.body);
      const cur = currency.toUpperCase();
      const db = getPool();

      await assertBooksBalancedOrThrow(db, orgId, cur);

      // Eligible earnings per (publisher, programme): mature approved shares
      // minus reversals. Then per (publisher, currency) minus live batches,
      // capped by the collected-cash pro-rata allocation.
      const eligible = await computeEligibleEarnings(db, orgId, cur);
      const eligibleByPublisher = new Map<string, number>();
      for (const e of eligible) {
        eligibleByPublisher.set(e.publisher_id, (eligibleByPublisher.get(e.publisher_id) ?? 0) + e.eligible_minor);
      }
      const collected = await computeCollectedAllocation(db, orgId, cur);

      // Already allocated to live batches (avoid double-paying).
      const batched = await tenantQuery<PublisherBatched>(
        orgId,
        `select pi.publisher_id as publisher_id, sum(pi.amount_minor)::text as batched_minor
           from payout_items pi
           join payout_batches pb on pb.id = pi.payout_batch_id
          where pb.org_id = $1 and pi.currency = $2
            and pb.status not in ('failed', 'cancelled')
          group by pi.publisher_id`,
        [cur],
      );
      const batchedBy = new Map(batched.rows.map((r) => [r.publisher_id, Number(r.batched_minor)]));

      // Conservative threshold: max across the publisher's approved contracts.
      const thresholds = await tenantQuery<PublisherThreshold>(
        orgId,
        `select publisher_id, max(payout_threshold_minor)::text as threshold_minor
           from contracts
          where org_id = $1 and status = 'approved'
          group by publisher_id`,
      );
      const thresholdBy = new Map(thresholds.rows.map((r) => [r.publisher_id, Number(r.threshold_minor)]));

      const items: Array<{ publisher_id: string; amount_minor: number }> = [];
      for (const [publisherId, eligibleMinor] of eligibleByPublisher) {
        // max(min(eligible, collected) − alreadyBatched, 0): cap by collected
        // cash BEFORE subtracting live batches, so committed-but-unpaid
        // batches always reduce the same collected-cash pool.
        const collectedMinor = collected.get(`${publisherId}|${cur}`) ?? 0;
        const batchedMinor = batchedBy.get(publisherId) ?? 0;
        const payable = Math.max(Math.min(eligibleMinor, collectedMinor) - batchedMinor, 0);
        const threshold = thresholdBy.get(publisherId) ?? 0;
        if (payable > threshold) {
          items.push({ publisher_id: publisherId, amount_minor: Math.floor(payable) });
        }
      }

      if (items.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'No publisher is above their payout threshold', 422);
      }

      const idempotencyKey = req.idempotencyKey ?? randomUUID();
      const batchId = randomUUID();

      const inserted = await tenantQuery<{ id: string }>(
        orgId,
        `insert into payout_batches
           (id, org_id, currency, status, prepared_by, approved_by, idempotency_key)
         values ($2, $1, $3, 'pending_approval', $4, null, $5)
         on conflict (idempotency_key) do nothing
         returning id`,
        [batchId, cur, tenant.sub, idempotencyKey],
      );

      if (inserted.rows.length === 0) {
        // Same idempotency key raced us (or a client retry): return the batch
        // that won instead of creating a duplicate.
        const existing = await tenantQuery<{ id: string; currency: string; status: string }>(
          orgId,
          `select id, currency, status from payout_batches where org_id = $1 and idempotency_key = $2`,
          [idempotencyKey],
        );
        const batch = existing.rows[0];
        if (!batch) throw new AppError('INTERNAL', 'Payout batch conflict could not be resolved', 500);
        return reply.code(200).send(ok(req, { ...batch, deduped: true }));
      }

      for (const item of items) {
        // payout_items carries no org_id of its own; the EXISTS gate ties the
        // write to a batch owned by this org (and satisfies the tenantQuery
        // org_id invariant).
        await tenantQuery(
          orgId,
          `insert into payout_items (payout_batch_id, publisher_id, amount_minor, currency)
           select $2, $3, $4::bigint, $5
            where exists (select 1 from payout_batches where id = $2 and org_id = $1)`,
          [batchId, item.publisher_id, item.amount_minor, cur],
        );
      }

      return reply.code(201).send(
        ok(req, {
          id: batchId,
          currency: cur,
          status: 'pending_approval',
          prepared_by: tenant.sub,
          items,
        }),
      );
    },
  );

  app.post(
    '/v1/payout-batches/:id/approve',
    { preHandler: [requireAuth, requireRole(...BATCH_APPROVE_ROLES), idempotencyCheck] },
    async (req) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { id } = parseOr400(z.object({ id: z.string().uuid() }), req.params);

      const found = await tenantQuery<{
        id: string;
        currency: string;
        status: string;
        prepared_by: string | null;
        approved_by: string | null;
      }>(
        orgId,
        `select id, currency, status, prepared_by, approved_by
           from payout_batches where org_id = $1 and id = $2`,
        [id],
      );
      const batch = found.rows[0];
      if (!batch) {
        throw new AppError('NOT_FOUND', 'Payout batch not found for this organisation', 404);
      }
      // Maker-checker: the person who prepared the batch cannot approve it.
      if (batch.prepared_by === tenant.sub) {
        throw new AppError('FORBIDDEN', 'You cannot approve a payout batch you prepared', 403);
      }
      if (batch.status !== 'pending_approval') {
        throw new AppError(
          'CONFLICT',
          `Only batches in 'pending_approval' can be approved (current: '${batch.status}')`,
          409,
        );
      }

      // tenantQuery binds $1 = org_id; the array below maps to $2 (approver), $3 (batch id).
      await tenantQuery(
        orgId,
        `update payout_batches set status = 'approved', approved_by = $2
          where org_id = $1 and id = $3`,
        [tenant.sub, id],
      );

      return ok(req, {
        id: batch.id,
        currency: batch.currency,
        status: 'approved',
        prepared_by: batch.prepared_by,
        approved_by: tenant.sub,
      });
    },
  );

  app.post(
    '/v1/payout-batches/:id/disburse',
    { preHandler: [requireAuth, requireRole(...BATCH_DISBURSE_ROLES), idempotencyCheck] },
    async (req, reply) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const db = getPool();
      const { id } = parseOr400(z.object({ id: z.string().uuid() }), req.params);

      const found = await tenantQuery<{ id: string; currency: string; status: string }>(
        orgId,
        `select id, currency, status from payout_batches where org_id = $1 and id = $2`,
        [id],
      );
      const batch = found.rows[0];
      if (!batch) {
        throw new AppError('NOT_FOUND', 'Payout batch not found for this organisation', 404);
      }

      const items = await tenantQuery<{ publisher_id: string }>(
        orgId,
        `select pi.publisher_id as publisher_id
           from payout_items pi
           join payout_batches pb on pb.id = pi.payout_batch_id and pb.org_id = $1
          where pi.payout_batch_id = $2`,
        [id],
      );
      if (items.rows.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'Payout batch has no items to disburse', 422);
      }

      if (batch.status === 'approved') {
        // First disbursement: create the transfer rows, hand them to the
        // rail, and move the batch to 'processing'.
        for (const item of items.rows) {
          await tenantQuery(
            orgId,
            `insert into payout_transfers
               (org_id, payout_batch_id, provider_ref, status, idempotency_key)
             values ($1, $2, $3, 'initiated', $4)
             on conflict (idempotency_key) do nothing`,
            [id, `stub-${randomUUID()}`, `transfer:${id}:${item.publisher_id}`],
          );
        }
        const transfers = await initiateTransfers(db, orgId, id);
        await tenantQuery(
          orgId,
          `update payout_batches set status = 'processing' where org_id = $1 and id = $2`,
          [id],
        );
        return reply.code(200).send(ok(req, { id, status: 'processing', transfers }));
      }

      if (batch.status === 'processing') {
        // Idempotent re-call: transfer rows collapse on their idempotency
        // key; the rail skips transfers already past 'initiated' and enforces
        // the unknown-state guard on the rest.
        const transfers = await initiateTransfers(db, orgId, id);
        return reply.code(200).send(ok(req, { id, status: 'processing', transfers }));
      }

      throw new AppError(
        'CONFLICT',
        `Only batches in 'approved' can be disbursed (current: '${batch.status}')`,
        409,
      );
    },
  );

  app.post(
    '/v1/payout-transfers/:providerRef/status-query',
    { preHandler: [requireAuth, requireRole(...BATCH_DISBURSE_ROLES), idempotencyCheck] },
    async (req) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { providerRef } = parseOr400(
        z.object({ providerRef: z.string().min(1).max(200) }),
        req.params,
      );

      const status = await queryTransferStatus(getPool(), orgId, providerRef);
      if (!status) {
        throw new AppError(
          'NOT_FOUND',
          `No payout transfer with provider_ref '${providerRef}'`,
          404,
        );
      }
      const queried = await tenantQuery<{ last_status_query_at: string | null }>(
        orgId,
        `select last_status_query_at::text as last_status_query_at
           from payout_transfers where org_id = $1 and provider_ref = $2`,
        [providerRef],
      );
      return ok(req, {
        provider_ref: providerRef,
        status,
        last_status_query_at: queried.rows[0]?.last_status_query_at ?? null,
      });
    },
  );
}
