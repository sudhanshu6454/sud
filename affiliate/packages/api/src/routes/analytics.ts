import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { ok, parseOr400 } from './_helpers.js';
import { CLICK_GROUPS, clickAnalytics, replyAnalytics } from '../looks/analytics.js';

// ---------------------------------------------------------------------------
// Analytics from the daily rollups (src/looks/analytics.ts), read-only.
// GET /v1/analytics/clicks?from&to&group_by=day|look|celebrity|piece|property|link|via
// GET /v1/analytics/replies?from&to
// ---------------------------------------------------------------------------

// The whole organisation's figures (celebrities, looks, every page): the network's own operators only.
// A creator (publisher_owner) sees their own earnings through GET /v1/publisher/earnings.
const ROLES = ['network_admin', 'editor'] as const;
const Range = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const ClicksQuery = Range.extend({ group_by: z.enum(CLICK_GROUPS).default('day') });

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/analytics/clicks', { preHandler: [requireAuth, requireRole(...ROLES)] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(ClicksQuery, req.query);
    return ok(req, await clickAnalytics(tenant.org_id, q));
  });

  app.get('/v1/analytics/replies', { preHandler: [requireAuth, requireRole(...ROLES)] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(Range, req.query);
    return ok(req, await replyAnalytics(tenant.org_id, q));
  });
}
