/**
 * Instant links: an amazon.in product URL or ASIN (and the operator's own
 * words for it) → the Amazon offer (src/amazon/offers.ts addAmazonOffers:
 * the canonical /dp/<ASIN>, no price until the product API gives one) →
 * straight into an outfit piece as SIMILAR (the default) or EXACT (evidence
 * required; pending until a second person approves it) → tracked links for
 * the chosen in-house pages. A piece is required: a link printed in a post
 * about a celebrity look is scoped to its tagged item, so that look's (or
 * that person's) takedown pauses it with the rest (general product links
 * for other posts are the Amazon CLI's, deploy/linode/amazon.sh links).
 *
 * Checked before anything is written: the product text (the operator's
 * words) never names a celebrity or uses an endorsement phrase, and for
 * SIMILAR never the piece's own celebrity (src/looks/editorial.ts
 * productRefusals) — so a refused call changes no product text. Tagging the
 * same product into the same piece again reuses its item (a second call
 * after an EXACT tag was approved mints its page links). No link is minted
 * for an EXACT tag before its second person approved it (links_withheld).
 *
 * Every link goes through the mint guards (src/links/mint.ts): only
 * approved, owner-operated Facebook / Instagram / web properties declared to
 * the Amazon account (their placement in its campaign), for Amazon only a
 * placement with its own tracking ID. Links for a piece are scoped to the
 * tagged item (a takedown pauses them with the look) and are minted only
 * while the celebrity's rights allow a shoppable page; otherwise the item
 * is tagged and the links are withheld (the answer says why).
 *
 * The answer's `look_url` (the look's afflino.com page) is the ONLY URL a
 * direct message or a comment reply may carry: tracked /r/ links go on the
 * declared pages' posts only (Amazon: "Special Links … are not permitted to
 * be used in emails, offline promotions or in any offline manner").
 */
import {
  AMAZON_IN_MARKETPLACE_HOST,
  AMAZON_POST_LABEL,
  AppError,
  asinFromAmazonUrl,
  endorsementFindings,
  isAmazonAcceptedPlatform,
  normaliseAsin,
} from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { addAmazonOffers } from '../amazon/offers.js';
import { SetupRefusal } from '../amazon/setup.js';
import { propertyIsOwnerOperated } from '../amazon/account.js';
import { bundleDisplay, loadLookBundle } from './bundle.js';
import { tagPieceItem, evidenceProblems, productRefusals, type TagResult } from './editorial.js';
import { mintItemLink, propertyPlacement } from './look-links.js';

type Log = { warn: (obj: unknown, msg?: string) => void };

export interface InstantLinksInput {
  asin_or_url: string;
  brand: string;
  model: string;
  category: string;
  size?: string | null;
  colour?: string | null;
  property_ids: string[];
  piece_id?: string | null;
  match_type?: 'exact' | 'similar';
  evidence?: string | null;
  evidence_source?: string | null;
  evidence_captured_at?: string | null;
  ttl_days?: number;
}

export interface InstantLinkRow {
  property_id: string;
  platform: string | null;
  account: string | null;
  tracking_id: string | null;
  link_url: string | null;
  post_label: string;
  minted: boolean;
  refused: { code: string; message: string } | null;
}

export function siteOrigin(): string {
  return (process.env.SITE_URL ?? 'https://afflino.com').replace(/\/$/, '');
}

export function lookPageUrl(lookId: string): string {
  return `${siteOrigin()}/looks/${lookId}`;
}

