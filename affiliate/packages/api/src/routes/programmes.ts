import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, buildEnvelope } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { redis } from '../redis.js';
import { ok, parseOr400 } from './_helpers.js';

/**
 * Minimal structural type for the cache client. The real client is ioredis;
 * tests inject a fake via the `__setRedis` seam in ../redis.js.
 */
interface RouteCacheClient {
  del(...keys: string[]): Promise<unknown>;
}

const ProgrammeParams = z.object({ id: z.string().uuid() });

/**
 * Delete `route:{token}` cache entries for every active link on a programme.
 *
 * WHY THIS EXISTS: the redirect service caches route payloads (including the
 * programme/offer eligibility snapshot) in Redis. Pausing a programme must
 * take effect immediately — not when the 600s/300s cache TTLs expire. The DB
 * stays the source of truth: without Redis, or if a delete fails, the
 * redirect falls back to a DB read and still serves the correct (paused)
 * page; the failure is only logged. This is the documented Redis dependency
 * of the kill switch (see API ASSUMPTIONS.md).
 */
export async function invalidateProgrammeRouteCache(
  orgId: string,
  programmeId: string,
  log?: FastifyRequest['log'],
): Promise<{ tokens: number; deleted: number; redisAvailable: boolean }> {
  const { rows } = await tenantQuery<{ token: string }>(
    orgId,
    `select l.token as token
       from links l
       join offers o on o.id = l.offer_id and o.org_id = $1
      where l.org_id = $1 and o.programme_id = $2 and l.status = 'active'`,
    [programmeId],
  );
  const tokens = rows.map((r) => r.token);

  const client = redis() as unknown as RouteCacheClient | null;
  if (!client) {
    log?.warn('route cache invalidation skipped: no Redis; DB fallback keeps behaviour correct');
    return { tokens: tokens.length, deleted: 0, redisAvailable: false };
  }
  if (tokens.length === 0) {
    return { tokens: 0, deleted: 0, redisAvailable: true };
  }

  let deleted = 0;
  try {
    const res = await client.del(...tokens.map((t) => `route:${t}`));
    deleted = typeof res === 'number' ? res : 0;
  } catch (err) {
    log?.warn({ err }, 'route cache invalidation failed; DB remains source of truth');
  }
  return { tokens: tokens.length, deleted, redisAvailable: true };
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

async function writeAudit(
  orgId: string,
  actorId: string,
  action: string,
  entityId: string,
): Promise<void> {
  await tenantQuery(
    orgId,
    `insert into audit_log (org_id, actor_id, action, entity, entity_id)
     values ($1, $2, $3, 'programme', $4)`,
    [actorId, action, entityId],
  );
}

/**
 * Programme kill switch.
 *
 * POST /v1/programmes/:id/pause  — network_admin only.
 *   Effective immediately:
 *   1. programmes.status -> 'paused' (row update, tenant-scoped).
 *   2. New link creation is blocked: POST /v1/links requires
 *      programme status = 'active' (403 PROGRAMME_NOT_APPROVED otherwise).
 *   3. In-flight redirect cache entries are invalidated
 *      (DELETE route:{token} for every active link on the programme).
 *   4. Existing links serve the paused page: the redirect service treats
 *      programme_status != 'active' as ineligible (HTTP 200, no redirect).
 *   5. A `programme.paused` outbox event is emitted; the workers' outbox
 *      relay publishes it to the `events` Redis stream for corrections
 *      consumers (at-least-once, dedupe on envelope.event_id).
 *   6. audit_log records who pulled the switch.
 *   Idempotent: pausing an already-paused programme returns 200 with the
 *   current state (cache invalidation still runs — cheap and safe).
 *
 * POST /v1/programmes/:id/resume — network_admin only.
 *   'paused' -> 'active' (+ same cache invalidation, because a route payload
 *   cached while paused would otherwise keep serving the paused page until
 *   TTL expiry). Resuming a non-paused programme is 409.
 */
export async function programmesRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/programmes/:id/pause',
    { preHandler: [requireAuth, requireRole('network_admin'), idempotencyCheck] },
    async (req, reply) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { id } = parseOr400(ProgrammeParams, req.params);

      const found = await tenantQuery<{ status: string }>(
        orgId,
        `select status from programmes where org_id = $1 and id = $2`,
        [id],
      );
      const programme = found.rows[0];
      if (!programme) {
        throw new AppError('NOT_FOUND', 'Programme not found for this organisation', 404);
      }

      if (programme.status !== 'paused') {
        await tenantQuery(
          orgId,
          `update programmes set status = 'paused' where org_id = $1 and id = $2`,
          [id],
        );
      }

      const invalidation = await invalidateProgrammeRouteCache(orgId, id, req.log);
      await writeOutbox(orgId, 'programme.paused', {
        programme_id: id,
        org_id: orgId,
        paused_by: tenant.sub,
        invalidated_routes: invalidation.tokens,
        redis_available: invalidation.redisAvailable,
      });
      await writeAudit(orgId, tenant.sub, 'programme.pause', id);

      return reply.code(200).send(
        ok(req, {
          id,
          status: 'paused',
          invalidated_routes: invalidation.tokens,
          cache_deleted: invalidation.deleted,
          redis_available: invalidation.redisAvailable,
        }),
      );
    },
  );

  app.post(
    '/v1/programmes/:id/resume',
    { preHandler: [requireAuth, requireRole('network_admin'), idempotencyCheck] },
    async (req, reply) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { id } = parseOr400(ProgrammeParams, req.params);

      const found = await tenantQuery<{ status: string }>(
        orgId,
        `select status from programmes where org_id = $1 and id = $2`,
        [id],
      );
      const programme = found.rows[0];
      if (!programme) {
        throw new AppError('NOT_FOUND', 'Programme not found for this organisation', 404);
      }
      if (programme.status !== 'paused') {
        throw new AppError(
          'CONFLICT',
          `Only a paused programme can be resumed (current: '${programme.status}')`,
          409,
        );
      }

      await tenantQuery(
        orgId,
        `update programmes set status = 'active' where org_id = $1 and id = $2`,
        [id],
      );
      // Same invalidation: a payload cached while paused must not keep
      // serving the paused page after resume.
      const invalidation = await invalidateProgrammeRouteCache(orgId, id, req.log);
      await writeOutbox(orgId, 'programme.resumed', {
        programme_id: id,
        org_id: orgId,
        resumed_by: tenant.sub,
        invalidated_routes: invalidation.tokens,
      });
      await writeAudit(orgId, tenant.sub, 'programme.resume', id);

      return reply.code(200).send(
        ok(req, {
          id,
          status: 'active',
          invalidated_routes: invalidation.tokens,
          cache_deleted: invalidation.deleted,
          redis_available: invalidation.redisAvailable,
        }),
      );
    },
  );
}
