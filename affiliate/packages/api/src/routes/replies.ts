import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, PUBLIC_REPLY_TEMPLATES, REPLY_EVENT_STATUSES, buildReplyText, utf8ByteLength } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { ok, parseOr400 } from './_helpers.js';
import { createRule, getRule, listAccounts, listRules, mapAccount, recentReplyEvents, updateRule, type RuleView } from '../looks/replies.js';
import { lookPageUrl, siteOrigin } from '../looks/instant-links.js';
import { toIso } from '../looks/sql.js';

// ---------------------------------------------------------------------------
// Comment replies: the rules (a post of an in-house page + keywords → one
// private reply with the look's afflino.com URL) and the Meta accounts they
// run on (src/looks/replies.ts; the sender is the workers').
//
// GET  /v1/replies/rules           (?look_id=)
// POST /v1/replies/rules           create (disabled unless enabled: true, and only for a public look)
// POST /v1/replies/rules/:id       keywords / public_reply (one of public_reply_templates) / enabled
// GET  /v1/replies/rules/:id/events  counts by status (no commenter data exists to show)
// GET  /v1/replies/events          the latest events: time, page, keyword, status — never the
//                                  comment id, the commenter's hash, the media id or Meta's message id
// GET  /v1/replies/accounts        the mapped Meta accounts and their messaging status
//
// Every rule carries `look_url` and `dm_preview`: the exact private reply the
// workers would send for it (@paparazzi/shared buildReplyText; null with
// `dm_refusal` when the site origin makes the text unsendable, e.g. not https).
// POST /v1/replies/accounts        map a property to its Meta account id by hand
// ---------------------------------------------------------------------------

const EDITORS = ['network_admin', 'editor'] as const;
const IdParams = z.object({ id: z.string().uuid() });
const ListQuery = z.object({ look_id: z.string().uuid().optional() });
const CreateBody = z.object({
  look_id: z.string().uuid(),
  platform_post_id: z.string().min(1).max(100).nullable().optional(),
  keywords: z.array(z.string().min(1).max(60)).min(1).max(10),
  public_reply: z.string().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
});
const UpdateBody = z.object({
  keywords: z.array(z.string().min(1).max(60)).min(1).max(10).optional(),
  public_reply: z.string().max(300).nullable().optional(),
  enabled: z.boolean().optional(),
});
const EventsQuery = z.object({
  rule_id: z.string().uuid().optional(),
  status: z.enum(REPLY_EVENT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const AccountBody = z.object({
  property_id: z.string().uuid(),
  meta_account_id: z.string().min(1).max(64),
  linked_page_id: z.string().max(64).nullable().optional(),
});

/** A rule as the admin sees it: plus the look's afflino.com URL and the exact message that would go out. */
export function ruleWithPreview(r: RuleView) {
  const lookUrl = lookPageUrl(r.look_id);
  try {
    const text = buildReplyText({ lookUrl, siteOrigin: siteOrigin() });
    return { ...r, look_url: lookUrl, dm_preview: text, dm_bytes: utf8ByteLength(text), dm_refusal: null };
  } catch (err) {
    const why = err instanceof Error ? err.message.replace(/^reply text refused: /, '') : 'refused';
    return { ...r, look_url: lookUrl, dm_preview: null, dm_bytes: null, dm_refusal: why };
  }
}

export async function repliesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/replies/rules', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(ListQuery, req.query);
    return ok(req, { items: (await listRules(tenant.org_id, q.look_id)).map(ruleWithPreview), public_reply_templates: PUBLIC_REPLY_TEMPLATES });
  });

  app.post('/v1/replies/rules', { preHandler: [requireAuth, requireRole(...EDITORS), idempotencyCheck] }, async (req, reply) => {
    const tenant = authed(req);
    const body = parseOr400(CreateBody, req.body);
    return reply.code(201).send(ok(req, ruleWithPreview(await createRule(tenant.org_id, tenant.sub, body))));
  });

  app.post('/v1/replies/rules/:id', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(UpdateBody, req.body ?? {});
    return ok(req, ruleWithPreview(await updateRule(tenant.org_id, tenant.sub, id, body)));
  });

  app.get('/v1/replies/rules/:id/events', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    if (!(await getRule(tenant.org_id, id))) throw new AppError('NOT_FOUND', 'Rule not found', 404);
    const rows = (
      await tenantQuery<{ status: string; n: string | number; last: string | Date | null }>(
        tenant.org_id,
        `select status, count(*) as n, max(received_at) as last from reply_events where org_id = $1 and rule_id = $2 group by status`,
        [id],
      )
    ).rows;
    return ok(req, { rule_id: id, by_status: rows.map((r) => ({ status: r.status, count: Number(r.n), last_received_at: toIso(r.last) })) });
  });

  app.get('/v1/replies/events', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(EventsQuery, req.query);
    return ok(req, { items: await recentReplyEvents(tenant.org_id, q) });
  });

  app.get('/v1/replies/accounts', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    return ok(req, { items: await listAccounts(tenant.org_id) });
  });

  app.post('/v1/replies/accounts', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const body = parseOr400(AccountBody, req.body);
    return ok(req, await mapAccount(tenant.org_id, tenant.sub, body));
  });
}
