/**
 * Link minting — the ONE path every tracked link is created by: POST
 * /v1/links (routes/links.ts), a look's own links when it is published or an
 * item is tagged (src/looks/look-links.ts), and instant links
 * (src/looks/instant-links.ts). The guards, their error codes and the route
 * payload are exactly those documented on POST /v1/links.
 *
 * checkMintGuards   every refusal as an AppError (reads through the pool);
 * insertLink        the links row + the `link.created` outbox row through the
 *                   given db (the pool, or a transaction's client that holds
 *                   the look's row lock);
 * warmRouteCache    the redirect's `route:{token}` entry (best-effort).
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { AppError, amazonRouteParams, buildEnvelope, isAmazonAcceptedPlatform, isCanonicalAmazonOfferUrl } from '@paparazzi/shared';
import { getPool, tenantQuery } from '../db.js';
import { redis } from '../redis.js';
import { redirectLinkUrl } from '../redirect-url.js';
import { amazonAccountForProgramme, placementTrackingId, propertyIsOwnerOperated } from '../amazon/account.js';

export interface MintBody {
  property_id: string;
  programme_id: string;
  offer_id: string;
  placement_id: string;
  /** The tagged item the link belongs to (look pages, instant links into a piece); null for a plain link. */
  look_item_id?: string | null;
}

export interface MintPrepared {
  offerUrl: string;
  allowedHosts: string[];
  amazonRoute: ReturnType<typeof amazonRouteParams> | null;
  contractVersionId: string | null;
}

/** Anything with pg's query signature (a Pool or a PoolClient). */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

function hmacSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  return secret;
}

/**
 * The guards of POST /v1/links (all tenant-scoped; the codes are the route's):
 * property approved in the org (PROPERTY_FORBIDDEN), publisher onboarding
 * active (PUBLISHER_NOT_ACTIVE), programme active (PROGRAMME_NOT_APPROVED),
 * offer active and fresh (OFFER_STALE), placement in the org (NOT_FOUND), the
 * four ids one graph, the destination on the programme's allow-list, and for
 * Amazon: account active, the programme's own campaign, an accepted platform,
 * owner-operated, the canonical /dp/<ASIN> destination.
 */
export async function checkMintGuards(orgId: string, body: MintBody): Promise<MintPrepared> {
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
  if (placementRow.property_id !== body.property_id || placementRow.campaign_publisher_id !== property.rows[0].publisher_id) {
    throw new AppError('PROPERTY_FORBIDDEN', "Placement does not belong to this property and its publisher's campaign", 403);
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
    throw new AppError('PROGRAMME_NOT_APPROVED', 'Offer destination is not a commissionable merchant URL for this programme', 403);
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
      throw new AppError('PROGRAMME_NOT_APPROVED', `Offer destination must be https://${amazon.marketplace_host}/dp/<ASIN> with no query string`, 403);
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

  return { offerUrl: offerRow.offer_url, allowedHosts, amazonRoute, contractVersionId: contract.rows[0]?.id ?? null };
}

/**
 * The links row and its `link.created` outbox event, through `db` ($1 of
 * both statements is the org_id, as tenantQuery would bind it).
 */
export async function insertLink(db: Queryable, orgId: string, body: MintBody, prepared: MintPrepared): Promise<{ token: string; linkId: string }> {
  const token = randomUUID().replace(/-/g, '');
  const routeSignature = createHmac('sha256', hmacSecret()).update(token).digest('hex');
  const linkId = randomUUID();
  await db.query(
    `insert into links
       (id, org_id, token, placement_id, offer_id, contract_version_id, route_signature, status, look_item_id)
     values ($2, $1, $3, $4, $5, $6, $7, 'active', $8)`,
    [orgId, linkId, token, body.placement_id, body.offer_id, prepared.contractVersionId, routeSignature, body.look_item_id ?? null],
  );
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
      contract_version_id: prepared.contractVersionId,
      ...(body.look_item_id ? { look_item_id: body.look_item_id } : {}),
    },
  });
  await db.query(
    `insert into outbox (id, org_id, event_type, payload, payload_hash, occurred_at)
     values ($2, $1, $3, $4::jsonb, $5, now())`,
    [orgId, randomUUID(), envelope.event_type, JSON.stringify(envelope), envelope.payload_hash],
  );
  return { token, linkId };
}

/**
 * Warm the redirect cache. Best-effort: failure only logs. An Amazon route
 * carries its tag and never a click-id param (amazonRouteParams); the
 * eligibility checked by the guards is the route_block the redirect reads.
 */
export async function warmRouteCache(
  orgId: string,
  token: string,
  linkId: string,
  prepared: MintPrepared,
  log?: { warn: (obj: unknown, msg?: string) => void },
): Promise<void> {
  const r = prepared.amazonRoute;
  const routePayload = {
    destination_url: prepared.offerUrl,
    allowed_hosts: prepared.allowedHosts,
    programme_status: 'active',
    offer_status: 'active',
    subid_field: 'subid' as string | null,
    org_id: orgId,
    link_id: linkId,
    ...(r
      ? {
          subid_field: r.subid_field,
          strip_params: r.strip_params,
          set_params: r.set_params,
          crawler_guard: r.crawler_guard,
          route_block: null,
        }
      : {}),
  };
  try {
    const client = redis();
    if (client) await client.set(`route:${token}`, JSON.stringify(routePayload), 'EX', 600);
  } catch (err) {
    log?.warn({ err, token }, 'route cache warm failed; DB remains source of truth');
  }
}

/** POST /v1/links: guards, insert, cache warm. */
export async function mintLink(
  orgId: string,
  body: MintBody,
  opts: { log?: { warn: (obj: unknown, msg?: string) => void } } = {},
): Promise<{ token: string; url: string; linkId: string }> {
  const prepared = await checkMintGuards(orgId, body);
  const { token, linkId } = await insertLink(getPool(), orgId, body, prepared);
  await warmRouteCache(orgId, token, linkId, prepared, opts.log);
  return { token, url: redirectLinkUrl(token), linkId };
}
