import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, GARMENT_CATEGORIES, LOOK_DISPLAY_MODES, PLACE_KINDS, apiError } from '@paparazzi/shared';
import { getPool, tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { ok, parseOr400 } from './_helpers.js';
import { editorialLook, loadLookBundle } from '../looks/bundle.js';
import { publishGate, type GateReport } from '../looks/gate.js';
import {
  addPiece,
  confirmPlace,
  createLook,
  reviewLookItem,
  removeLookItem,
  removePiece,
  tagPieceItem,
  transitionLook,
  updateAsset,
  updateLook,
  updatePiece,
  upsertStorefront,
} from '../looks/editorial.js';
import { ensureLookLinks } from '../looks/look-links.js';
import { instantLinks, lookPageUrl } from '../looks/instant-links.js';
import { isoDate, toIso } from '../looks/sql.js';
import { LibraryImportRefusal, checkLibrary, importLibrary } from '../looks/library-import.js';

// ---------------------------------------------------------------------------
// The editors' API for celebrity looks (network_admin, editor; reads also the
// rights reviewer). Everything a public page shows is decided again at read
// time (src/looks/bundle.ts); these routes only record decisions.
//
//   looks        GET/POST /v1/editorial/looks, GET/POST /v1/editorial/looks/:id,
//                POST /v1/editorial/looks/:id/transition, POST /v1/editorial/looks/:id/links
//   pieces       POST /v1/editorial/looks/:id/pieces, POST /v1/editorial/pieces/:id,
//                POST /v1/editorial/pieces/:id/remove, POST /v1/editorial/pieces/:id/items
//   place        POST /v1/editorial/looks/:id/confirm-place (the rights reviewer: a street / other place)
//   items        POST /v1/editorial/look-items/:id/review, POST /v1/editorial/look-items/:id/remove
//   assets       POST /v1/editorial/assets/:id   (licence metadata, the frame screen; widening = the rights reviewer)
//   instant      POST /v1/editorial/instant-links
//   storefronts  GET/POST /v1/editorial/storefronts, POST /v1/editorial/storefronts/:id
//   pages        GET /v1/editorial/properties (the in-house pages instant links and storefronts use)
//   library      POST /v1/editorial/library/import (dry_run: the check, nothing written)
// ---------------------------------------------------------------------------

const EDITORS = ['network_admin', 'editor'] as const;
const READERS = ['network_admin', 'editor', 'rights_reviewer'] as const;

const IdParams = z.object({ id: z.string().uuid() });
const nullableText = (max: number) => z.string().max(max).nullable().optional();
const LookBody = z.object({
  title: z.string().min(1).max(200).optional(),
  event_name: nullableText(120),
  place: nullableText(120),
  place_kind: z.enum(PLACE_KINDS).nullable().optional(),
  moment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  property_id: z.string().uuid().nullable().optional(),
  post_permalink: z.string().url().max(500).nullable().optional(),
  platform_post_id: nullableText(100),
  still_asset_id: z.string().uuid().nullable().optional(),
  source_video_asset_id: z.string().uuid().nullable().optional(),
  celebrity_display: z.enum(LOOK_DISPLAY_MODES).optional(),
  sponsored: z.boolean().optional(),
});
const CreateLookBody = LookBody.extend({ celebrity_id: z.string().uuid() });
const UpdateLookBody = LookBody.extend({ celebrity_id: z.string().uuid().optional() });
const ListQuery = z.object({
  status: z.enum(['draft', 'in_review', 'ready', 'published', 'paused', 'withdrawn']).optional(),
  celebrity_id: z.string().uuid().optional(),
  /** Only looks with an EXACT tag waiting for its second person (the reviewer's queue). */
  pending_exact: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});
const TransitionBody = z.object({ to: z.enum(['draft', 'in_review', 'ready', 'published', 'paused']) });
const Hotspot = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
const PieceBody = z.object({
  label: z.string().min(1).max(60),
  garment_category: z.enum(GARMENT_CATEGORIES),
  position: z.number().int().min(0).max(1000).optional(),
  hotspot: Hotspot.nullable().optional(),
});
const PieceUpdateBody = PieceBody.partial();
const TagBody = z
  .object({
    variant_id: z.string().uuid().optional(),
    offer_id: z.string().uuid().optional(),
    match_type: z.enum(['exact', 'similar']).default('similar'),
    evidence: z.string().max(2000).nullable().optional(),
    evidence_source: z.string().max(500).nullable().optional(),
    evidence_captured_at: z.string().datetime({ offset: true }).nullable().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((b) => b.variant_id || b.offer_id, { message: 'variant_id or offer_id is required' });
const ReviewBody = z.object({ decision: z.enum(['approve', 'downgrade', 'reject']) });
const ConfirmPlaceBody = z.object({ note: z.string().min(3).max(300) });
const AssetBody = z.object({
  public_url: z.string().url().max(1000).nullable().optional(),
  license: z.string().min(1).max(200).optional(),
  commercial_reuse: z.enum(['yes', 'no', 'unknown']).optional(),
  territory: z.string().min(2).max(100).regex(/^[A-Za-z]{2}(,[A-Za-z]{2})*$/).nullable().optional(),
  expires_at: z.string().max(40).nullable().optional(),
  source_ref: nullableText(300),
  copyright_owner: nullableText(200),
  author: nullableText(200),
  acquisition: z.enum(['staff', 'freelance', 'agency', 'licensed', 'other']).nullable().optional(),
  assignment_ref: nullableText(300),
  live_performance: z.boolean().optional(),
  minor_in_frame: z.boolean().optional(),
  bystanders: z.boolean().optional(),
  sensitive_location: z.boolean().optional(),
  screen_status: z.enum(['unscreened', 'passed', 'rejected']).optional(),
});
const InstantBody = z.object({
  asin_or_url: z.string().min(10).max(500),
  brand: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  category: z.string().min(1).max(200),
  size: nullableText(100),
  colour: nullableText(100),
  property_ids: z.array(z.string().uuid()).max(50).default([]),
  piece_id: z.string().uuid().nullable().optional(),
  match_type: z.enum(['exact', 'similar']).optional(),
  evidence: z.string().max(2000).nullable().optional(),
  evidence_source: z.string().max(500).nullable().optional(),
  evidence_captured_at: z.string().datetime({ offset: true }).nullable().optional(),
  ttl_days: z.number().int().min(1).max(365).optional(),
});
/** The admin's library upload (the owner's server line reads the same file format: looks.sh import). */
export const LIBRARY_UPLOAD_MAX_CHARS = 900_000;
const LibraryBody = z.object({
  csv_text: z.string().min(1).max(LIBRARY_UPLOAD_MAX_CHARS),
  dry_run: z.boolean().default(true),
});
const StorefrontBody = z.object({
  property_id: z.string().uuid().optional(),
  slug: z.string().min(1).max(80).optional(),
  display_name: z.string().min(1).max(80).optional(),
  bio: z.string().max(300).nullable().optional(),
  status: z.enum(['draft', 'live', 'hidden']).optional(),
});

export async function editorialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/editorial/looks', { preHandler: [requireAuth, requireRole(...READERS)] }, async (req) => {
    const tenant = authed(req);
    const q = parseOr400(ListQuery, req.query);
    const filters = ['l.org_id = $1', 'l.celebrity_id is not null'];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      filters.push(`l.status = $${params.length + 1}`);
    }
    if (q.celebrity_id) {
      params.push(q.celebrity_id);
      filters.push(`l.celebrity_id = $${params.length + 1}`);
    }
    if (q.pending_exact === 'true') {
      filters.push(`l.id in (select li.look_id from look_items li where li.org_id = $1 and li.match_type = 'exact' and li.review_state = 'pending' and li.removed_at is null)`);
    }
    params.push(q.page_size, (q.page - 1) * q.page_size);
    const rows = (
      await tenantQuery<{ id: string; title: string; status: string; event_name: string | null; moment_date: string | Date | null; published_at: string | Date | null; takedown_id: string | null; celebrity_id: string; c_name: string; c_status: string; library_ref: string | null }>(
        tenant.org_id,
        `select l.id, l.title, l.status, l.event_name, l.moment_date, l.published_at, l.takedown_id, l.celebrity_id, l.library_ref,
                c.name as c_name, c.rights_status as c_status
           from looks l join celebrities c on c.id = l.celebrity_id and c.org_id = $1
          where ${filters.join(' and ')}
          order by l.created_at desc, l.id
          limit $${params.length} offset $${params.length + 1}`,
        params,
      )
    ).rows;
    const pending = new Map<string, number>();
    if (rows.length) {
      for (const r of (
        await tenantQuery<{ look_id: string; n: string | number }>(
          tenant.org_id,
          `select look_id, count(*) as n from look_items
            where org_id = $1 and look_id = any($2) and match_type = 'exact' and review_state = 'pending' and removed_at is null
            group by look_id`,
          [rows.map((r) => r.id)],
        )
      ).rows) {
        pending.set(r.look_id, Number(r.n));
      }
    }
    return ok(req, {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        pending_exact: pending.get(r.id) ?? 0,
        library_ref: r.library_ref,
        event: r.event_name,
        moment_date: isoDate(r.moment_date),
        published_at: toIso(r.published_at),
        takedown_id: r.takedown_id,
        celebrity: { id: r.celebrity_id, name: r.c_name, rights_status: r.c_status },
      })),
      page: q.page,
      page_size: q.page_size,
    });
  });

  app.post('/v1/editorial/looks', { preHandler: [requireAuth, requireRole(...EDITORS), idempotencyCheck] }, async (req, reply) => {
    const tenant = authed(req);
    const body = parseOr400(CreateLookBody, req.body);
    const id = await createLook(tenant.org_id, tenant.sub, body);
    const b = await loadLookBundle(tenant.org_id, id);
    return reply.code(201).send(ok(req, editorialLook(b as NonNullable<typeof b>)));
  });

  app.get('/v1/editorial/looks/:id', { preHandler: [requireAuth, requireRole(...READERS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const b = await loadLookBundle(tenant.org_id, id);
    if (!b || !b.look.celebrity_id) throw new AppError('NOT_FOUND', 'Look not found', 404);
    return ok(req, { ...editorialLook(b), gate: await publishGate(tenant.org_id, b), look_url: lookPageUrl(id) });
  });

  app.post('/v1/editorial/looks/:id', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(UpdateLookBody, req.body ?? {});
    await updateLook(tenant.org_id, tenant.sub, id, body);
    const b = await loadLookBundle(tenant.org_id, id);
    return ok(req, editorialLook(b as NonNullable<typeof b>));
  });

  app.post('/v1/editorial/looks/:id/transition', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req, reply) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const { to } = parseOr400(TransitionBody, req.body);
    try {
      const out = await transitionLook(tenant.org_id, tenant.sub, id, to, req.log);
      return ok(req, out);
    } catch (err) {
      const gate = (err as { gate?: GateReport }).gate;
      if (err instanceof AppError && gate) {
        return reply.code(409).send({ ...apiError(err.code, err.message, req.requestId), gate });
      }
      throw err;
    }
  });

  app.post('/v1/editorial/looks/:id/confirm-place', { preHandler: [requireAuth, requireRole('rights_reviewer')] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const { note } = parseOr400(ConfirmPlaceBody, req.body);
    await confirmPlace(tenant.org_id, { id: tenant.sub, role: tenant.role }, id, note);
    const b = await loadLookBundle(tenant.org_id, id);
    return ok(req, editorialLook(b as NonNullable<typeof b>));
  });

  app.post('/v1/editorial/looks/:id/links', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const b = await loadLookBundle(tenant.org_id, id);
    if (!b || !b.look.celebrity_id) throw new AppError('NOT_FOUND', 'Look not found', 404);
    if (b.look.status !== 'published') throw new AppError('CONFLICT', "a look's own links exist while it is published", 409);
    return ok(req, await ensureLookLinks(tenant.org_id, id, req.log));
  });

  app.post('/v1/editorial/looks/:id/pieces', { preHandler: [requireAuth, requireRole(...EDITORS), idempotencyCheck] }, async (req, reply) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(PieceBody, req.body);
    const pieceId = await addPiece(tenant.org_id, tenant.sub, id, body);
    return reply.code(201).send(ok(req, { id: pieceId }));
  });

  app.post('/v1/editorial/pieces/:id', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(PieceUpdateBody, req.body ?? {});
    await updatePiece(tenant.org_id, tenant.sub, id, body);
    return ok(req, { id });
  });

  app.post('/v1/editorial/pieces/:id/remove', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    return ok(req, { id, ...(await removePiece(tenant.org_id, tenant.sub, id, req.log)) });
  });

  app.post('/v1/editorial/pieces/:id/items', { preHandler: [requireAuth, requireRole(...EDITORS), idempotencyCheck] }, async (req, reply) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(TagBody, req.body);
    const out = await tagPieceItem(tenant.org_id, tenant.sub, id, body, req.log);
    return reply.code(201).send(ok(req, out));
  });

  app.post('/v1/editorial/look-items/:id/review', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const { decision } = parseOr400(ReviewBody, req.body);
    return ok(req, await reviewLookItem(tenant.org_id, tenant.sub, id, decision, req.log));
  });

  app.post('/v1/editorial/look-items/:id/remove', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    return ok(req, { id, ...(await removeLookItem(tenant.org_id, tenant.sub, id, req.log)) });
  });

  app.post('/v1/editorial/assets/:id', { preHandler: [requireAuth, requireRole(...READERS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(AssetBody, req.body ?? {});
    const out = await updateAsset(tenant.org_id, { id: tenant.sub, role: tenant.role }, id, body, req.log);
    return ok(req, { id, widened: out.widened });
  });

  app.post('/v1/editorial/instant-links', { preHandler: [requireAuth, requireRole(...EDITORS), idempotencyCheck] }, async (req, reply) => {
    const tenant = authed(req);
    const body = parseOr400(InstantBody, req.body);
    return reply.code(201).send(ok(req, await instantLinks(tenant.org_id, tenant.sub, body, req.log)));
  });

  app.get('/v1/editorial/properties', { preHandler: [requireAuth, requireRole(...READERS)] }, async (req) => {
    const tenant = authed(req);
    const rows = (
      await tenantQuery<{ id: string; platform: string; account: string; canonical_url: string | null; status: string; storefront_id: string | null; storefront_slug: string | null; storefront_status: string | null }>(
        tenant.org_id,
        `select p.id, p.platform, p.external_account_id as account, p.canonical_url, p.status,
                s.id as storefront_id, s.slug as storefront_slug, s.status as storefront_status
           from properties p left join storefronts s on s.property_id = p.id and s.org_id = $1
          where p.org_id = $1 and p.platform in ('facebook', 'instagram', 'web')
          order by p.platform, p.external_account_id`,
      )
    ).rows;
    const owner = new Set(
      (
        await tenantQuery<{ property_id: string }>(
          tenant.org_id,
          `select property_id from verifications where org_id = $1 and method = 'owner_operated'
              and verified_at is not null and (expires_at is null or expires_at > now())`,
        )
      ).rows.map((r) => r.property_id),
    );
    const tags = new Map<string, string>();
    for (const r of (
      await tenantQuery<{ property_id: string; tracking_id: string }>(
        tenant.org_id,
        `select pl.property_id, t.tracking_id from amazon_tracking_ids t join placements pl on pl.id = t.placement_id and pl.org_id = $1
          where t.org_id = $1 order by t.created_at, t.id`,
      )
    ).rows) {
      if (!tags.has(r.property_id)) tags.set(r.property_id, r.tracking_id);
    }
    return ok(req, {
      items: rows.map((r) => ({
        id: r.id,
        platform: r.platform,
        account: r.account,
        url: r.canonical_url,
        status: r.status,
        owner_operated: owner.has(r.id),
        amazon_tracking_id: tags.get(r.id) ?? null,
        storefront: r.storefront_id ? { id: r.storefront_id, slug: r.storefront_slug, status: r.storefront_status } : null,
      })),
    });
  });

  app.post('/v1/editorial/library/import', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req, reply) => {
    const tenant = authed(req);
    const body = parseOr400(LibraryBody, req.body);
    if (body.dry_run) return ok(req, { dry_run: true, ...(await checkLibrary({ orgId: tenant.org_id, text: body.csv_text })) });
    // The tenant's own organisation row, by the token's org id (the import names the organisation by its slug).
    const org = (await getPool().query<{ slug: string }>(`select slug from organisations where id = $1`, [tenant.org_id])).rows[0];
    if (!org) throw new AppError('NOT_FOUND', 'Organisation not found', 404);
    try {
      const summary = await importLibrary({ orgSlug: org.slug, text: body.csv_text, actorId: tenant.sub });
      return ok(req, { dry_run: false, ok: true, summary });
    } catch (err) {
      if (err instanceof LibraryImportRefusal) {
        return reply.code(422).send({ ...apiError('VALIDATION_ERROR', 'the library file was refused; nothing was written', req.requestId), problems: err.problems });
      }
      throw err;
    }
  });

  app.get('/v1/editorial/storefronts', { preHandler: [requireAuth, requireRole(...READERS)] }, async (req) => {
    const tenant = authed(req);
    const rows = (
      await tenantQuery<{ id: string; property_id: string; slug: string; display_name: string; bio: string | null; status: string; platform: string; account: string }>(
        tenant.org_id,
        `select s.id, s.property_id, s.slug, s.display_name, s.bio, s.status, p.platform, p.external_account_id as account
           from storefronts s join properties p on p.id = s.property_id and p.org_id = $1
          where s.org_id = $1 order by s.slug`,
      )
    ).rows;
    return ok(req, { items: rows });
  });

  app.post('/v1/editorial/storefronts', { preHandler: [requireAuth, requireRole(...EDITORS), idempotencyCheck] }, async (req, reply) => {
    const tenant = authed(req);
    const body = parseOr400(StorefrontBody, req.body);
    const id = await upsertStorefront(tenant.org_id, tenant.sub, body, req.log);
    return reply.code(201).send(ok(req, { id }));
  });

  app.post('/v1/editorial/storefronts/:id', { preHandler: [requireAuth, requireRole(...EDITORS)] }, async (req) => {
    const tenant = authed(req);
    const { id } = parseOr400(IdParams, req.params);
    const body = parseOr400(StorefrontBody.omit({ property_id: true }), req.body ?? {});
    await upsertStorefront(tenant.org_id, tenant.sub, { ...body, id }, req.log);
    return ok(req, { id });
  });
}
