import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantQuery } from '../db.js';
import { authed, requireAuth } from '../middleware.js';
import { ok, parseOr400 } from './_helpers.js';

const LooksQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  locale: z.string().min(2).max(10).optional(),
  category: z.string().min(1).max(100).optional(),
});

interface LookRow {
  id: string;
  title: string;
  locale: string;
  category: string;
  published_at: string | null;
}

/**
 * GET /v1/looks — paginated list of published looks for the tenant.
 * Any authenticated role may browse.
 */
export async function looksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/looks', { preHandler: [requireAuth] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(LooksQuery, req.query);

    const filters: string[] = [`org_id = $1`, `status = 'published'`];
    const params: unknown[] = [];
    if (q.locale) {
      params.push(q.locale);
      filters.push(`locale = $${params.length + 1}`);
    }
    if (q.category) {
      params.push(q.category);
      filters.push(`category = $${params.length + 1}`);
    }
    const where = `where ${filters.join(' and ')}`;

    const total = await tenantQuery<{ total: string }>(
      tenant.org_id,
      `select count(*)::text as total from looks ${where}`,
      params,
    );

    params.push(q.page_size, (q.page - 1) * q.page_size);
    const rows = await tenantQuery<LookRow>(
      tenant.org_id,
      `select id, title, locale, category, published_at::text as published_at
         from looks ${where}
        order by published_at desc nulls last, id
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );

    return ok(req, {
      items: rows.rows,
      page: q.page,
      page_size: q.page_size,
      total: Number(total.rows[0]?.total ?? '0'),
    });
  });
}
