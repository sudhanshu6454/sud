import type { FastifyInstance } from 'fastify';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, amazonRouteParams, buildEnvelope, isAmazonAcceptedPlatform, isCanonicalAmazonOfferUrl } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { redis } from '../redis.js';
import { ok, parseOr400 } from './_helpers.js';
import { redirectLinkUrl } from '../redirect-url.js';
import { amazonAccountForProgramme, placementTrackingId, propertyIsOwnerOperated } from '../amazon/account.js';

const CreateLinkBody = z.object({
  property_id: z.string().uuid(),
  programme_id: z.string().uuid(),
  offer_id: z.string().uuid(),
  placement_id: z.string().uuid(),
});

function hmacSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return secret;
}

/**
 * POST /v1/links — mint a tracked redirect link for a placement+offer.
 *
 * Guards (all tenant-scoped):
 * - property must belong to the org and be 'approved'      → 403 PROPERTY_FORBIDDEN
 * - programme must be 'active'                             → 403 PROGRAMME_NOT_APPROVED
 * - offer must be 'active' and fresh (fresh_until > now)   → 422 OFFER_STALE
 * - placement must belong to the org                       → 404 NOT_FOUND
 * - the offer must belong to the named programme           → 403 PROGRAMME_NOT_APPROVED
 * - the placement must be the named property's, in a campaign of that
 *   property's own publisher                               → 403 PROPERTY_FORBIDDEN
 *
 * Amazon.in Associates programmes (an amazon_associates_accounts row) add:
 * - the account must be 'active'                           → 403 PROGRAMME_NOT_APPROVED
 * - the placement must be in a campaign FOR this programme
 *   (the setup CLI creates one placement per property the
 *   operator declared to Amazon)                           → 403 PROPERTY_FORBIDDEN
 * - the property's platform must be one Amazon accepts and
 *   this build declares (Facebook, Instagram, the owner's
 *   website; never Snapchat or Telegram)                   → 403 PROPERTY_FORBIDDEN
 * - the placement's property needs a live owner_operated
 *   verification (PR 9: the tag only on "your site"; there
 *   is no setting that allows third parties)               → 403 PROPERTY_NOT_OWNER_OPERATED
 * - the stored offer URL must be exactly
 *   https://<marketplace host>/dp/<ASIN> (no tag, no query) → 403 PROGRAMME_NOT_APPROVED
 * The route payload then carries the placement's tag (its tracking ID, else
 * the store ID) and never a click-id param (`amazonRouteParams`, shared with
 * the redirect's DB fallback; LR: no sub-tag tied to a specific end user).
 *
 * The link token is HMAC-SHA256(JWT_SECRET, token) signed. NOTE: dev-grade
 * signing — reuses the JWT secret; TODO: move to KMS-managed signing key.
 *
 * Side effects: warms Redis `route:{token}` (best-effort; DB is source of
 * truth) and appends a `link.created` outbox event.
 */
