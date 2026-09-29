import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantQuery } from '../db.js';
import { authed, requireAuth } from '../middleware.js';
import { ok, parseOr400 } from './_helpers.js';

const OffersQuery = z.object({
  variant_id: z.string().uuid().optional(),
  programme_id: z.string().uuid().optional(),
});

interface OfferRow {
  id: string;
  variant_id: string;
  programme_id: string;
  merchant_id: string;
  price_minor: string;
  currency: string;
  stock_status: string;
  offer_url: string;
}

/**
 * GET /v1/offers — only live offers: status='active' AND fresh_until in the
 * future. Stale or inactive offers are never served to publishers.
 */
export async function offersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/offers', { preHandler: [requireAuth] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(OffersQuery, req.query);

    const filters: string[] = [`org_id = $1`, `status = 'active'`, `fresh_until > now()`];
    const params: unknown[] = [];
    if (q.variant_id) {
      params.push(q.variant_id);
      filters.push(`variant_id = $${params.length + 1}`);
    }
    if (q.programme_id) {
      params.push(q.programme_id);
      filters.push(`programme_id = $${params.length + 1}`);
    }

    const rows = await tenantQuery<OfferRow>(
      tenant.org_id,
      `select id, variant_id, programme_id, merchant_id,
              price_minor::text as price_minor, currency, stock_status, offer_url
         from offers
        where ${filters.join(' and ')}
        order by id`,
      params,
    );

    return ok(
      req,
      rows.rows.map((o) => ({ ...o, price_minor: Number(o.price_minor) })),
    );
  });
}
