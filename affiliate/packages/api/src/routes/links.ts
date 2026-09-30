import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed, requireAuth, requireRole } from '../middleware.js';
import { idempotencyCheck } from '../idempotency.js';
import { ok, parseOr400 } from './_helpers.js';
import { mintLink } from '../links/mint.js';

const CreateLinkBody = z.object({
  property_id: z.string().uuid(),
  programme_id: z.string().uuid(),
  offer_id: z.string().uuid(),
  placement_id: z.string().uuid(),
});

/**
 * POST /v1/links — mint a tracked redirect link for a placement+offer.
 *
 * Guards (all tenant-scoped; src/links/mint.ts checkMintGuards, the one path
 * every link is minted by):
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
      preHandler: [requireAuth, requireRole('publisher_owner', 'editor', 'network_admin'), idempotencyCheck],
    },
    async (req, reply) => {
      const tenant = authed(req);
      const body = parseOr400(CreateLinkBody, req.body);
      const minted = await mintLink(tenant.org_id, body, { log: req.log });
      // URL composition is shared with GET /v1/looks/:id (src/redirect-url.ts)
      // so the consumer shop reads back exactly the URL minted here.
      return reply.code(201).send(ok(req, { token: minted.token, url: minted.url }));
    },
  );
}
