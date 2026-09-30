import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, CELEBRITY_DISPLAY_LEVELS, CELEBRITY_RIGHTS_MATRIX, CELEBRITY_RIGHTS_STATUSES } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { ok, parseOr400 } from './_helpers.js';
import { CELEBRITY_COLS, loadCelebrity, type CelebrityRow } from '../looks/bundle.js';
import { celebrityView, createCelebrity, listReviews, reviewCelebrity, updateCelebrity } from '../looks/celebrities.js';
import { scoped, withTransaction, audit } from '../looks/sql.js';
import { invalidateAfterCommit } from '../looks/invalidate.js';

// ---------------------------------------------------------------------------
// Celebrities and their rights reviews (src/looks/celebrities.ts).
//
// GET  /v1/celebrities                  list (editors, the rights reviewer)
// POST /v1/celebrities                  create — always 'unreviewed'
// GET  /v1/celebrities/:id              one, with every review (append-only)
// POST /v1/celebrities/:id              edit (a rename or a minor flag goes back to 'unreviewed')
// POST /v1/celebrities/:id/rights-review
//                                       the rights reviewer: any status (with
//                                       note + evidence for editorial / cleared);
//                                       an editor or network_admin: 'blocked' only
// ---------------------------------------------------------------------------

const EDITORS = ['network_admin', 'editor'] as const;
const READERS = ['network_admin', 'editor', 'rights_reviewer'] as const;

const IdParams = z.object({ id: z.string().uuid() });
const ListQuery = z.object({
  rights_status: z.enum(CELEBRITY_RIGHTS_STATUSES).optional(),
  q: z.string().min(1).max(120).optional(),
});
const CreateBody = z.object({
  name: z.string().min(1).max(120),
  aliases: z.array(z.string().min(1).max(120)).max(20).optional(),
  is_minor: z.boolean().optional(),
  never_list: z.boolean().optional(),
});
const UpdateBody = CreateBody.partial();
const ReviewBody = z.object({
  rights_status: z.enum(CELEBRITY_RIGHTS_STATUSES),
  max_display: z.enum(CELEBRITY_DISPLAY_LEVELS).optional(),
  shoppable: z.boolean().optional(),
  note: z.string().max(1000).nullable().optional(),
  evidence_ref: z.string().max(300).nullable().optional(),
});

export async function celebritiesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/celebrities', { preHandler: [requireAuth, requireRole(...READERS)] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(ListQuery, req.query);
    const rows = (
      await tenantQuery<CelebrityRow>(
        tenant.org_id,
        `select ${CELEBRITY_COLS} from celebrities c where c.org_id = $1 ${q.rights_status ? 'and c.rights_status = $2' : ''} order by c.name, c.id`,
        q.rights_status ? [q.rights_status] : [],
      )
    ).rows;
    const needle = q.q?.toLowerCase();
    const items = rows.filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.aliases ?? []).some((a) => a.toLowerCase().includes(needle)));
    return ok(req, { items: items.map(celebrityView), matrix: CELEBRITY_RIGHTS_MATRIX });
  });

  app.post('/v1/celebrities', { preHandler: [requireAuth, requireRole(...EDITORS), idempotencyCheck] }, async (req, reply) => {
    const tenant = authed(req);
    const body = parseOr400(CreateBody, req.body);
    const created = await withTransaction(async (client) => {
      const q = scoped(client, tenant.org_id);
      const c = await createCelebrity(q, body);
      await audit(q, tenant.sub, 'celebrity.create', 'celebrity', c.id);
      return c;
    });
    // A new name can match text written before (a look's event, a storefront's name): public answers are recomputed.
    await invalidateAfterCommit({ tokens: [], tags: ['spotted', 'sitemap'] }, req.log);
    return reply.code(201).send(ok(req, celebrityView(created)));
  });

  app.get('/v1/celebrities/:id', { preHandler: [requireAuth, requireRole(...READERS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const c = await loadCelebrity(tenant.org_id, id);
    if (!c) throw new AppError('NOT_FOUND', 'Celebrity not found', 404);
    const looks = (
      await tenantQuery<{ id: string; status: string; title: string }>(
        tenant.org_id,
        `select id, status, title from looks where org_id = $1 and celebrity_id = $2 order by created_at, id`,
        [id],
      )
    ).rows;
    return ok(req, { ...celebrityView(c), reviews: await listReviews(tenant.org_id, id), looks });
  });

  app.post('/v1/celebrities/:id', { preHandler: [requireAuth, requireRole(...READERS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(UpdateBody, req.body ?? {});
    const c = await updateCelebrity(tenant.org_id, { id: tenant.sub, role: tenant.role }, id, body, req.log);
    return ok(req, celebrityView(c));
  });

  app.post('/v1/celebrities/:id/rights-review', { preHandler: [requireAuth, requireRole(...READERS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(ReviewBody, req.body);
    const out = await reviewCelebrity(tenant.org_id, { id: tenant.sub, role: tenant.role }, id, body, req.log);
    return ok(req, {
      celebrity: celebrityView(out.celebrity),
      review_id: out.review_id,
      links_paused: out.links_paused,
      links_reactivated: out.links_reactivated,
      invalidation: out.invalidation,
    });
  });
}
