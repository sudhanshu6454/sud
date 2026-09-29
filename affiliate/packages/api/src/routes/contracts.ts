import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, buildEnvelope } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { ok, parseOr400 } from './_helpers.js';

/**
 * Contract versioning.
 *
 * - POST /v1/contracts creates a NEW version (draft) for a
 *   publisher+programme: version = max(existing) + 1, and its
 *   effective_from must not be earlier than the previous version's
 *   (409 otherwise). Effective-dated: ledger posting only considers
 *   approved contracts whose effective_from is null or in the past.
 * - POST /v1/contracts/:id/approve moves a draft to approved
 *   (network_admin only).
 * - GET /v1/contracts lists versions for a publisher+programme, newest
 *   first.
 *
 * Conversions already posted keep their `contract_version_id` snapshot
 * forever — a new version never rewrites history (see finance.ts
 * postLedgerForConversion / postAdjustmentForReversal).
 */

const CreateContractBody = z.object({
  publisher_id: z.string().uuid(),
  programme_id: z.string().uuid(),
  publisher_share_bps: z.number().int().min(0).max(10000),
  payout_threshold_minor: z.number().int().min(0).default(0),
  effective_from: z.string().datetime(),
});

const ContractsQuery = z.object({
  publisher_id: z.string().uuid(),
  programme_id: z.string().uuid(),
});

const ContractParams = z.object({ id: z.string().uuid() });

interface ContractRow {
  id: string;
  publisher_id: string;
  programme_id: string;
  version: number;
  publisher_share_bps: number;
  payout_threshold_minor: string;
  status: string;
  effective_from: unknown;
  created_at: unknown;
}

const SELECT_COLS =
  `id, publisher_id, programme_id, version, publisher_share_bps,
   payout_threshold_minor::text as payout_threshold_minor,
   status, effective_from, created_at`;

async function writeOutbox(orgId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  const envelope = buildEnvelope({ source: 'api', event_type: eventType, payload });
  await tenantQuery(
    orgId,
    `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
     values ($2, $1, $3, $4::jsonb, $5, now())`,
    [randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
  );
}

export async function contractsRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/contracts',
    { preHandler: [requireAuth, requireRole('network_admin', 'editor'), idempotencyCheck] },
    async (req, reply) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const body = parseOr400(CreateContractBody, req.body);

      const publisher = await tenantQuery<{ id: string }>(
        orgId,
        `select id from publishers where org_id = $1 and id = $2`,
        [body.publisher_id],
      );
      if (!publisher.rows[0]) {
        throw new AppError('NOT_FOUND', 'Publisher not found for this organisation', 404);
      }
      const programme = await tenantQuery<{ id: string }>(
        orgId,
        `select id from programmes where org_id = $1 and id = $2`,
        [body.programme_id],
      );
      if (!programme.rows[0]) {
        throw new AppError('NOT_FOUND', 'Programme not found for this organisation', 404);
      }

      const latest = await tenantQuery<{ version: number; effective_from: Date | string | null }>(
        orgId,
        `select version, effective_from
           from contracts
          where org_id = $1 and publisher_id = $2 and programme_id = $3
          order by version desc
          limit 1`,
        [body.publisher_id, body.programme_id],
      );
      const prev = latest.rows[0];
      const nextVersion = (prev?.version ?? 0) + 1;
      const effectiveFrom = new Date(body.effective_from);
      if (prev?.effective_from) {
        const prevFrom = new Date(prev.effective_from as string);
        if (effectiveFrom.getTime() < prevFrom.getTime()) {
          throw new AppError(
            'CONFLICT',
            `New version effective_from (${body.effective_from}) cannot be earlier than version ${prev.version}'s (${prevFrom.toISOString()})`,
            409,
          );
        }
      }

      const { rows } = await tenantQuery<ContractRow>(
        orgId,
        `insert into contracts
           (id, org_id, publisher_id, programme_id, version,
            publisher_share_bps, payout_threshold_minor, status, effective_from)
         values ($2, $1, $3, $4, $5, $6, $7::bigint, 'draft', $8::timestamptz)
         returning ${SELECT_COLS}`,
        [
          randomUUID(),
          body.publisher_id,
          body.programme_id,
          nextVersion,
          body.publisher_share_bps,
          String(body.payout_threshold_minor),
          body.effective_from,
        ],
      );
      const contract = rows[0];
      if (!contract) throw new AppError('INTERNAL', 'Contract creation failed', 500);

      await writeOutbox(orgId, 'contract.version_created', {
        contract_id: contract.id,
        org_id: orgId,
        publisher_id: body.publisher_id,
        programme_id: body.programme_id,
        version: nextVersion,
        effective_from: body.effective_from,
      });

      return reply.code(201).send(ok(req, contract));
    },
  );

  app.post(
    '/v1/contracts/:id/approve',
    { preHandler: [requireAuth, requireRole('network_admin'), idempotencyCheck] },
    async (req) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { id } = parseOr400(ContractParams, req.params);

      const found = await tenantQuery<{ status: string; version: number }>(
        orgId,
        `select status, version from contracts where org_id = $1 and id = $2`,
        [id],
      );
      const contract = found.rows[0];
      if (!contract) {
        throw new AppError('NOT_FOUND', 'Contract not found for this organisation', 404);
      }
      if (contract.status !== 'draft') {
        throw new AppError(
          'CONFLICT',
          `Only draft contracts can be approved (current: '${contract.status}')`,
          409,
        );
      }

      const { rows } = await tenantQuery<ContractRow>(
        orgId,
        `update contracts set status = 'approved'
          where org_id = $1 and id = $2
          returning ${SELECT_COLS}`,
        [id],
      );
      const approved = rows[0];
      if (!approved) throw new AppError('INTERNAL', 'Contract approval failed', 500);

      await tenantQuery(
        orgId,
        `insert into audit_log (org_id, actor_id, action, entity, entity_id)
         values ($1, $2, 'contract.approve', 'contract', $3)`,
        [tenant.sub, id],
      );
      await writeOutbox(orgId, 'contract.approved', {
        contract_id: id,
        org_id: orgId,
        version: contract.version,
        approved_by: tenant.sub,
      });

      return ok(req, approved);
    },
  );

  app.get('/v1/contracts', { preHandler: [requireAuth] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(ContractsQuery, req.query);
    const { rows } = await tenantQuery<ContractRow>(
      tenant.org_id,
      `select ${SELECT_COLS}
         from contracts
        where org_id = $1 and publisher_id = $2 and programme_id = $3
        order by version desc`,
      [q.publisher_id, q.programme_id],
    );
    return ok(req, rows);
  });
}
