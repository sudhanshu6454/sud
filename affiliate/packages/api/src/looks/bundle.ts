/**
 * One celebrity look with everything a page or a check needs: the look, its
 * celebrity, the still, the in-house page (and its storefront), the pieces,
 * the tagged items (product, variant, the live offer) and the look's own
 * active links. Loaded with plain tenant-scoped queries (pg-mem-safe: no
 * LATERAL, no correlated EXISTS).
 *
 * publicLook      what the public look page may show — never more than the
 *                 celebrity's rights allow at this moment (@paparazzi/shared
 *                 effectiveLookDisplay): the name only when allowed, the still
 *                 only when its licence and screen allow, products and links
 *                 only when a shoppable page is allowed, pending EXACT tags
 *                 never; no raw merchant URL (offer_url is never selected).
 * editorialLook   everything, for the editors (evidence, review state, gate).
 */
import { createHash } from 'node:crypto';
import {
  AMAZON_CONNECTOR,
  CELEBRITY_COPY,
  effectiveCelebrityRights,
  effectiveLookDisplay,
  itemWording,
  lookHeadline,
  productTextRefusals,
  type AssetLicenceRow,
  type EffectiveLookDisplay,
  type RightsCeiling,
} from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { namesIn, type CelebrityName } from './names.js';
import { LIVE_OFFER_SQL, type LiveOfferRow } from '../catalogue-offer.js';
import { displayablePrice, displayableStock } from '../offer-price.js';
import { redirectLinkUrl } from '../redirect-url.js';
import { propertyIsOwnerOperated } from '../amazon/account.js';
import { isoDate, toIso } from './sql.js';

export const LOOK_COLS = `l.id, l.title, l.locale, l.category, l.status, l.published_at, l.created_at, l.updated_at,
  l.source_page, l.sponsored, l.celebrity_id, l.event_name, l.place, l.place_kind, l.moment_date,
  l.still_asset_id, l.source_video_asset_id, l.property_id, l.post_permalink, l.platform_post_id,
  l.library_ref, l.celebrity_display, l.takedown_id, l.withdrawn_at, l.place_confirmed_by, l.place_confirmed_at`;

export interface LookRow {
  id: string;
  title: string;
  locale: string;
  category: string | null;
  status: string;
  published_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date | null;
  source_page: string | null;
  sponsored: boolean;
  celebrity_id: string | null;
  event_name: string | null;
  place: string | null;
  place_kind: string | null;
  moment_date: string | Date | null;
  still_asset_id: string | null;
  source_video_asset_id: string | null;
  property_id: string | null;
  post_permalink: string | null;
  platform_post_id: string | null;
  library_ref: string | null;
  celebrity_display: string;
  takedown_id: string | null;
  withdrawn_at: string | Date | null;
  place_confirmed_by: string | null;
  place_confirmed_at: string | Date | null;
}

export const CELEBRITY_COLS = `c.id, c.name, c.slug, c.aliases, c.is_minor, c.never_list, c.rights_status, c.max_display,
  c.shoppable, c.rights_note, c.rights_evidence_ref, c.rights_reviewed_by, c.rights_reviewed_at, c.takedown_id,
  c.created_at, c.updated_at`;

export interface CelebrityRow {
  id: string;
  name: string;
  slug: string;
  aliases: string[] | null;
  is_minor: boolean;
  never_list: boolean;
  rights_status: string;
  max_display: string;
  shoppable: boolean;
  rights_note: string | null;
  rights_evidence_ref: string | null;
  rights_reviewed_by: string | null;
  rights_reviewed_at: string | Date | null;
  takedown_id: string | null;
  created_at: string | Date;
  updated_at: string | Date | null;
}

export const ASSET_COLS = `a.id, a.kind, a.storage_key, a.public_url, a.license, a.commercial_reuse, a.territory, a.expires_at,
  a.screen_status, a.minor_in_frame, a.bystanders, a.sensitive_location, a.live_performance, a.source_ref,
  a.copyright_owner, a.author, a.acquisition, a.assignment_ref, a.screened_by, a.screened_at`;

export interface AssetRow extends AssetLicenceRow {
  id: string;
  storage_key: string;
  source_ref: string | null;
  copyright_owner: string | null;
  author: string | null;
  acquisition: string | null;
  assignment_ref: string | null;
  screened_by: string | null;
  screened_at: string | Date | null;
}