export async function instantLinks(orgId: string, actorId: string, input: InstantLinksInput, log?: Log) {
  const problems: string[] = [];
  let asin = normaliseAsin(input.asin_or_url.trim());
  if (!asin) {
    const parsed = asinFromAmazonUrl(input.asin_or_url.trim(), AMAZON_IN_MARKETPLACE_HOST);
    if (parsed.ok) asin = parsed.asin;
    else problems.push(parsed.reason);
  }
  for (const [name, v] of [
    ['brand', input.brand],
    ['model', input.model],
    ['category', input.category],
  ] as const) {
    if (!v || v.trim() === '') problems.push(`${name} is empty (the operator's own words; nothing is copied from Amazon)`);
    else if (v.length > 200) problems.push(`${name} is longer than 200 characters`);
    const words = endorsementFindings(v);
    if (words.length) problems.push(`${name}: ${words.join(', ')} (product text never says or implies a celebrity wore, owns or recommends it)`);
  }
  if (input.property_ids.length > 50) problems.push('at most 50 properties per call');
  const match = input.match_type ?? 'similar';
  if (input.piece_id) problems.push(...evidenceProblems(match, input.evidence, input.evidence_source));
  else problems.push('an instant link goes into an outfit piece (piece_id): a link printed in a look\'s post pauses with that look\'s takedown');
  if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('; '), 422);

  // The piece (and its look) before anything is written.
  const p = (await tenantQuery<{ look_id: string; removed_at: unknown }>(orgId, `select look_id, removed_at from look_pieces where org_id = $1 and id = $2`, [input.piece_id])).rows[0];
  if (!p || p.removed_at) throw new AppError('NOT_FOUND', 'Piece not found', 404);
  const lookId: string = p.look_id;
  const pieceId = input.piece_id as string;
  // The product text before anything is written (a refused call changes no product's text).
  const textRefused = await productRefusals(orgId, lookId, match, { brand: input.brand.trim(), model: input.model.trim(), category: input.category.trim() });
  if (textRefused.length) {
    throw new AppError('VALIDATION_ERROR', `the product text never names a celebrity or implies they wore, own or recommend it: ${textRefused.join(', ')}`, 422);
  }

  let added;
  try {
    added = await addAmazonOffers({
      orgSlug: '',
      orgId,
      offers: [
        {
          row: 1,
          asin: asin as string,
          brand: input.brand.trim(),
          model: input.model.trim(),
          category: input.category.trim(),
          size: input.size?.trim() || null,
          colour: input.colour?.trim() || null,
        },
      ],
      ttlDays: input.ttl_days,
    });
  } catch (err) {
    if (err instanceof SetupRefusal) throw new AppError('VALIDATION_ERROR', err.problems.join('; '), 422);
    throw err;
  }
  const offer = added.offers[0] as (typeof added.offers)[number];

  // The same product already in the piece: its item is reused (a second call mints the links of an EXACT tag approved since).
  const existingItem = (
    await tenantQuery<{ id: string; match_type: 'exact' | 'similar'; review_state: 'pending' | 'approved' }>(
      orgId,
      `select id, match_type, review_state from look_items where org_id = $1 and piece_id = $2 and variant_id = $3 and removed_at is null`,
      [pieceId, offer.variant_id],
    )
  ).rows[0];
  let tagged: TagResult;
  if (existingItem) {
    if (input.match_type && input.match_type !== existingItem.match_type) {
      throw new AppError('CONFLICT', `this product is already tagged into the piece as ${existingItem.match_type.toUpperCase()}`, 409);
    }
    tagged = { item_id: existingItem.id, match_type: existingItem.match_type, review_state: existingItem.review_state, links: null };
  } else {
    tagged = await tagPieceItem(
      orgId,
      actorId,
      pieceId,
      {
        offer_id: offer.offer_id,
        match_type: match,
        evidence: input.evidence ?? null,
        evidence_source: input.evidence_source ?? null,
        evidence_captured_at: input.evidence_captured_at ?? null,
      },
      log,
    );
  }

  // Links for the chosen pages: withheld when the look is withdrawn, when the celebrity may not have a
  // shoppable page, or while an EXACT tag waits for its second person.
  let withheld: string | null = null;
  const b = await loadLookBundle(orgId, lookId);
  if (!b || b.look.takedown_id || b.look.status === 'withdrawn') withheld = 'the look was withdrawn (takedown)';
  else if (!bundleDisplay(b).shoppable) withheld = "the celebrity's rights status does not allow a shoppable page (a rights review first)";
  else if (tagged.review_state !== 'approved') withheld = "the EXACT tag waits for a second person's approval: its links are minted after it (run the same instant link again then)";
  const links: InstantLinkRow[] = [];
  if (!withheld) {
    for (const propertyId of [...new Set(input.property_ids)]) {
      const prop = (
        await tenantQuery<{ platform: string; external_account_id: string; status: string }>(
          orgId,
          `select platform, external_account_id, status from properties where org_id = $1 and id = $2`,
          [propertyId],
        )
      ).rows[0];
      const row: InstantLinkRow = {
        property_id: propertyId,
        platform: prop?.platform ?? null,
        account: prop?.external_account_id ?? null,
        tracking_id: null,
        link_url: null,
        post_label: AMAZON_POST_LABEL,
        minted: false,
        refused: null,
      };
      links.push(row);
      if (!prop) {
        row.refused = { code: 'NOT_FOUND', message: 'Property not found' };
        continue;
      }
      if (!isAmazonAcceptedPlatform(prop.platform) || !(await propertyIsOwnerOperated(orgId, propertyId))) {
        row.refused = { code: 'PROPERTY_NOT_OWNER_OPERATED', message: "Amazon links go on the owner's own Facebook, Instagram and web properties only" };
        continue;
      }
      const placement = await propertyPlacement(orgId, propertyId, added.programme_id);
      if (!placement) {
        row.refused = { code: 'PROPERTY_FORBIDDEN', message: 'the page is not declared to the Amazon account (no placement in its campaign)' };
        continue;
      }
      if (!placement.tracking_id) {
        row.refused = { code: 'PROPERTY_FORBIDDEN', message: 'the page carries the store ID: give it its own tracking ID first (its sales could not be attributed)' };
        continue;
      }
      row.tracking_id = placement.tracking_id;
      const body = { property_id: propertyId, programme_id: added.programme_id, offer_id: offer.offer_id, placement_id: placement.id };
      try {
        const r = await mintItemLink(orgId, lookId, { ...body, look_item_id: tagged.item_id }, { requirePublished: false });
        row.link_url = r.url;
        row.minted = r.minted;
      } catch (err) {
        row.refused = err instanceof AppError ? { code: err.code, message: err.message } : { code: 'INTERNAL', message: 'unexpected error' };
      }
    }
  }

  return {
    asin,
    offer: { id: offer.offer_id, variant_id: offer.variant_id, product_id: offer.product_id, created: offer.created, status: offer.status, fresh_until: offer.fresh_until },
    item: tagged,
    links,
    links_withheld: withheld,
    look_url: lookPageUrl(lookId),
    message_rule: 'A direct message or a comment reply carries only look_url (an afflino.com page); the tracked links go on the declared pages’ posts only.',
  };
}
