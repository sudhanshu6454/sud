import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, buildEnvelope } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { ok, parseOr400 } from './_helpers.js';

/**
 * Dispute / support tickets for missing commission (and related claims).
 *
 * - POST /v1/disputes opens a ticket. It may reference a known conversion
 *   (kind 'wrong_amount' / 'unattributed_click') or NO conversion at all
 *   (kind 'missing_commission': the publisher believes a sale happened that
 *   the provider never reported — identified by claim_ref, e.g. the
 *   merchant's order id).
 * - A ticket NEVER creates a payable sale on its own. Resolution to
 *   'resolved' requires `provider_verified: true` plus a resolution note
 *   describing the provider-side evidence; "screenshot alone never creates
 *   a payable sale" is enforced in code (422), not just policy.
 * - Resolving a missing-commission ticket does not post ledger entries —
 *   the provider must re-report the conversion through the normal webhook
 *   path (dedupe + revision ordering apply), or finance books a manual
 *   correction. This keeps the ledger append-only and provider-sourced.
 */

const DisputeKind = z.enum(['missing_commission', 'wrong_amount', 'unattributed_click', 'other']);

const OpenDisputeBody = z.object({
  conversion_id: z.string().uuid().optional(),
  publisher_id: z.string().uuid().optional(),
  kind: DisputeKind.default('missing_commission'),
  subject: z.string().min(1).max(300),
  claim_ref: z.string().min(1).max(200).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

const DisputesQuery = z.object({
  status: z.enum(['open', 'under_review', 'resolved', 'rejected']).optional(),
  kind: DisputeKind.optional(),
  publisher_id: z.string().uuid().optional(),
});

const DisputeParams = z.object({ id: z.string().uuid() });

const ResolveDisputeBody = z.object({
  outcome: z.enum(['resolved', 'rejected']),
  resolution_note: z.string().min(10).max(2000),
  /** Must be true for 'resolved': the claim was checked against provider records. */
  provider_verified: z.boolean(),
});

interface DisputeRow {
  id: string;
  conversion_id: string | null;
  publisher_id: string | null;
  kind: string;
  subject: string;
  claim_ref: string | null;
  status: string;
  evidence: unknown;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: unknown;
  created_at: unknown;
}

const SELECT_COLS =
  `id, conversion_id, publisher_id, kind, subject, claim_ref, status,
   evidence, resolution_note, resolved_by, resolved_at, created_at`;

async function writeOutbox(orgId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  const envelope = buildEnvelope({ source: 'api', event_type: eventType, payload });
  await tenantQuery(
    orgId,
    `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
     values ($2, $1, $3, $4::jsonb, $5, now())`,
    [randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
  );
}

export async function disputesRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/disputes',
    {
      preHandler: [
        requireAuth,
        requireRole('publisher_owner', 'editor', 'network_admin'),
        idempotencyCheck,
      ],
    },
    async (req, reply) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const body = parseOr400(OpenDisputeBody, req.body);

      // When a conversion is named, it must belong to this org (404 otherwise
      // — no cross-tenant reference probing).
      let chainPublisherId: string | null = null;
      if (body.conversion_id) {
        const conv = await tenantQuery<{ id: string }>(
          orgId,
          `select id from conversions where org_id = $1 and id = $2`,
          [body.conversion_id],
        );
        if (!conv.rows[0]) {
          throw new AppError('NOT_FOUND', 'Conversion not found for this organisation', 404);
        }
        const chain = await tenantQuery<{ publisher_id: string }>(
          orgId,
          `select ca.publisher_id as publisher_id
             from conversions c
             join clicks cl      on cl.id = c.click_id       and cl.org_id = $1
             join links l        on l.id = cl.link_id        and l.org_id = $1
             join placements pl  on pl.id = l.placement_id   and pl.org_id = $1
             join campaigns ca   on ca.id = pl.campaign_id   and ca.org_id = $1
            where c.id = $2 and c.org_id = $1
            limit 1`,
          [body.conversion_id],
        );
        chainPublisherId = chain.rows[0]?.publisher_id ?? null;
      }

      let publisherId: string | null = chainPublisherId;
      if (body.publisher_id) {
        const pub = await tenantQuery<{ id: string }>(
          orgId,
          `select id from publishers where org_id = $1 and id = $2`,
          [body.publisher_id],
        );
        if (!pub.rows[0]) {
          throw new AppError('NOT_FOUND', 'Publisher not found for this organisation', 404);
        }
        publisherId = body.publisher_id;
      }

      const { rows } = await tenantQuery<DisputeRow>(
        orgId,
        `insert into disputes
           (id, org_id, conversion_id, publisher_id, kind, subject, claim_ref, status, evidence)
         values ($2, $1, $3, $4, $5, $6, $7, 'open', $8::jsonb)
         returning ${SELECT_COLS}`,
        [
          randomUUID(),
          body.conversion_id ?? null,
          publisherId,
          body.kind,
          body.subject,
          body.claim_ref ?? null,
          body.evidence ? JSON.stringify(body.evidence) : null,
        ],
      );
      const dispute = rows[0];
      if (!dispute) throw new AppError('INTERNAL', 'Dispute creation failed', 500);

      await writeOutbox(orgId, 'dispute.opened', {
        dispute_id: dispute.id,
        org_id: orgId,
        kind: dispute.kind,
        conversion_id: dispute.conversion_id,
        publisher_id: dispute.publisher_id,
        claim_ref: dispute.claim_ref,
      });

      return reply.code(201).send(ok(req, dispute));
    },
  );

  app.get('/v1/disputes', { preHandler: [requireAuth] }, async (req) => {
    const tenant = authed(req);
    const orgId = tenant.org_id;
    const q = parseOr400(DisputesQuery, req.query);

    const filters = ['org_id = $1'];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      filters.push(`status = $${params.length + 1}`);
    }
    if (q.kind) {
      params.push(q.kind);
      filters.push(`kind = $${params.length + 1}`);
    }
    if (q.publisher_id) {
      params.push(q.publisher_id);
      filters.push(`publisher_id = $${params.length + 1}`);
    }

    const { rows } = await tenantQuery<DisputeRow>(
      orgId,
      `select ${SELECT_COLS} from disputes where ${filters.join(' and ')} order by created_at desc`,
      params,
    );
    return ok(req, rows);
  });

  app.get('/v1/disputes/:id', { preHandler: [requireAuth] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(DisputeParams, req.params);
    const { rows } = await tenantQuery<DisputeRow>(
      tenant.org_id,
      `select ${SELECT_COLS} from disputes where org_id = $1 and id = $2`,
      [id],
    );
    const dispute = rows[0];
    if (!dispute) {
      throw new AppError('NOT_FOUND', 'Dispute not found for this organisation', 404);
    }
    return ok(req, dispute);
  });

  app.post(
    '/v1/disputes/:id/resolve',
    { preHandler: [requireAuth, requireRole('network_admin', 'editor'), idempotencyCheck] },
    async (req) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { id } = parseOr400(DisputeParams, req.params);
      const body = parseOr400(ResolveDisputeBody, req.body);

      // Screenshots alone never create a payable sale: a 'resolved' outcome
      // must be backed by provider-side verification.
      if (body.outcome === 'resolved' && !body.provider_verified) {
        throw new AppError(
          'VALIDATION_ERROR',
          "A dispute can only be resolved when the claim is verified against provider records; screenshots or publisher assertions alone never create a payable sale",
          422,
        );
      }

      const found = await tenantQuery<{ status: string }>(
        orgId,
        `select status from disputes where org_id = $1 and id = $2`,
        [id],
      );
      const dispute = found.rows[0];
      if (!dispute) {
        throw new AppError('NOT_FOUND', 'Dispute not found for this organisation', 404);
      }
      if (dispute.status === 'resolved' || dispute.status === 'rejected') {
        throw new AppError('CONFLICT', `Dispute is already '${dispute.status}'`, 409);
      }

      const { rows } = await tenantQuery<DisputeRow>(
        orgId,
        `update disputes
            set status = $2, resolution_note = $3, resolved_by = $4, resolved_at = now()
          where org_id = $1 and id = $5
          returning ${SELECT_COLS}`,
        [body.outcome, body.resolution_note, tenant.sub, id],
      );
      const updated = rows[0];
      if (!updated) throw new AppError('INTERNAL', 'Dispute resolution failed', 500);

      await tenantQuery(
        orgId,
        `insert into audit_log (org_id, actor_id, action, entity, entity_id)
         values ($1, $2, $3, 'dispute', $4)`,
        [tenant.sub, `dispute.${body.outcome}`, id],
      );
      await writeOutbox(orgId, 'dispute.resolved', {
        dispute_id: id,
        org_id: orgId,
        outcome: body.outcome,
        provider_verified: body.provider_verified,
        resolved_by: tenant.sub,
      });

      return ok(req, updated);
    },
  );
}