export interface PropertyRow {
  id: string;
  platform: string;
  external_account_id: string;
  canonical_url: string | null;
  status: string;
}

export interface StorefrontRow {
  id: string;
  slug: string;
  display_name: string;
  bio: string | null;
  status: string;
}

export interface PieceRow {
  id: string;
  label: string;
  garment_category: string;
  position: number;
  hotspot_x: string | number | null;
  hotspot_y: string | number | null;
  created_at: string | Date;
}

export interface ItemRow {
  id: string;
  piece_id: string;
  match_type: 'exact' | 'similar';
  review_state: 'pending' | 'approved';
  evidence: string | null;
  evidence_source: string | null;
  evidence_captured_at: string | Date | null;
  tagged_by: string | null;
  match_reviewed_by: string | null;
  match_reviewed_at: string | Date | null;
  position: number;
  created_at: string | Date;
  variant_id: string;
  size_text: string | null;
  colour: string | null;
  merchant_sku: string | null;
  product_id: string;
  brand: string;
  model: string;
  product_category: string;
}

export interface ItemLinkRow {
  id: string;
  token: string;
  look_item_id: string;
  placement_id: string;
  offer_id: string;
  property_id: string;
  platform: string;
}

export interface LookBundle {
  look: LookRow;
  celebrity: CelebrityRow | null;
  still: AssetRow | null;
  property: PropertyRow | null;
  propertyOwnerOperated: boolean;
  storefront: StorefrontRow | null;
  pieces: PieceRow[];
  items: ItemRow[];
  offers: Map<string, LiveOfferRow | null>;
  links: ItemLinkRow[];
}

export async function loadLookRow(orgId: string, lookId: string): Promise<LookRow | null> {
  const res = await tenantQuery<LookRow>(orgId, `select ${LOOK_COLS} from looks l where l.org_id = $1 and l.id = $2`, [lookId]);
  return res.rows[0] ?? null;
}

export async function loadCelebrity(orgId: string, id: string): Promise<CelebrityRow | null> {
  const res = await tenantQuery<CelebrityRow>(orgId, `select ${CELEBRITY_COLS} from celebrities c where c.org_id = $1 and c.id = $2`, [id]);
  return res.rows[0] ?? null;
}

export async function loadAsset(orgId: string, id: string | null): Promise<AssetRow | null> {
  if (!id) return null;
  const res = await tenantQuery<AssetRow>(orgId, `select ${ASSET_COLS} from assets a where a.org_id = $1 and a.id = $2`, [id]);
  return res.rows[0] ?? null;
}

export async function loadLookBundle(orgId: string, lookId: string): Promise<LookBundle | null> {
  const look = await loadLookRow(orgId, lookId);
  if (!look) return null;
  const celebrity = look.celebrity_id ? await loadCelebrity(orgId, look.celebrity_id) : null;
  const still = await loadAsset(orgId, look.still_asset_id);
  let property: PropertyRow | null = null;
  let storefront: StorefrontRow | null = null;
  let propertyOwnerOperated = false;
  if (look.property_id) {
    property =
      (
        await tenantQuery<PropertyRow>(
          orgId,
          `select id, platform, external_account_id, canonical_url, status from properties where org_id = $1 and id = $2`,
          [look.property_id],
        )
      ).rows[0] ?? null;
    propertyOwnerOperated = property ? await propertyIsOwnerOperated(orgId, property.id) : false;
    storefront =
      (
        await tenantQuery<StorefrontRow>(
          orgId,
          `select id, slug, display_name, bio, status from storefronts where org_id = $1 and property_id = $2`,
          [look.property_id],
        )
      ).rows[0] ?? null;
  }
  const pieces = (
    await tenantQuery<PieceRow>(
      orgId,
      `select id, label, garment_category, position, hotspot_x, hotspot_y, created_at
         from look_pieces
        where org_id = $1 and look_id = $2 and removed_at is null
        order by position, created_at, id`,
      [lookId],
    )
  ).rows;
  const items = (
    await tenantQuery<ItemRow>(
      orgId,
      `select li.id, li.piece_id, li.match_type, li.review_state, li.evidence, li.evidence_source,
              li.evidence_captured_at, li.tagged_by, li.match_reviewed_by, li.match_reviewed_at,
              li.position, li.created_at, li.variant_id,
              v.size_text, v.colour, v.merchant_sku,
              p.id as product_id, p.brand, p.model, p.category as product_category
         from look_items li
         join variants v on v.id = li.variant_id and v.org_id = $1
         join products p on p.id = v.product_id and p.org_id = $1
         join look_pieces lp on lp.id = li.piece_id and lp.org_id = $1
        where li.org_id = $1 and li.look_id = $2 and li.piece_id is not null
          and li.removed_at is null and lp.removed_at is null
        order by li.position, li.created_at, li.id`,
      [lookId],
    )
  ).rows;
  const offers = new Map<string, LiveOfferRow | null>();
  for (const it of items) {
    if (offers.has(it.variant_id)) continue;
    offers.set(it.variant_id, (await tenantQuery<LiveOfferRow>(orgId, LIVE_OFFER_SQL, [it.variant_id])).rows[0] ?? null);
  }
  const links =
    items.length === 0
      ? []
      : (
          await tenantQuery<ItemLinkRow>(
            orgId,
            `select l.id, l.token, l.look_item_id, l.placement_id, l.offer_id, pl.property_id, p.platform
               from links l
               join placements pl on pl.id = l.placement_id and pl.org_id = $1
               join properties p on p.id = pl.property_id and p.org_id = $1
              where l.org_id = $1 and l.status = 'active' and l.look_item_id = any($2)
              order by l.created_at, l.id`,
            [items.map((i) => i.id)],
          )
        ).rows;
  return { look, celebrity, still, property, propertyOwnerOperated, storefront, pieces, items, offers, links };
}

