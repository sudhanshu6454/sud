/**
 * A look's own tracked links: one per approved item with a live offer, on
 * afflino.com's own (web) placement — the look page is on afflino.com, so
 * its clicks and sales are recorded against afflino.com's placement and tag,
 * never a Facebook / Instagram page's (CLAUDE.md "never guess
 * attribution"); for Amazon only a placement with its own tracking ID (a
 * placement on the store ID could not attribute its sales). The links
 * printed in an in-house page's posts are that page's own (instant links,
 * src/looks/instant-links.ts), scoped to the same item.
 * Every link is minted through src/links/mint.ts (the guards of POST
 * /v1/links: owner-operated, accepted platforms, the canonical /dp/<ASIN>…).
 *
 * Serialised against takedowns: the insert runs in a transaction holding the
 * look's row lock (`select … for update`) and re-checks that the look is
 * published and not taken down. A takedown updates that same row first, so
 * either the takedown waits and then pauses the new link, or the mint waits
 * and then refuses (scripts/celebrity-looks-pg.ts races the two on real
 * Postgres). The route cache is not warmed for these links: the redirect's
 * DB fallback builds it from the committed state.
 */
import { AppError, effectiveCelebrityRights } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { amazonAccountForProgramme } from '../amazon/account.js';
import { checkMintGuards, insertLink, type MintBody, type Queryable } from '../links/mint.js';
import { redirectLinkUrl } from '../redirect-url.js';
import { bundleDisplay, loadLookBundle, type LookBundle } from './bundle.js';
import { scoped, withTransaction } from './sql.js';
import { invalidateAfterCommit, lookTags, type InvalidationResult } from './invalidate.js';

export interface PlacementChoice {
  placement_id: string;
  property_id: string;
  platform: string;
}

/**
 * The placement a look page's link for `programmeId` goes on: afflino.com's
 * own (web) placement in the programme's campaign; for an Amazon programme
 * only one with its own tracking ID (<store>-web-21). Null when none.
 */
export async function chooseLookPlacement(orgId: string, programmeId: string): Promise<PlacementChoice | null> {
  const amazon = await amazonAccountForProgramme(orgId, programmeId);
  const rows = (
    await tenantQuery<{ id: string; property_id: string; platform: string; tracking_id: string | null }>(
      orgId,
      `select pl.id, pl.property_id, p.platform, t.tracking_id
         from placements pl
         join campaigns ca on ca.id = pl.campaign_id and ca.org_id = $1
         join properties p on p.id = pl.property_id and p.org_id = $1
         left join amazon_tracking_ids t on t.placement_id = pl.id and t.org_id = $1
        where pl.org_id = $1 and ca.programme_id = $2 and p.status = 'approved'
        order by pl.created_at, pl.id`,
      [programmeId],
    )
  ).rows.filter((r) => !amazon || r.tracking_id);
  const web = rows.find((r) => r.platform === 'web');
  return web ? { placement_id: web.id, property_id: web.property_id, platform: web.platform } : null;
}

/** A property's placement in the programme's campaign (instant links for a chosen page). */
export async function propertyPlacement(orgId: string, propertyId: string, programmeId: string): Promise<{ id: string; tracking_id: string | null } | null> {
  const res = await tenantQuery<{ id: string; tracking_id: string | null }>(
    orgId,
    `select pl.id, t.tracking_id
       from placements pl
       join campaigns ca on ca.id = pl.campaign_id and ca.org_id = $1
       left join amazon_tracking_ids t on t.placement_id = pl.id and t.org_id = $1
      where pl.org_id = $1 and ca.programme_id = $2 and pl.property_id = $3
      order by pl.created_at, pl.id
      limit 1`,
    [programmeId, propertyId],
  );
  return res.rows[0] ?? null;
}

/**
 * Mint (or reuse) the link of one item on one placement, under the look's
 * row lock. `requirePublished`: the look must be published (the look page's
 * own links); instant links for a draft look's pages pass false, but never
 * for a look that is withdrawn or under takedown. Under the same lock: the
 * item is approved (an EXACT tag waits for its second person: no link is
 * minted for it before), and the celebrity's rights allow a shoppable page
 * right now (a review that turned it off, or a minor flag, commits under
 * the same row locks: src/looks/celebrities.ts, library-import.ts).
 */
