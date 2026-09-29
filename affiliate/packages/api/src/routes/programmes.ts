import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, buildEnvelope } from '@paparazzi/shared';
import { getPool, tenantQuery } from '../db.js';
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

/** `$1` = org_id, `$2` = programme id (same convention as tenantQuery). */
const ACTIVE_LINK_TOKENS_SQL = `select l.token as token
       from links l
       join offers o on o.id = l.offer_id and o.org_id = $1
      where l.org_id = $1 and o.programme_id = $2 and l.status = 'active'`;

/**
 * Delete `route:{token}` for each token.
 *
 * WHY THIS EXISTS: the redirect service caches route payloads (including the
 * programme/offer eligibility snapshot) in Redis. Pausing a programme must
 * take effect immediately — not when the 600s/300s cache TTLs expire. The DB
 * stays the source of truth: without Redis, or if a delete fails, the
 * redirect falls back to a DB read and still serves the correct (paused)
 * page; the failure is only logged. This is the documented Redis dependency
 * of the kill switch (see API ASSUMPTIONS.md).
 */
async function deleteRouteKeys(
  tokens: string[],
  log?: FastifyRequest['log'],
): Promise<{ tokens: number; deleted: number; redisAvailable: boolean }> {
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

/**
 * One kill-switch transition — status change + outbox event + audit row —
 * in ONE transaction, then the route-cache invalidation after COMMIT.
 *
 * Why one transaction: the three writes are one fact ("X paused programme P").
 * Written separately, a failing audit insert (e.g. an actor that is not a
 * user row) returned 500 after the pause had already taken effect, with no
 * audit row and no outbox event. Now any failure rolls the status back and
 * the caller gets the error with nothing changed.
 *
 * Why the cache goes after COMMIT: deleting `route:{token}` before the new
 * status is visible would let a concurrent redirect re-cache the old status
 * from the DB. After commit, the next redirect read rebuilds from the new
 * status. The invalidation stays best-effort (logged, never fails the call).
 *
 * `update` is run with [$1 org_id, $2 programme id] and must `returning id`;
 * zero rows means the programme is no longer in a state the action accepts
 * (rolled back, `changed: false`, the caller answers 409).
 */
async function killSwitchTransition(opts: {
  orgId: string;
  programmeId: string;
  actorId: string;
  update: string;
  auditAction: string;
  eventType: string;
  eventPayload: (invalidatedRoutes: number, redisAvailable: boolean) => Record<string, unknown>;
  log?: FastifyRequest['log'];
}): Promise<{ changed: boolean; tokens: number; deleted: number; redisAvailable: boolean }> {
  const { orgId, programmeId } = opts;
  // Known before the transaction, so the event says what the invalidation
  // after commit can do.
  const redisAvailable = redis() !== null;

  const client: PoolClient = await getPool().connect();
  let tokens: string[];
  try {
    await client.query('BEGIN');
    const updated = await client.query(opts.update, [orgId, programmeId]);
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { changed: false, tokens: 0, deleted: 0, redisAvailable };
    }
    const links = await client.query<{ token: string }>(ACTIVE_LINK_TOKENS_SQL, [orgId, programmeId]);
    tokens = links.rows.map((r) => r.token);
    const envelope = buildEnvelope({
      source: 'api',
      event_type: opts.eventType,
      payload: opts.eventPayload(tokens.length, redisAvailable),
    });
    await client.query(
      `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
       values ($2, $1, $3, $4::jsonb, $5, now())`,
      [orgId, randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
    );
    await client.query(
      `insert into audit_log (org_id, actor_id, action, entity, entity_id)
       values ($1, $2, $3, 'programme', $4)`,
      [orgId, opts.actorId, opts.auditAction, programmeId],
    );
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rollback best-effort; the original error is what matters.
    }
    throw err;
  } finally {
    client.release();
  }

  const invalidation = await deleteRouteKeys(tokens, opts.log);
  return { changed: true, ...invalidation };
}

async function findProgramme(orgId: string, id: string): Promise<{ status: string }> {
  const found = await tenantQuery<{ status: string }>(
    orgId,
    `select status from programmes where org_id = $1 and id = $2`,
    [id],
  );
  const programme = found.rows[0];
  if (!programme) {
    throw new AppError('NOT_FOUND', 'Programme not found for this organisation', 404);
  }
  return programme;
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
 *   1, 5 and 6 commit together or not at all (killSwitchTransition); 3 runs
 *   after the commit. Idempotent: pausing an already-paused programme returns
 *   200 with the current state (the event, audit row and cache invalidation
 *   still run — cheap, safe, and a record of every pull).
 *
 * POST /v1/programmes/:id/resume — network_admin only.
 *   'paused' -> 'active' (+ same cache invalidation, because a route payload
 *   cached while paused would otherwise keep serving the paused page until
 *   TTL expiry). Resuming a non-paused programme is 409 (also when a
 *   concurrent resume won the race: the update is conditional on 'paused').
 */
export async function programmesRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/programmes/:id/pause',
    { preHandler: [requireAuth, requireRole('network_admin'), idempotencyCheck] },
    async (req, reply) => {
      const tenant = authed(req);
      const orgId = tenant.org_id;
      const { id } = parseOr400(ProgrammeParams, req.params);
      await findProgramme(orgId, id);

      // Unconditional (setting 'paused' on a paused row is a no-op), so an
      // idempotent re-pause records its event and audit row too.
      const result = await killSwitchTransition({
        orgId,
        programmeId: id,
        actorId: tenant.sub,
        update: `update programmes set status = 'paused' where org_id = $1 and id = $2 returning id`,
        auditAction: 'programme.pause',
        eventType: 'programme.paused',
        eventPayload: (invalidatedRoutes, redisAvailable) => ({
          programme_id: id,
          org_id: orgId,
          paused_by: tenant.sub,
          invalidated_routes: invalidatedRoutes,
          redis_available: redisAvailable,
        }),
        log: req.log,
      });
      if (!result.changed) {
        // The row vanished between the lookup and the update.
        throw new AppError('NOT_FOUND', 'Programme not found for this organisation', 404);
      }

      return reply.code(200).send(
        ok(req, {
          id,
          status: 'paused',
          invalidated_routes: result.tokens,
          cache_deleted: result.deleted,
          redis_available: result.redisAvailable,
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
      const programme = await findProgramme(orgId, id);
      if (programme.status !== 'paused') {
        throw new AppError(
          'CONFLICT',
          `Only a paused programme can be resumed (current: '${programme.status}')`,
          409,
        );
      }

      // Same invalidation after commit: a payload cached while paused must not
      // keep serving the paused page after resume.
      const result = await killSwitchTransition({
        orgId,
        programmeId: id,
        actorId: tenant.sub,
        update: `update programmes set status = 'active' where org_id = $1 and id = $2 and status = 'paused' returning id`,
        auditAction: 'programme.resume',
        eventType: 'programme.resumed',
        eventPayload: (invalidatedRoutes) => ({
          programme_id: id,
          org_id: orgId,
          resumed_by: tenant.sub,
          invalidated_routes: invalidatedRoutes,
        }),
        log: req.log,
      });
      if (!result.changed) {
        throw new AppError('CONFLICT', 'Only a paused programme can be resumed (it was resumed concurrently)', 409);
      }

      return reply.code(200).send(
        ok(req, {
          id,
          status: 'active',
          invalidated_routes: result.tokens,
          cache_deleted: result.deleted,
          redis_available: result.redisAvailable,
        }),
      );
    },
  );
}