export function celebrityRights(c: CelebrityRow | null): RightsCeiling {
  if (!c) return { display: 'none', shoppable: false };
  return effectiveCelebrityRights(c);
}

export function bundleDisplay(b: LookBundle, now: number = Date.now()): EffectiveLookDisplay {
  if (b.look.takedown_id || !b.celebrity) return { name: false, image: false, shoppable: false };
  return effectiveLookDisplay(celebrityRights(b.celebrity), b.look.celebrity_display, b.still, now);
}

function num(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10_000) / 10_000 : null;
}

/** The public offer block (the catalogue's shape): a price only inside the programme's age limit. */
export function publicOffer(o: LiveOfferRow, now: number = Date.now()) {
  const price = displayablePrice(o, now);
  return {
    id: o.id,
    connector: o.connector,
    merchant: { name: o.merchant_name },
    price_minor: price.price_minor,
    price_as_of: price.price_as_of,
    currency: o.currency,
    stock_status: displayableStock(o, price),
    disclosure: o.disclosure_text ?? null,
  };
}

/**
 * The item's link on the look page: the active link for this item and its
 * live offer on afflino.com's own placement (src/looks/look-links.ts mints
 * it there, with afflino.com's tracking ID: a click on afflino.com is never
 * recorded against a Facebook or Instagram page's tag). The page links
 * printed in the in-house posts (instant links) are never shown here.
 */
export function itemLink(b: LookBundle, item: ItemRow, offerId: string): { url: string } | null {
  const own = b.links.find((l) => l.look_item_id === item.id && l.offer_id === offerId && l.platform === 'web');
  return own ? { url: redirectLinkUrl(own.token) } : null;
}

export type PublicLookOutcome = { kind: 'ok'; body: Record<string, unknown> } | { kind: 'gone' } | { kind: 'not_found' };

/** The look's own text (event, place, piece labels) — what the name checks read. */
export function lookOwnTexts(b: Pick<LookBundle, 'look' | 'pieces'>): Array<string | null> {
  return [b.look.event_name, b.look.place, ...b.pieces.map((p) => p.label)];
}

/**
 * Why the public may not see a look: 'gone' after a takedown of a look that
 * was public once (published_at is set), 'not_found' otherwise — a look that
 * was never public stays a 404 under a takedown too (a 410 would tell anyone
 * probing that the library holds that person and a notice arrived). With
 * `names` (every celebrity of the organisation), a look whose own text
 * names anyone is not public either (a name reaches a page only in the
 * credit line of that person's own look).
 */
export function publicVisibility(b: LookBundle, now: number = Date.now(), names?: readonly CelebrityName[]): 'ok' | 'gone' | 'not_found' {
  if (b.look.status === 'withdrawn' || b.look.takedown_id || b.celebrity?.takedown_id) return b.look.published_at ? 'gone' : 'not_found';
  if (b.look.status !== 'published' || !b.celebrity) return 'not_found';
  if (names && namesIn(lookOwnTexts(b), names).length > 0) return 'not_found';
  return bundleDisplay(b, now).name ? 'ok' : 'not_found';
}