export async function mintItemLink(
  orgId: string,
  lookId: string,
  body: MintBody & { look_item_id: string },
  opts: { requirePublished: boolean },
): Promise<{ token: string; url: string; minted: boolean }> {
  const prepared = await checkMintGuards(orgId, body);
  return withTransaction(async (client) => {
    const q = scoped(client, orgId);
    const look = (
      await q<{ status: string; takedown_id: string | null; celebrity_id: string | null }>(
        `select status, takedown_id, celebrity_id from looks where org_id = $1 and id = $2 for update`,
        [lookId],
      )
    ).rows[0];
    if (!look) throw new AppError('NOT_FOUND', 'Look not found', 404);
    if (look.status === 'withdrawn' || look.takedown_id) throw new AppError('GONE', 'The look was withdrawn (takedown): no link is minted for it', 410);
    if (opts.requirePublished && look.status !== 'published') throw new AppError('CONFLICT', 'The look is not published', 409);
    if (look.celebrity_id) {
      const c = (
        await q<{ takedown_id: string | null; rights_status: string; max_display: string; shoppable: boolean; is_minor: boolean; never_list: boolean }>(
          `select takedown_id, rights_status, max_display, shoppable, is_minor, never_list from celebrities where org_id = $1 and id = $2`,
          [look.celebrity_id],
        )
      ).rows[0];
      if (c?.takedown_id) throw new AppError('GONE', 'The celebrity is under takedown: no link is minted', 410);
      if (!c || !effectiveCelebrityRights(c).shoppable) {
        throw new AppError('CONFLICT', "The celebrity's rights do not allow a shoppable page: no link is minted", 409);
      }
    }
    const item = (
      await q<{ id: string; review_state: string | null; removed_at: unknown }>(
        `select id, review_state, removed_at from look_items where org_id = $1 and id = $2 and look_id = $3`,
        [body.look_item_id, lookId],
      )
    ).rows[0];
    if (!item || item.removed_at) throw new AppError('NOT_FOUND', 'Look item not found', 404);
    if (item.review_state !== 'approved') {
      throw new AppError('CONFLICT', "An EXACT tag waits for its second person's approval: no link is minted for it yet", 409);
    }
    const existing = (
      await q<{ token: string }>(
        `select token from links
          where org_id = $1 and look_item_id = $2 and placement_id = $3 and offer_id = $4 and status = 'active'
          order by created_at, id limit 1`,
        [body.look_item_id, body.placement_id, body.offer_id],
      )
    ).rows[0];
    if (existing) return { token: existing.token, url: redirectLinkUrl(existing.token), minted: false };
    const { token } = await insertLink(client, orgId, body, prepared);
    return { token, url: redirectLinkUrl(token), minted: true };
  });
}

export interface EnsureLinksResult {
  minted: number;
  existing: number;
  reactivated: number;
  unlinked: Array<{ item_id: string; reason: string }>;
  invalidation: InvalidationResult | null;
}

const REACTIVATABLE = ['look_unpublished', 'rights_review'];

/**
 * Bring a published, shoppable look's links up to date: reactivate its
 * links paused by unpublishing or a rights review (never those a takedown
 * or an item removal paused), then mint the missing ones.
 */