export async function linksRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/v1/links',
    {
      preHandler: [
        requireAuth,
        requireRole('publisher_owner', 'editor', 'network_admin'),
        idempotencyCheck,
      ],
    },
    async (req, reply) => {
      const tenant = authed(req);
      const body = parseOr400(CreateLinkBody, req.body);
      const orgId = tenant.org_id;

      const property = await tenantQuery<{ status: string; publisher_id: string; platform: string }>(
        orgId,
        `select status, publisher_id, platform from properties where org_id = $1 and id = $2`,
        [body.property_id],
      );
      if (!property.rows[0] || property.rows[0].status !== 'approved') {
        throw new AppError('PROPERTY_FORBIDDEN', 'Property is not approved for this organisation', 403);
      }

      // Publisher onboarding gate: pending accounts can draft (looks,
      // placements) but cannot mint monetised links until onboarding reaches
      // 'active'. See 0003_phase3.sql.
      const publisher = await tenantQuery<{ onboarding_state: string }>(
        orgId,
        `select onboarding_state from publishers where org_id = $1 and id = $2`,
        [property.rows[0].publisher_id],
      );
      if (!publisher.rows[0] || publisher.rows[0].onboarding_state !== 'active') {
        throw new AppError(
          'PUBLISHER_NOT_ACTIVE',
          'Publisher onboarding is not complete; monetised link creation is disabled until the account is active',
          403,
        );
      }

      const programme = await tenantQuery<{ status: string }>(
        orgId,
        `select status from programmes where org_id = $1 and id = $2`,
        [body.programme_id],
      );
      if (!programme.rows[0] || programme.rows[0].status !== 'active') {
        throw new AppError('PROGRAMME_NOT_APPROVED', 'Programme is not active', 403);
      }

      const offer = await tenantQuery<{ offer_url: string; programme_id: string }>(
        orgId,
        `select offer_url, programme_id from offers
          where org_id = $1 and id = $2 and status = 'active' and fresh_until > now()`,
        [body.offer_id],
      );
      const offerRow = offer.rows[0];
      if (!offerRow) {
        throw new AppError('OFFER_STALE', 'Offer is not active or is stale', 422);
      }

      const placement = await tenantQuery<{
        id: string;
        property_id: string;
        campaign_programme_id: string;
        campaign_publisher_id: string;
      }>(
        orgId,
        `select pl.id, pl.property_id,
                ca.programme_id as campaign_programme_id, ca.publisher_id as campaign_publisher_id
           from placements pl
           join campaigns ca on ca.id = pl.campaign_id and ca.org_id = $1
          where pl.org_id = $1 and pl.id = $2`,
        [body.placement_id],
      );
      const placementRow = placement.rows[0];
      if (!placementRow) {
        throw new AppError('NOT_FOUND', 'Placement not found for this organisation', 404);
      }

      // The four ids must describe one graph: the redirect and the ledger
      // follow the OFFER's programme and the PLACEMENT's campaign, so a
      // mismatch would mint under one set of rules and pay under another.
      if (offerRow.programme_id !== body.programme_id) {
        throw new AppError('PROGRAMME_NOT_APPROVED', 'Offer does not belong to this programme', 403);
      }
      if (
        placementRow.property_id !== body.property_id ||
        placementRow.campaign_publisher_id !== property.rows[0].publisher_id
      ) {
        throw new AppError(
          'PROPERTY_FORBIDDEN',
          "Placement does not belong to this property and its publisher's campaign",
          403,
        );
      }

      // programme_capabilities has no org_id column of its own; scope it via
      // the parent programme row (see ASSUMPTIONS.md).
      const caps = await tenantQuery<{ allowed_domains: string[] }>(
        orgId,
        `select pc.allowed_domains as allowed_domains
           from programme_capabilities pc
           join programmes p on p.id = pc.programme_id
          where pc.programme_id = $2 and p.org_id = $1
          limit 1`,
        [body.programme_id],
      );
      const allowedHosts = caps.rows[0]?.allowed_domains ?? [];

      // Unsupported merchant URL guard: the offer's destination must resolve
      // to a host the programme has allow-listed. Without this, a bad or
      // mis-configured offer URL would mint a link that can never earn —
      // the redirect service would 403 it at click time. Fail at mint time
      // instead, with no commissionable link created.
      let offerHost: string | null = null;
      try {
        offerHost = new URL(offerRow.offer_url).hostname;
      } catch {
        offerHost = null;
      }
      if (!offerHost || !allowedHosts.includes(offerHost)) {
        throw new AppError(
          'PROGRAMME_NOT_APPROVED',
          'Offer destination is not a commissionable merchant URL for this programme',
          403,
        );
      }

      // Amazon.in Associates: the programme's own campaign, an accepted
      // platform, owner-operated properties only, the canonical /dp/<ASIN>
      // destination, and the placement's tag.
      let amazonRoute: ReturnType<typeof amazonRouteParams> | null = null;
      const amazon = await amazonAccountForProgramme(orgId, body.programme_id);
      if (amazon) {
        if (amazon.status !== 'active') {
          throw new AppError('PROGRAMME_NOT_APPROVED', 'The Amazon Associates account of this programme is disabled', 403);
        }
        if (placementRow.campaign_programme_id !== body.programme_id) {
          throw new AppError(
            'PROPERTY_FORBIDDEN',
            'Placement is not in a campaign of this programme: only properties declared for this Amazon account can carry its links',
            403,
          );
        }
        if (!isAmazonAcceptedPlatform(property.rows[0].platform)) {
          throw new AppError(
            'PROPERTY_FORBIDDEN',
            `Amazon links go on Facebook, Instagram and the operator's own website only; '${property.rows[0].platform}' is not a network Amazon accepts or this build declares`,
            403,
          );
        }
        if (!(await propertyIsOwnerOperated(orgId, placementRow.property_id))) {
          throw new AppError(
            'PROPERTY_NOT_OWNER_OPERATED',
            "Amazon Associates links may only be placed on the operator's own properties (an owner_operated verification is required)",
            403,
          );
        }
        if (!isCanonicalAmazonOfferUrl(offerRow.offer_url, amazon.marketplace_host)) {
          throw new AppError(
            'PROGRAMME_NOT_APPROVED',
            `Offer destination must be https://${amazon.marketplace_host}/dp/<ASIN> with no query string`,
            403,
          );
        }
        amazonRoute = amazonRouteParams({
          storeId: amazon.store_id,
          placementTrackingId: await placementTrackingId(orgId, amazon.id, placementRow.id),
        });
      }

      // Pin the latest approved contract version onto the link when one exists
      // (may be null when contracting is still in flight). Only contracts
      // whose effective_from has arrived are considered.
      const contract = await tenantQuery<{ id: string }>(
        orgId,
        `select c.id
           from contracts c
           join placements pl on pl.id = $2 and pl.org_id = $1
           join campaigns ca on ca.id = pl.campaign_id and ca.org_id = $1
          where c.org_id = $1 and c.publisher_id = ca.publisher_id
            and c.programme_id = $3 and c.status = 'approved'
            and (c.effective_from is null or c.effective_from <= now())
          order by c.version desc
          limit 1`,
        [body.placement_id, body.programme_id],
      );
      const contractVersionId: string | null = contract.rows[0]?.id ?? null;

      const token = randomUUID().replace(/-/g, '');
      const routeSignature = createHmac('sha256', hmacSecret()).update(token).digest('hex');
      const linkId = randomUUID();

      await tenantQuery(
        orgId,
        `insert into links
           (id, org_id, token, placement_id, offer_id, contract_version_id, route_signature, status)
         values ($2, $1, $3, $4, $5, $6, $7, 'active')`,
        [linkId, token, body.placement_id, body.offer_id, contractVersionId, routeSignature],
      );

      // Warm the redirect cache. Best-effort: failure only logs. An Amazon
      // route carries its tag and never a click-id param (amazonRouteParams);
      // the eligibility checked above is the route_block the redirect reads.
      const routePayload = {
        destination_url: offerRow.offer_url,
        allowed_hosts: allowedHosts,
        programme_status: 'active',
        offer_status: 'active',
        subid_field: 'subid' as string | null,
        org_id: orgId,
        link_id: linkId,
        ...(amazonRoute
          ? {
              subid_field: amazonRoute.subid_field,
              strip_params: amazonRoute.strip_params,
              set_params: amazonRoute.set_params,
              crawler_guard: amazonRoute.crawler_guard,
              route_block: null,
            }
          : {}),
      };
      try {
        const r = redis();
        if (r) await r.set(`route:${token}`, JSON.stringify(routePayload), 'EX', 600);
      } catch (err) {
        req.log.warn({ err, token }, 'route cache warm failed; DB remains source of truth');
      }

      const envelope = buildEnvelope({
        source: 'api',
        event_type: 'link.created',
        payload: {
          token,
          link_id: linkId,
          org_id: orgId,
          placement_id: body.placement_id,
          offer_id: body.offer_id,
          programme_id: body.programme_id,
          contract_version_id: contractVersionId,
        },
      });
      await tenantQuery(
        orgId,
        `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
         values ($2, $1, $3, $4::jsonb, $5, now())`,
        [randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
      );

      // URL composition is shared with GET /v1/looks/:id (src/redirect-url.ts)
      // so the consumer shop reads back exactly the URL minted here.
      return reply.code(201).send(ok(req, { token, url: redirectLinkUrl(token) }));
    },
  );
}