/** The still's address on afflino.com (the web's /img/looks/<id>, which re-checks every rule on every request); the version changes with the file. */
export function stillPath(lookId: string, publicUrl: string | null): string {
  const v = createHash('sha256').update(publicUrl ?? '').digest('hex').slice(0, 10);
  return `/img/looks/${lookId}?v=${v}`;
}

/** True when a product's text may stand in this look's outfit now (no endorsement phrase, no celebrity named). */
export function productTextOk(i: Pick<ItemRow, 'brand' | 'model' | 'product_category'>, names: readonly CelebrityName[] | undefined): boolean {
  return productTextRefusals([i.brand, i.model, i.product_category], names ?? []).length === 0;
}

export function publicLook(b: LookBundle, now: number = Date.now(), names?: readonly CelebrityName[]): PublicLookOutcome {
  const vis = publicVisibility(b, now, names);
  if (vis !== 'ok') return { kind: vis };
  const c = b.celebrity as CelebrityRow;
  const d = bundleDisplay(b, now);
  let amazon = false;
  let affiliate = false;
  let products = 0;
  const pieces = b.pieces.map((p) => {
    // Approved items whose own text still passes (a product's text changed later is dropped, never shown).
    const own = b.items.filter((i) => i.piece_id === p.id && i.review_state === 'approved' && productTextOk(i, names));
    const render = (i: ItemRow) => {
      const offerRow = b.offers.get(i.variant_id) ?? null;
      const link = offerRow ? itemLink(b, i, offerRow.id) : null;
      if (offerRow?.connector === AMAZON_CONNECTOR) amazon = true;
      if (link) affiliate = true;
      products += 1;
      const wording = itemWording(i.match_type, c.name);
      return {
        id: i.id,
        match: i.match_type,
        label: wording.label,
        detail: wording.detail,
        product: { brand: i.brand, model: i.model, category: i.product_category },
        variant: { size_text: i.size_text, colour: i.colour },
        offer: offerRow ? publicOffer(offerRow, now) : null,
        link,
      };
    };
    const exact = own.find((i) => i.match_type === 'exact') ?? null;
    const similar = own.filter((i) => i.match_type === 'similar');
    return {
      id: p.id,
      label: p.label,
      category: p.garment_category,
      position: p.position,
      hotspot: d.image && p.hotspot_x !== null && p.hotspot_y !== null ? { x: num(p.hotspot_x), y: num(p.hotspot_y) } : null,
      products_shown: d.shoppable,
      exact: d.shoppable && exact ? render(exact) : null,
      similar_heading: CELEBRITY_COPY.similarHeading,
      similar: d.shoppable ? similar.map(render) : [],
    };
  });
  const storefront =
    b.storefront && b.storefront.status === 'live' && !storefrontNamesAnyone(b.storefront, names)
      ? { slug: b.storefront.slug, name: b.storefront.display_name }
      : null;
  return {
    kind: 'ok',
    body: {
      id: b.look.id,
      headline: lookHeadline({ event: b.look.event_name, place: b.look.place }),
      // The commercial label only on a page that carries products (a name-only look has none).
      commercial_label: d.shoppable && products > 0 ? CELEBRITY_COPY.commercialLabel : null,
      celebrity: { name: c.name, slug: c.slug },
      non_endorsement: CELEBRITY_COPY.nonEndorsement(c.name),
      moment: { event: b.look.event_name, place: b.look.place, date: isoDate(b.look.moment_date) },
      image: d.image && b.still ? { url: stillPath(b.look.id, b.still.public_url), credit: b.still.copyright_owner ?? null } : null,
      source: {
        platform: b.property?.platform ?? null,
        post_permalink: b.look.post_permalink,
        storefront,
      },
      display: d,
      disclosure: {
        sponsored: b.look.sponsored === true,
        affiliate_links: affiliate,
        amazon_associate: amazon,
      },
      pieces,
      published_at: toIso(b.look.published_at),
    },
  };
}

/** True when a storefront's slug, name or bio names any celebrity (such a storefront is never public). */
export function storefrontNamesAnyone(s: { slug: string; display_name: string | null; bio: string | null }, names: readonly CelebrityName[] | undefined): boolean {
  if (!names) return false;
  return namesIn([s.slug, s.display_name, s.bio], names).length > 0;
}

