import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { authed, requireAuth } from '../middleware.js';
import { redirectLinkUrl } from '../redirect-url.js';
import { displayablePrice, displayableStock } from '../offer-price.js';
import { ok, parseOr400 } from './_helpers.js';

// ---------------------------------------------------------------------------
// Catalogue endpoints (consumer shop)
//
// GET /v1/looks      — paginated list of published looks (any authenticated role)
// GET /v1/looks/:id  — one look with its items, the live offer per item and,
//                      when a placement is given, the tracked link per offer.
//
// The consumer only ever sees TRACKED links: offers.offer_url (the raw
// merchant URL) is never selected by any query in this file. Every query is
// tenant-scoped through tenantQuery ($1 = org_id).
// ---------------------------------------------------------------------------

const LooksQuery = z.object({
  // bounded so an absurd page is a 400, not an out-of-range OFFSET (500) from Postgres
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  locale: z.string().min(2).max(10).optional(),
  category: z.string().min(1).max(100).optional(),
});

const LookParams = z.object({ id: z.string().uuid() });

const LookDetailQuery = z.object({
  placement_id: z.string().uuid().optional(),
});

/** Roles that may see a look in any status; everyone else sees only 'published'. */
const UNPUBLISHED_VISIBLE_ROLES: ReadonlySet<string> = new Set(['editor', 'network_admin']);

interface LookListRow {
  id: string;
  title: string;
  locale: string;
  category: string | null;
  published_at: string | Date | null;
  source_page: string | null;
  sponsored: boolean;
  cover_url: string | null;
  item_count: string | number;
}

interface LookDetailRow {
  id: string;
  title: string;
  locale: string;
  category: string | null;
  status: string;
  published_at: string | Date | null;
  source_page: string | null;
  sponsored: boolean;
  cover_url: string | null;
}

interface PlacementRef {
  id: string;
  property_id: string;
  campaign_id: string;
}

interface LookItemRow {
  id: string;
  match_type: string | null;
  evidence: string | null;
  variant_id: string;
  size_text: string | null;
  colour: string | null;
  merchant_sku: string | null;
  product_id: string;
  brand: string;
  model: string;
  product_category: string;
}

interface LiveOfferRow {
  id: string;
  programme_id: string;
  merchant_id: string;
  merchant_name: string;
  price_minor: string | number | null;
  price_as_of: string | Date | null;
  price_max_age_hours: number | null;
  disclosure_text: string | null;
  connector: string;
  currency: string;
  stock_status: string;
  fresh_until: string | Date;
}

/** timestamptz → ISO-8601 string (pg returns Date, pg-mem returns Date, `::text` casts return pg text). */
function toIso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value).toISOString();
}

/**
 * The live offer for a variant: offer active + fresh AND its programme
 * active (a paused programme's offers are not shoppable). Several live
 * offers → the cheapest, ties broken by id; an offer without a price (an
 * Amazon offer before or after its price's hour) sorts last. `offer_url`
 * is deliberately NOT in the select list. The price shown is
 * displayablePrice (src/offer-price.ts), and so is the stock status
 * (displayableStock: availability is under the same age limit);
 * `disclosure_text` is the programme's own disclosure (Amazon: the Operating
 * Agreement's statement) and `connector` tells the shop which merchant copy
 * to show (Amazon: "Buy on Amazon.in", the price disclaimer).
 */
const LIVE_OFFER_SQL = `
  select o.id, o.programme_id, o.merchant_id, m.name as merchant_name, pr.connector as connector,
         o.price_minor::text as price_minor, o.price_as_of, o.currency, o.stock_status, o.fresh_until,
         pc.price_max_age_hours as price_max_age_hours, aa.disclosure_text as disclosure_text
    from offers o
    join programmes pr on pr.id = o.programme_id and pr.org_id = $1
    join merchants m on m.id = o.merchant_id and m.org_id = $1
    left join programme_capabilities pc on pc.programme_id = o.programme_id
    left join amazon_associates_accounts aa on aa.programme_id = o.programme_id and aa.org_id = $1
   where o.org_id = $1 and o.variant_id = $2
     and o.status = 'active' and o.fresh_until > now()
     and pr.status = 'active'
   order by o.price_minor asc nulls last, o.id asc
   limit 1`;

