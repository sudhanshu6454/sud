import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tenantQuery } from '../db.js';
import { authed, requireAuth } from '../middleware.js';
import { ok, parseOr400 } from './_helpers.js';
import { displayablePrice, displayableStock } from '../offer-price.js';

const OffersQuery = z.object({
  variant_id: z.string().uuid().optional(),
  programme_id: z.string().uuid().optional(),
});

interface OfferRow {
  id: string;
  variant_id: string;
  programme_id: string;
  merchant_id: string;
  price_minor: string | null;
  price_as_of: string | Date | null;
  price_max_age_hours: number | null;
  currency: string;
  stock_status: string;
  offer_url: string;
}

/**
 * GET /v1/offers — only live offers: status='active' AND fresh_until in the
 * future. Stale or inactive offers are never served to publishers.
 * `price_minor` is null when the price may not be shown (src/offer-price.ts:
 * an Amazon offer without an API price younger than 1 hour), and then its
 * `stock_status` is 'unknown' (availability follows the same rule).
 */
export async function offersRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/offers', { preHandler: [requireAuth] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(OffersQuery, req.query);

    const filters: string[] = [`o.org_id = $1`, `o.status = 'active'`, `o.fresh_until > now()`];
    const params: unknown[] = [];
    if (q.variant_id) {
      params.push(q.variant_id);
      filters.push(`o.variant_id = $${params.length + 1}`);
    }
    if (q.programme_id) {
      params.push(q.programme_id);
      filters.push(`o.programme_id = $${params.length + 1}`);
    }

    const rows = await tenantQuery<OfferRow>(
      tenant.org_id,
      `select o.id, o.variant_id, o.programme_id, o.merchant_id,
              o.price_minor::text as price_minor, o.price_as_of, o.currency, o.stock_status, o.offer_url,
              pc.price_max_age_hours as price_max_age_hours
         from offers o
         left join programme_capabilities pc on pc.programme_id = o.programme_id
        where ${filters.join(' and ')}
        order by o.id`,
      params,
    );

    return ok(
      req,
      rows.rows.map(({ price_max_age_hours, ...o }) => {
        const price = displayablePrice({ price_minor: o.price_minor, price_as_of: o.price_as_of, price_max_age_hours });
        return { ...o, ...price, stock_status: displayableStock({ stock_status: o.stock_status, price_max_age_hours }, price) };
      }),
    );
  });
}