/** The origin file of a look's still, for the still's own address (routes/public.ts): only while the look page may show it. */
export function publicStillSource(b: LookBundle, now: number = Date.now(), names?: readonly CelebrityName[]): { kind: 'ok'; url: string } | { kind: 'gone' } | { kind: 'not_found' } {
  const vis = publicVisibility(b, now, names);
  if (vis !== 'ok') return { kind: vis };
  if (!bundleDisplay(b, now).image || !b.still?.public_url) return { kind: 'not_found' };
  return { kind: 'ok', url: b.still.public_url };
}

/** The editors' view: every field, pending tags with their evidence, and the effective display. */
export function editorialLook(b: LookBundle, now: number = Date.now()) {
  const d = bundleDisplay(b, now);
  return {
    id: b.look.id,
    title: b.look.title,
    status: b.look.status,
    published_at: toIso(b.look.published_at),
    withdrawn_at: toIso(b.look.withdrawn_at),
    takedown_id: b.look.takedown_id,
    library_ref: b.look.library_ref,
    celebrity_display: b.look.celebrity_display,
    celebrity: b.celebrity
      ? {
          id: b.celebrity.id,
          name: b.celebrity.name,
          slug: b.celebrity.slug,
          rights_status: b.celebrity.rights_status,
          max_display: b.celebrity.max_display,
          shoppable: b.celebrity.shoppable,
          takedown_id: b.celebrity.takedown_id,
          effective: celebrityRights(b.celebrity),
        }
      : null,
    moment: {
      event: b.look.event_name,
      place: b.look.place,
      place_kind: b.look.place_kind,
      date: isoDate(b.look.moment_date),
      place_confirmed_by: b.look.place_confirmed_by,
      place_confirmed_at: toIso(b.look.place_confirmed_at),
    },
    property: b.property ? { ...b.property, owner_operated: b.propertyOwnerOperated } : null,
    post: { platform_post_id: b.look.platform_post_id, permalink: b.look.post_permalink },
    storefront: b.storefront,
    still: b.still
      ? {
          id: b.still.id,
          storage_key: b.still.storage_key,
          public_url: b.still.public_url,
          licence: {
            license: b.still.license,
            commercial_reuse: b.still.commercial_reuse,
            territory: b.still.territory,
            expires_at: toIso(b.still.expires_at),
            source_ref: b.still.source_ref,
            copyright_owner: b.still.copyright_owner,
            author: b.still.author,
            acquisition: b.still.acquisition,
            assignment_ref: b.still.assignment_ref,
          },
          flags: {
            live_performance: b.still.live_performance,
            minor_in_frame: b.still.minor_in_frame,
            bystanders: b.still.bystanders,
            sensitive_location: b.still.sensitive_location,
          },
          screen_status: b.still.screen_status,
        }
      : null,
    display: d,
    pieces: b.pieces.map((p) => ({
      id: p.id,
      label: p.label,
      category: p.garment_category,
      position: p.position,
      hotspot: p.hotspot_x !== null && p.hotspot_y !== null ? { x: num(p.hotspot_x), y: num(p.hotspot_y) } : null,
      items: b.items
        .filter((i) => i.piece_id === p.id)
        .sort((x, y) => (x.match_type === y.match_type ? 0 : x.match_type === 'exact' ? -1 : 1))
        .map((i) => {
          const offerRow = b.offers.get(i.variant_id) ?? null;
          return {
            id: i.id,
            match_type: i.match_type,
            review_state: i.review_state,
            position: i.position,
            evidence: i.evidence,
            evidence_source: i.evidence_source,
            evidence_captured_at: toIso(i.evidence_captured_at),
            tagged_by: i.tagged_by,
            match_reviewed_by: i.match_reviewed_by,
            match_reviewed_at: toIso(i.match_reviewed_at),
            product: { id: i.product_id, brand: i.brand, model: i.model, category: i.product_category },
            variant: { id: i.variant_id, size_text: i.size_text, colour: i.colour, merchant_sku: i.merchant_sku },
            offer: offerRow ? publicOffer(offerRow, now) : null,
            links: b.links
              .filter((l) => l.look_item_id === i.id)
              .map((l) => ({ id: l.id, url: redirectLinkUrl(l.token), property_id: l.property_id, offer_id: l.offer_id })),
          };
        }),
    })),
  };
}
