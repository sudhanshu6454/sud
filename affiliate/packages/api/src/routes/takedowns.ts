import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@paparazzi/shared';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { ok, parseOr400 } from './_helpers.js';
import { TAKEDOWN_REASONS, getTakedown, listTakedowns, markPostsRemoved, restoreTakedown, takeDown } from '../looks/takedown.js';

// ---------------------------------------------------------------------------
// Takedowns (src/looks/takedown.ts): one call withdraws a celebrity (every
// look) or one look — 410 on every public endpoint at once, links paused,
// comment replies off, caches cleared — with an audit trail and the SLA
// timestamps. Anyone on the editorial side may pull one; only the rights
// reviewer restores, after a new rights review.
//
// GET  /v1/takedowns                    list (?status=active|restored), with each one's SLA mark
// GET  /v1/takedowns/:id                one, with its looks and the posts to delete on Meta
// POST /v1/takedowns                    pull
// POST /v1/takedowns/:id/restore        restore (rights_reviewer)
// POST /v1/takedowns/:id/posts-removed  the owner's record that the in-house posts were deleted
// ---------------------------------------------------------------------------

const ANYONE = ['network_admin', 'editor', 'rights_reviewer'] as const;

const IdParams = z.object({ id: z.string().uuid() });
const ListQuery = z.object({ status: z.enum(['active', 'restored']).optional() });
const CreateBody = z
  .object({
    scope: z.enum(['celebrity', 'look']),
    celebrity_id: z.string().uuid().optional(),
    look_id: z.string().uuid().optional(),
    reason_code: z.enum(TAKEDOWN_REASONS),
    reason_note: z.string().max(500).nullable().optional(),
    requester_ref: z.string().max(200).nullable().optional(),
    requested_at: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((b) => (b.scope === 'celebrity' ? !!b.celebrity_id && !b.look_id : !!b.look_id && !b.celebrity_id), {
    message: 'scope celebrity takes celebrity_id; scope look takes look_id',
  });
const RestoreBody = z.object({ note: z.string().min(3).max(1000) });
const PostsBody = z.object({ look_ids: z.array(z.string().uuid()).min(1).max(1000) });

export async function takedownsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/takedowns', { preHandler: [requireAuth, requireRole(...ANYONE)] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(ListQuery, req.query);
    return ok(req, { items: await listTakedowns(tenant.org_id, q.status) });
  });

  app.get('/v1/takedowns/:id', { preHandler: [requireAuth, requireRole(...ANYONE)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const td = await getTakedown(tenant.org_id, id);
    if (!td) throw new AppError('NOT_FOUND', 'Takedown not found', 404);
    return ok(req, td);
  });

  app.post('/v1/takedowns', { preHandler: [requireAuth, requireRole(...ANYONE), idempotencyCheck] }, async (req, reply) => {
    const tenant = authed(req);
    const body = parseOr400(CreateBody, req.body);
    const out = await takeDown(tenant.org_id, tenant.sub, body, req.log);
    return reply.code(out.created ? 201 : 200).send(ok(req, out));
  });

  app.post('/v1/takedowns/:id/restore', { preHandler: [requireAuth, requireRole('rights_reviewer')] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const { note } = parseOr400(RestoreBody, req.body);
    return ok(req, await restoreTakedown(tenant.org_id, { id: tenant.sub, role: tenant.role }, id, note, req.log));
  });

  app.post('/v1/takedowns/:id/posts-removed', { preHandler: [requireAuth, requireRole(...ANYONE)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const { look_ids } = parseOr400(PostsBody, req.body);
    return ok(req, { marked: await markPostsRemoved(tenant.org_id, tenant.sub, id, look_ids) });
  });
}
