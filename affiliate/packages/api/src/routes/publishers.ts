import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, buildEnvelope } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { ok, parseOr400 } from './_helpers.js';

/**
 * Publisher onboarding state machine.
 *
 * States (see 0003_phase3.sql):
 *   application -> identity_review -> property_verification ->
 *   programme_eligibility -> contract -> active
 *
 * - POST /v1/publishers opens an application (onboarding_state 'application').
 * - POST /v1/publishers/:id/onboarding/advance moves it forward one step at
 *   a time (network_admin only; idempotent for the current state).
 * - Only publishers in 'active' may mint monetised links — enforced in
 *   POST /v1/links (403 PUBLISHER_NOT_ACTIVE). Pending accounts can draft
 *   looks/placements, they just cannot monetise them.
 *
 * Transitions are forward-only in this build. A rejected application is
 * handled by leaving it in its current state with the legacy `status`
 * column set to 'suspended'; re-application is a new publisher row.
 */

const ONBOARDING_ORDER = [
  'application',
  'identity_review',
  'property_verification',
  'programme_eligibility',
  'contract',
  'active',
] as const;

type OnboardingState = (typeof ONBOARDING_ORDER)[number];

const PublisherParams = z.object({ id: z.string().uuid() });

const CreatePublisherBody = z.object({
  legal_name: z.string().min(1).max(300),
  country: z.string().length(2),
});

const AdvanceBody = z.object({
  state: z.enum(ONBOARDING_ORDER),
});

interface PublisherRow {
  id: string;
  legal_name: string;
  country: string;
  status: string;
  onboarding_state: string;
  created_at: unknown;
}

function toPublic(row: PublisherRow) {
  return {
    id: row.id,
    legal_name: row.legal_name,
    country: row.country,
    status: row.status,
    onboarding_state: row.onboarding_state,
    created_at: row.created_at,
  };
}

async function writeOutbox(orgId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
  const envelope = buildEnvelope({ source: 'api', event_type: eventType, payload });
  await tenantQuery(
    orgId,
    `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
     values ($2, $1, $3, $4::jsonb, $5, now())`,
    [randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
  );
}

export async function publishersRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/publishers',
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
      const body = parseOr400(CreatePublisherBody, req.body);

      const { rows } = await tenantQuery<PublisherRow>(
        orgId,
        `insert into publishers (id, org_id, legal_name, country, status, onboarding_state)
         values ($2, $1, $3, $4, 'pending', 'application')
         returning id, legal_name, country, status, onboarding_state, created_at`,
        [randomUUID(), body.legal_name, body.country.toUpperCase()],
      );
      const publisher = rows[0];
      if (!publisher) throw new AppError('INTERNAL', 'Publisher creation failed', 500);

      await writeOutbox(orgId, 'publisher.application_received', {
        publisher_id: publisher.id,
        org_id: orgId,
        legal_name: body.legal_name,
      });

      return reply.code(201).send(ok(req, toPublic(publisher)));
    },
  );

  app.get(
    '/v1/publishers/:id',
    { preHandler: [requireAuth] },
    async (req) => {
      const tenant = authed(req);
      const { id } = parseOr400(PublisherParams, req.params);
      const { rows } = await tenantQuery<PublisherRow>(
        tenant.org_id,
        `select id, legal_name, country, status, onboarding_state, created_at
           from publishers where org_id = $1 and id = $2`,
        [id],
      );
      const publisher = rows[0];
      if (!publisher) {
        throw new AppError('NOT_FOUND', 'Publisher not found for this organisation', 404);
      }
      return ok(req, toPublic(publisher));
    },
  );

  app.post(
    '/v1/publishers/:id/onboarding/advance',
    { preHandler: [requireAuth, requireRole('network_admin'), idempotencyCheck] },
    async (req) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { id } = parseOr400(PublisherParams, req.params);
      const { state: target } = parseOr400(AdvanceBody, req.body);

      const found = await tenantQuery<{ onboarding_state: string }>(
        orgId,
        `select onboarding_state from publishers where org_id = $1 and id = $2`,
        [id],
      );
      const current = found.rows[0]?.onboarding_state as OnboardingState | undefined;
      if (!current) {
        throw new AppError('NOT_FOUND', 'Publisher not found for this organisation', 404);
      }

      const currentIdx = ONBOARDING_ORDER.indexOf(current);
      const targetIdx = ONBOARDING_ORDER.indexOf(target);
      if (targetIdx === currentIdx) {
        // Idempotent: already in the requested state.
        return ok(req, { id, onboarding_state: current, advanced: false });
      }
      if (targetIdx !== currentIdx + 1) {
        throw new AppError(
          'CONFLICT',
          `Invalid onboarding transition '${current}' -> '${target}': states advance one step at a time (${ONBOARDING_ORDER.join(' -> ')})`,
          409,
        );
      }

      await tenantQuery(
        orgId,
        `update publishers set onboarding_state = $2 where org_id = $1 and id = $3`,
        [target, id],
      );
      await tenantQuery(
        orgId,
        `insert into audit_log (org_id, actor_id, action, entity, entity_id)
         values ($1, $2, $3, 'publisher', $4)`,
        [tenant.sub, `publisher.onboarding.${target}`, id],
      );
      await writeOutbox(orgId, 'publisher.onboarding_state_changed', {
        publisher_id: id,
        org_id: orgId,
        from_state: current,
        to_state: target,
        advanced_by: tenant.sub,
      });

      return ok(req, { id, onboarding_state: target, advanced: true });
    },
  );
}