export async function ensureLookLinks(
  orgId: string,
  lookId: string,
  log?: { warn: (obj: unknown, msg?: string) => void },
): Promise<EnsureLinksResult> {
  const out: EnsureLinksResult = { minted: 0, existing: 0, reactivated: 0, unlinked: [], invalidation: null };
  let b = await loadLookBundle(orgId, lookId);
  if (!b || b.look.status !== 'published' || b.look.takedown_id || !bundleDisplay(b).shoppable) return out;
  const approved = b.items.filter((i) => i.review_state === 'approved');
  if (approved.length > 0) {
    const tokens = await withTransaction(async (client) => {
      const q = scoped(client, orgId);
      const look = (await q<{ status: string; takedown_id: string | null }>(`select status, takedown_id from looks where org_id = $1 and id = $2 for update`, [lookId])).rows[0];
      if (!look || look.status !== 'published' || look.takedown_id) return [];
      const res = await q<{ token: string }>(
        `update links set status = 'active', paused_reason = null
          where org_id = $1 and status = 'paused' and paused_by_takedown_id is null
            and paused_reason = any($2) and look_item_id = any($3)
          returning token`,
        [REACTIVATABLE, approved.map((i) => i.id)],
      );
      return res.rows.map((r) => r.token);
    });
    out.reactivated = tokens.length;
    if (tokens.length > 0) {
      out.invalidation = await invalidateAfterCommit({ tokens, tags: lookTags({ id: lookId }) }, log);
      b = (await loadLookBundle(orgId, lookId)) as LookBundle;
    }
  }
  for (const item of b.items.filter((i) => i.review_state === 'approved')) {
    const offer = b.offers.get(item.variant_id);
    if (!offer) {
      out.unlinked.push({ item_id: item.id, reason: 'no_live_offer' });
      continue;
    }
    const choice = await chooseLookPlacement(orgId, offer.programme_id);
    if (!choice) {
      out.unlinked.push({ item_id: item.id, reason: 'no_placement' });
      continue;
    }
    const have = b.links.find((l) => l.look_item_id === item.id && l.offer_id === offer.id && l.placement_id === choice.placement_id);
    if (have) {
      out.existing += 1;
      continue;
    }
    try {
      const r = await mintItemLink(
        orgId,
        lookId,
        { property_id: choice.property_id, programme_id: offer.programme_id, offer_id: offer.id, placement_id: choice.placement_id, look_item_id: item.id },
        { requirePublished: true },
      );
      if (r.minted) out.minted += 1;
      else out.existing += 1;
    } catch (err) {
      out.unlinked.push({ item_id: item.id, reason: err instanceof AppError ? err.code : 'INTERNAL' });
    }
  }
  return out;
}

/**
 * Pause every active link of the given items (a look unpublished, an item
 * removed, a rights review that turned the shoppable page off, a minor
 * flag). Tokens are returned for the cache invalidation after commit. With
 * `db` (a transaction's client), inside that transaction.
 */
export async function pauseItemLinks(
  orgId: string,
  itemIds: string[],
  reason: 'rights_review' | 'item_removed' | 'look_unpublished',
  db?: Queryable,
): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const sql = `update links set status = 'paused', paused_reason = $2
      where org_id = $1 and status = 'active' and look_item_id = any($3)
      returning token`;
  const res = db ? await scoped(db, orgId)<{ token: string }>(sql, [reason, itemIds]) : await tenantQuery<{ token: string }>(orgId, sql, [reason, itemIds]);
  return res.rows.map((r) => r.token);
}

/** Every item id of the given looks (removed ones too: their links must pause as well). */
export async function itemIdsOfLooks(orgId: string, lookIds: string[], db?: Queryable): Promise<string[]> {
  if (lookIds.length === 0) return [];
  const sql = `select id from look_items where org_id = $1 and look_id = any($2)`;
  const res = db ? await scoped(db, orgId)<{ id: string }>(sql, [lookIds]) : await tenantQuery<{ id: string }>(orgId, sql, [lookIds]);
  return res.rows.map((r) => r.id);
}

/**
 * Inside a transaction: lock every look of a celebrity (the row lock link
 * minting takes, so no mint slips in between) and pause the active links of
 * their items with `reason`. Returns the look ids and the paused tokens.
 */
export async function lockAndPauseCelebrityLinks(
  db: Queryable,
  orgId: string,
  celebrityId: string,
  reason: 'rights_review',
): Promise<{ lookIds: string[]; tokens: string[] }> {
  const q = scoped(db, orgId);
  const lookIds = (await q<{ id: string }>(`select id from looks where org_id = $1 and celebrity_id = $2 order by id for update`, [celebrityId])).rows.map((r) => r.id);
  const tokens = await pauseItemLinks(orgId, await itemIdsOfLooks(orgId, lookIds, db), reason, db);
  return { lookIds, tokens };
}