export async function looksRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /v1/looks — paginated list of published looks for the tenant.
   * Any authenticated role may browse. Each item carries the cover image
   * URL (assets.public_url of cover_asset_id while its licence has not
   * expired, i.e. assets.expires_at null or in the future; else null), the sponsored
   * flag, the source page and the number of look_items rows.
   */
  app.get('/v1/looks', { preHandler: [requireAuth] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(LooksQuery, req.query);

    const filters: string[] = [`l.org_id = $1`, `l.status = 'published'`];
    const params: unknown[] = [];
    if (q.locale) {
      params.push(q.locale);
      filters.push(`l.locale = $${params.length + 1}`);
    }
    if (q.category) {
      params.push(q.category);
      filters.push(`l.category = $${params.length + 1}`);
    }
    const where = `where ${filters.join(' and ')}`;

    const total = await tenantQuery<{ total: string }>(
      tenant.org_id,
      `select count(*)::text as total from looks l ${where}`,
      params,
    );

    // $1 is org_id (prepended by tenantQuery), so the Nth pushed param is $(N+1):
    // after the push, page_size is $limitIdx and the offset is $(limitIdx + 1).
    params.push(q.page_size, (q.page - 1) * q.page_size);
    const limitIdx = params.length;
    const rows = await tenantQuery<LookListRow>(
      tenant.org_id,
      `select l.id, l.title, l.locale, l.category, l.published_at,
              l.source_page, l.sponsored, a.public_url as cover_url,
              coalesce(ic.item_count, 0) as item_count
         from looks l
         left join assets a on a.id = l.cover_asset_id and a.org_id = l.org_id
                           and (a.expires_at is null or a.expires_at > now())
         left join (select look_id, count(*) as item_count
                      from look_items where org_id = $1 group by look_id) ic
                on ic.look_id = l.id
        ${where}
        order by l.published_at desc nulls last, l.id
        limit $${limitIdx} offset $${limitIdx + 1}`,
      params,
    );

    return ok(req, {
      items: rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        locale: r.locale,
        category: r.category,
        published_at: toIso(r.published_at),
        source_page: r.source_page,
        sponsored: r.sponsored === true,
        cover_url: r.cover_url ?? null,
        item_count: Number(r.item_count ?? 0),
      })),
      page: q.page,
      page_size: q.page_size,
      total: Number(total.rows[0]?.total ?? '0'),
    });
  });

  /**
   * GET /v1/looks/:id — one look with items, live offers and tracked links.
   *
   * Visibility (all 404 NOT_FOUND, never 403 — the consumer must not learn
   * that a draft exists):
   * - look not in the caller's org                         → 404
   * - look not 'published' and role ∉ {editor, network_admin} → 404
   * - placement_id given but not in the caller's org       → 404
   *
   * items are ordered by created_at then id. Per item: the live offer (see
   * LIVE_OFFER_SQL) or null; and, only when placement_id was given, the
   * active links row for (placement_id, offer.id) as { token, url } with
   * url composed exactly as POST /v1/links composes it. No placement →
   * link: null and placement: null.
   */
  app.get('/v1/looks/:id', { preHandler: [requireAuth] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(LookParams, req.params);
    const q = parseOr400(LookDetailQuery, req.query);
    const orgId = tenant.org_id;

    const lookRes = await tenantQuery<LookDetailRow>(
      orgId,
      `select l.id, l.title, l.locale, l.category, l.status, l.published_at,
              l.source_page, l.sponsored, a.public_url as cover_url
         from looks l
         left join assets a on a.id = l.cover_asset_id and a.org_id = l.org_id
                           and (a.expires_at is null or a.expires_at > now())
        where l.org_id = $1 and l.id = $2`,
      [id],
    );
    const look = lookRes.rows[0];
    if (!look || (look.status !== 'published' && !UNPUBLISHED_VISIBLE_ROLES.has(tenant.role))) {
      throw new AppError('NOT_FOUND', 'Look not found', 404);
    }

    let placement: PlacementRef | null = null;
    if (q.placement_id) {
      const placementRes = await tenantQuery<PlacementRef>(
        orgId,
        `select id, property_id, campaign_id from placements where org_id = $1 and id = $2`,
        [q.placement_id],
      );
      placement = placementRes.rows[0] ?? null;
      if (!placement) {
        throw new AppError('NOT_FOUND', 'Placement not found for this organisation', 404);
      }
    }

    const itemRes = await tenantQuery<LookItemRow>(
      orgId,
      `select li.id, li.match_type, li.evidence, li.variant_id,
              v.size_text, v.colour, v.merchant_sku,
              p.id as product_id, p.brand, p.model, p.category as product_category
         from look_items li
         join variants v on v.id = li.variant_id and v.org_id = $1
         join products p on p.id = v.product_id and p.org_id = $1
        where li.org_id = $1 and li.look_id = $2
        order by li.created_at, li.id`,
      [look.id],
    );

    // Items per look are few (single digits); two plain queries per item
    // keep the SQL pg-mem-safe (no LATERAL, no array params).
    const items = [];
    for (const it of itemRes.rows) {
      const offerRes = await tenantQuery<LiveOfferRow>(orgId, LIVE_OFFER_SQL, [it.variant_id]);
      const offerRow = offerRes.rows[0];

      let offer: {
        id: string;
        programme_id: string;
        connector: string;
        merchant: { id: string; name: string };
        price_minor: number | null;
        price_as_of: string | null;
        currency: string;
        stock_status: string;
        fresh_until: string;
        disclosure: string | null;
      } | null = null;
      let link: { token: string; url: string } | null = null;

      if (offerRow) {
        const price = displayablePrice(offerRow);
        offer = {
          id: offerRow.id,
          programme_id: offerRow.programme_id,
          connector: offerRow.connector,
          merchant: { id: offerRow.merchant_id, name: offerRow.merchant_name },
          price_minor: price.price_minor,
          price_as_of: price.price_as_of,
          currency: offerRow.currency,
          stock_status: displayableStock(offerRow, price),
          fresh_until: toIso(offerRow.fresh_until) as string,
          disclosure: offerRow.disclosure_text ?? null,
        };
        if (placement) {
          const linkRes = await tenantQuery<{ token: string }>(
            orgId,
            `select token from links
              where org_id = $1 and placement_id = $2 and offer_id = $3 and status = 'active'
              order by created_at desc, id
              limit 1`,
            [placement.id, offerRow.id],
          );
          const token = linkRes.rows[0]?.token;
          if (token) link = { token, url: redirectLinkUrl(token) };
        }
      }

      items.push({
        id: it.id,
        match_type: it.match_type,
        evidence: it.evidence,
        product: { id: it.product_id, brand: it.brand, model: it.model, category: it.product_category },
        variant: { id: it.variant_id, size_text: it.size_text, colour: it.colour, merchant_sku: it.merchant_sku },
        offer,
        link,
      });
    }

    return ok(req, {
      id: look.id,
      title: look.title,
      locale: look.locale,
      category: look.category,
      status: look.status,
      published_at: toIso(look.published_at),
      source_page: look.source_page,
      sponsored: look.sponsored === true,
      cover_url: look.cover_url ?? null,
      items,
      placement,
    });
  });
}
