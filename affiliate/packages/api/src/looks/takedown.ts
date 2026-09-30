/**
 * Takedowns — per celebrity (every look of theirs) or per look.
 *
 * ONE transaction:
 *   1. the takedowns row (requested_at = when the notice arrived; actioned_at
 *      = now);
 *   2. every affected look not already under a takedown, locked (`for
 *      update`, the same row lock link minting takes) and snapshotted
 *      (takedown_looks.previous_status);
 *   3. looks → 'withdrawn' with takedown_id; for a celebrity, the
 *      celebrity's takedown_id too (every read gate checks it, so looks
 *      created later stay hidden as well);
 *   4. every active link of those looks' items → 'paused'
 *      (paused_by_takedown_id): the redirect serves its paused page;
 *   5. their comment-reply rules → disabled; replies still queued for them →
 *      skipped_disabled (no message goes out after a takedown);
 *   6. outbox events and audit rows (takedown.action, one look.withdrawn per
 *      look).
 * After COMMIT: the route cache entries of the paused links are deleted (now
 * and 2 s later) and the web's page caches revalidated; completed_at is set
 * and a takedown.completed audit row written. The public endpoints answer
 * 410 GONE for every affected look, the celebrity's hub and their looks in
 * any feed, storefront or sitemap disappear, from the commit on.
 *
 * A celebrity's takedown also withdraws every other look whose own text
 * (event, place, piece labels) names that person (looks_named_in_text), and
 * pauses the plain links (no look item: the Amazon CLI's page links) on the
 * affected looks' own pages for the products tagged into them
 * (other_links_paused): a link printed in a post about the look pauses with
 * it even when it was not minted through the look.
 *
 * The answer lists the in-house posts that published the affected looks:
 * Afflino holds no permission to delete posts on Meta, so the owner deletes
 * them by hand and records it (POST /v1/takedowns/:id/posts-removed); the
 * stills of the affected looks (their origin files: the still's address on
 * afflino.com already answers 410; with a private origin nothing else
 * serves them — an owner item); and the afflino.com addresses whose link
 * previews Facebook / Instagram / WhatsApp may have cached (share_urls: the
 * owner asks Meta's Sharing Debugger to scrape each again).
 *
 * A look that was never public answers 404 after a takedown too (the public
 * side answers 410 only for content that was public once).
 *
 * Restore: the rights reviewer only, and only after a rights review of the
 * celebrity newer than the takedown (a restore always needs a new review).
 * Each look goes back to its snapshot status, a published one only if the
 * publish gate passes again (else 'paused'); the links this takedown paused
 * come back only for a look that is published again AND whose celebrity's
 * new review allows products (a review can only narrow what is shown): for
 * the others they stay paused, as a rights review's (a later shoppable
 * review brings them back) or an unpublished look's; comment-reply rules
 * stay off (an editor turns them on).
 */
import { AppError, effectiveCelebrityRights } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { bundleDisplay, loadLookBundle, lookOwnTexts } from './bundle.js';
import { publishGate } from './gate.js';
import { RIGHTS_REVIEWER_ROLE } from './celebrities.js';
import { celebrityNames, namesIn } from './names.js';
import { siteOrigin } from './instant-links.js';
import { audit, outbox, scoped, toIso, withTransaction } from './sql.js';
import { invalidateAfterCommit, lookTags, type InvalidationResult } from './invalidate.js';

type Log = { warn: (obj: unknown, msg?: string) => void };

export const TAKEDOWN_REASONS = [
  'rights_holder_request',
  'legal_notice',
  'court_order',
  'licence_expired',
  'privacy_request',
  'counsel_instruction',
  'operator_error',
  'other',
] as const;
export type TakedownReason = (typeof TAKEDOWN_REASONS)[number];

/** The SLA marks the takedown list reports (the brief's §7: 3 hours on an order; alarms at 1 h and 3 h). */
export const TAKEDOWN_SLA_WARN_MINUTES = 60;
export const TAKEDOWN_SLA_BREACH_MINUTES = 180;

export interface TakedownInput {
  scope: 'celebrity' | 'look';
  celebrity_id?: string;
  look_id?: string;
  reason_code: TakedownReason;
  reason_note?: string | null;
  requester_ref?: string | null;
  /** When the notice was received (ISO); default now. */
  requested_at?: string | null;
}

export interface PostToDelete {
  look_id: string;
  platform: string | null;
  account: string | null;
  post_permalink: string | null;
  platform_post_id: string | null;
}

export interface StillToRemove {
  look_id: string;
  asset_id: string;
  source_ref: string | null;
  public_url: string | null;
}

export interface TakedownResult {
  takedown: TakedownView;
  created: boolean;
  looks_withdrawn: number;
  /** Other celebrities' looks whose own text names the person taken down (withdrawn with them). */
  looks_named_in_text: string[];
  links_paused: number;
  /** Plain page links (no look item) for the affected looks' products on their own pages. */
  other_links_paused: number;
  rules_disabled: number;
  replies_cancelled: number;
  posts_to_delete: PostToDelete[];
  stills: StillToRemove[];
  /** afflino.com addresses whose cached link previews Meta should scrape again (the Sharing Debugger). */
  share_urls: string[];
  invalidation: InvalidationResult | null;
}

export interface TakedownView {
  id: string;
  scope: string;
  celebrity_id: string | null;
  look_id: string | null;
  reason_code: string;
  reason_note: string | null;
  requester_ref: string | null;
  requested_at: string | null;
  actioned_at: string | null;
  completed_at: string | null;
  actioned_by: string;
  status: string;
  restored_at: string | null;
  restored_by: string | null;
  restore_note: string | null;
  looks_withdrawn: number;
  links_paused: number;
  rules_disabled: number;
  minutes_to_action: number | null;
  sla: 'ok' | 'warn' | 'breach' | null;
}

interface TakedownRow {
  id: string;
  scope: string;
  celebrity_id: string | null;
  look_id: string | null;
  reason_code: string;
  reason_note: string | null;
  requester_ref: string | null;
  requested_at: string | Date;
  actioned_at: string | Date;
  completed_at: string | Date | null;
  actioned_by: string;
  status: string;
  restored_at: string | Date | null;
  restored_by: string | null;
  restore_note: string | null;
  looks_withdrawn: number;
  links_paused: number;
  rules_disabled: number;
}

const TAKEDOWN_COLS = `id, scope, celebrity_id, look_id, reason_code, reason_note, requester_ref, requested_at, actioned_at,
  completed_at, actioned_by, status, restored_at, restored_by, restore_note, looks_withdrawn, links_paused, rules_disabled`;

function view(r: TakedownRow): TakedownView {
  const minutes = Math.round((new Date(r.actioned_at).getTime() - new Date(r.requested_at).getTime()) / 60_000);
  return {
    id: r.id,
    scope: r.scope,
    celebrity_id: r.celebrity_id,
    look_id: r.look_id,
    reason_code: r.reason_code,
    reason_note: r.reason_note,
    requester_ref: r.requester_ref,
    requested_at: toIso(r.requested_at),
    actioned_at: toIso(r.actioned_at),
    completed_at: toIso(r.completed_at),
    actioned_by: r.actioned_by,
    status: r.status,
    restored_at: toIso(r.restored_at),
    restored_by: r.restored_by,
    restore_note: r.restore_note,
    looks_withdrawn: Number(r.looks_withdrawn),
    links_paused: Number(r.links_paused),
    rules_disabled: Number(r.rules_disabled),
    minutes_to_action: Number.isFinite(minutes) ? minutes : null,
    sla: !Number.isFinite(minutes) ? null : minutes > TAKEDOWN_SLA_BREACH_MINUTES ? 'breach' : minutes > TAKEDOWN_SLA_WARN_MINUTES ? 'warn' : 'ok',
  };
}

export async function getTakedown(orgId: string, id: string): Promise<(TakedownView & { looks: Array<{ look_id: string; previous_status: string; post_removed_at: string | null } & PostToDelete> }) | null> {
  const r = (await tenantQuery<TakedownRow>(orgId, `select ${TAKEDOWN_COLS} from takedowns where org_id = $1 and id = $2`, [id])).rows[0];
  if (!r) return null;
  const looks = (
    await tenantQuery<{ look_id: string; previous_status: string; post_removed_at: string | Date | null; post_permalink: string | null; platform_post_id: string | null; platform: string | null; account: string | null }>(
      orgId,
      `select tl.look_id, tl.previous_status, tl.post_removed_at, l.post_permalink, l.platform_post_id,
              p.platform, p.external_account_id as account
         from takedown_looks tl
         join looks l on l.id = tl.look_id and l.org_id = $1
         left join properties p on p.id = l.property_id and p.org_id = $1
        where tl.org_id = $1 and tl.takedown_id = $2
        order by tl.look_id`,
      [id],
    )
  ).rows;
  return { ...view(r), looks: looks.map((l) => ({ ...l, post_removed_at: toIso(l.post_removed_at) })) };
}

export async function listTakedowns(orgId: string, status?: 'active' | 'restored'): Promise<TakedownView[]> {
  const rows = (
    await tenantQuery<TakedownRow>(
      orgId,
      `select ${TAKEDOWN_COLS} from takedowns where org_id = $1 ${status ? 'and status = $2' : ''} order by actioned_at desc, id`,
      status ? [status] : [],
    )
  ).rows;
  return rows.map(view);
}

export async function takeDown(orgId: string, actorId: string, input: TakedownInput, log?: Log): Promise<TakedownResult> {
  if (!(TAKEDOWN_REASONS as readonly string[]).includes(input.reason_code)) throw new AppError('VALIDATION_ERROR', `reason_code is one of ${TAKEDOWN_REASONS.join(' | ')}`, 400);
  if ((input.scope === 'celebrity') !== !!input.celebrity_id || (input.scope === 'look') !== !!input.look_id) {
    throw new AppError('VALIDATION_ERROR', 'scope celebrity takes celebrity_id; scope look takes look_id', 400);
  }
  const requestedAt = input.requested_at ? new Date(input.requested_at) : new Date();
  if (Number.isNaN(requestedAt.getTime()) || requestedAt.getTime() > Date.now() + 5 * 60_000) {
    throw new AppError('VALIDATION_ERROR', 'requested_at is when the notice was received (an ISO time, not in the future)', 400);
  }

  // Existing target, and an active takedown of it (a second pull returns it).
  let celebritySlug: string | null = null;
  let namedTarget: Awaited<ReturnType<typeof celebrityNames>>[number] | null = null;
  if (input.scope === 'celebrity') {
    const c = (await tenantQuery<{ id: string; slug: string; takedown_id: string | null }>(orgId, `select id, slug, takedown_id from celebrities where org_id = $1 and id = $2`, [input.celebrity_id])).rows[0];
    if (!c) throw new AppError('NOT_FOUND', 'Celebrity not found', 404);
    celebritySlug = c.slug;
    if (c.takedown_id) return existingResult(orgId, c.takedown_id);
    namedTarget = (await celebrityNames(orgId)).find((n) => n.id === c.id) ?? null;
  } else {
    const l = (
      await tenantQuery<{ id: string; takedown_id: string | null; celebrity_id: string | null }>(orgId, `select id, takedown_id, celebrity_id from looks where org_id = $1 and id = $2`, [input.look_id])
    ).rows[0];
    if (!l) throw new AppError('NOT_FOUND', 'Look not found', 404);
    if (l.takedown_id) return existingResult(orgId, l.takedown_id);
  }

  const out = await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    const td = await q<{ id: string }>(
      `insert into takedowns (org_id, scope, celebrity_id, look_id, reason_code, reason_note, requester_ref, requested_at, actioned_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9)
       returning id`,
      [
        input.scope,
        input.celebrity_id ?? null,
        input.look_id ?? null,
        input.reason_code,
        input.reason_note?.trim() || null,
        input.requester_ref?.trim() || null,
        requestedAt.toISOString(),
        actorId,
      ],
    );
    const takedownId = (td.rows[0] as { id: string }).id;
    let looks = (
      await q<{ id: string; status: string; takedown_id: string | null }>(
        input.scope === 'celebrity'
          ? `select id, status, takedown_id from looks where org_id = $1 and celebrity_id = $2 order by id for update`
          : `select id, status, takedown_id from looks where org_id = $1 and id = $2 for update`,
        [input.scope === 'celebrity' ? input.celebrity_id : input.look_id],
      )
    ).rows.filter((l) => !l.takedown_id);
    // A celebrity's takedown: also every other look whose own text names them.
    const namedInText: string[] = [];
    if (input.scope === 'celebrity' && namedTarget) {
      const others = (
        await q<{ id: string; event_name: string | null; place: string | null }>(
          `select id, event_name, place from looks where org_id = $1 and takedown_id is null and (celebrity_id is null or celebrity_id <> $2)`,
          [input.celebrity_id],
        )
      ).rows;
      const labels = new Map<string, string[]>();
      if (others.length) {
        for (const r of (await q<{ look_id: string; label: string }>(`select look_id, label from look_pieces where org_id = $1 and removed_at is null and look_id = any($2)`, [others.map((o) => o.id)])).rows) {
          labels.set(r.look_id, [...(labels.get(r.look_id) ?? []), r.label]);
        }
      }
      const hits = others.filter((o) => namesIn([o.event_name, o.place, ...(labels.get(o.id) ?? [])], [namedTarget]).length > 0).map((o) => o.id);
      if (hits.length) {
        const locked = (await q<{ id: string; status: string; takedown_id: string | null }>(`select id, status, takedown_id from looks where org_id = $1 and id = any($2) order by id for update`, [hits])).rows.filter(
          (l) => !l.takedown_id,
        );
        looks = [...looks, ...locked];
        namedInText.push(...locked.map((l) => l.id));
      }
    }
    const lookIds = looks.map((l) => l.id);
    for (const l of looks) {
      await q(`insert into takedown_looks (takedown_id, org_id, look_id, previous_status) values ($2, $1, $3, $4)`, [takedownId, l.id, l.status]);
    }
    if (lookIds.length) {
      await q(
        `update looks set status = 'withdrawn', takedown_id = $2, withdrawn_at = now(), updated_at = now()
          where org_id = $1 and id = any($3)`,
        [takedownId, lookIds],
      );
    }
    if (input.scope === 'celebrity') {
      await q(`update celebrities set takedown_id = $3, updated_at = now() where org_id = $1 and id = $2`, [input.celebrity_id, takedownId]);
    }
    const itemIds = lookIds.length ? (await q<{ id: string }>(`select id from look_items where org_id = $1 and look_id = any($2)`, [lookIds])).rows.map((r) => r.id) : [];
    const paused = itemIds.length
      ? (
          await q<{ token: string }>(
            `update links set status = 'paused', paused_by_takedown_id = $2, paused_reason = 'takedown'
              where org_id = $1 and status = 'active' and look_item_id = any($3)
              returning token`,
            [takedownId, itemIds],
          )
        ).rows.map((r) => r.token)
      : [];
    // Links a rights review or unpublishing paused earlier are marked too, so none comes back before a restore.
    if (itemIds.length) {
      await q(
        `update links set paused_by_takedown_id = $2, paused_reason = 'takedown'
          where org_id = $1 and status = 'paused' and paused_by_takedown_id is null and look_item_id = any($3)`,
        [takedownId, itemIds],
      );
    }
    // Plain page links (no look item) for the affected looks' products on the affected looks' own pages.
    let otherPaused: string[] = [];
    if (lookIds.length) {
      const variants = (await q<{ variant_id: string }>(`select distinct variant_id from look_items where org_id = $1 and look_id = any($2)`, [lookIds])).rows.map((r) => r.variant_id);
      const props = (await q<{ property_id: string }>(`select distinct property_id from looks where org_id = $1 and id = any($2) and property_id is not null`, [lookIds])).rows.map((r) => r.property_id);
      if (variants.length && props.length) {
        const offerIds = (await q<{ id: string }>(`select id from offers where org_id = $1 and variant_id = any($2)`, [variants])).rows.map((r) => r.id);
        const placementIds = (await q<{ id: string }>(`select id from placements where org_id = $1 and property_id = any($2)`, [props])).rows.map((r) => r.id);
        if (offerIds.length && placementIds.length) {
          otherPaused = (
            await q<{ token: string }>(
              `update links set status = 'paused', paused_by_takedown_id = $2, paused_reason = 'takedown'
                where org_id = $1 and status = 'active' and look_item_id is null and offer_id = any($3) and placement_id = any($4)
                returning token`,
              [takedownId, offerIds, placementIds],
            )
          ).rows.map((r) => r.token);
        }
      }
    }
    const rules = lookIds.length
      ? (
          await q<{ id: string }>(
            `update reply_rules set enabled = false, disabled_by_takedown_id = $2, updated_at = now()
              where org_id = $1 and look_id = any($3) and enabled = true
              returning id`,
            [takedownId, lookIds],
          )
        ).rows.map((r) => r.id)
      : [];
    const allRules = lookIds.length ? (await q<{ id: string }>(`select id from reply_rules where org_id = $1 and look_id = any($2)`, [lookIds])).rows.map((r) => r.id) : [];
    const cancelled = allRules.length
      ? (
          await q<{ id: string }>(
            `update reply_events set status = 'skipped_disabled', error_code = 'takedown', updated_at = now()
              where org_id = $1 and rule_id = any($2) and status in ('queued', 'failed_transient')
              returning id`,
            [allRules],
          )
        ).rows.length
      : 0;
    await q(`update takedowns set looks_withdrawn = $3, links_paused = $4, rules_disabled = $5 where org_id = $1 and id = $2`, [
      takedownId,
      lookIds.length,
      paused.length + otherPaused.length,
      rules.length,
    ]);
    await audit(q, actorId, 'takedown.action', 'takedown', takedownId);
    for (const id of lookIds) await audit(q, actorId, 'look.withdrawn', 'look', id);
    await outbox(q, 'takedown.actioned', {
      org_id: orgId,
      takedown_id: takedownId,
      scope: input.scope,
      celebrity_id: input.celebrity_id ?? null,
      look_ids: lookIds,
      links_paused: paused.length + otherPaused.length,
      requested_at: requestedAt.toISOString(),
    });
    return { takedownId, lookIds, tokens: [...paused, ...otherPaused], itemTokens: paused.length, otherTokens: otherPaused.length, rules: rules.length, cancelled, namedInText };
  });

  const storefronts = out.lookIds.length
    ? (
        await tenantQuery<{ slug: string }>(
          orgId,
          `select distinct s.slug from looks l join storefronts s on s.property_id = l.property_id and s.org_id = $1
            where l.org_id = $1 and l.id = any($2)`,
          [out.lookIds],
        )
      ).rows.map((r) => r.slug)
    : [];
  const tags = [
    ...out.lookIds.flatMap((id) => lookTags({ id })),
    ...(celebritySlug ? [`celebrity:${celebritySlug}`] : []),
    ...storefronts.map((s) => `storefront:${s}`),
  ];
  const invalidation = await invalidateAfterCommit({ tokens: out.tokens, tags }, log);
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    await q(`update takedowns set completed_at = now() where org_id = $1 and id = $2`, [out.takedownId]);
    await audit(q, actorId, 'takedown.completed', 'takedown', out.takedownId);
  });
  const td = (await getTakedown(orgId, out.takedownId)) as NonNullable<Awaited<ReturnType<typeof getTakedown>>>;
  return {
    takedown: stripLooks(td),
    created: true,
    looks_withdrawn: out.lookIds.length,
    looks_named_in_text: out.namedInText,
    links_paused: out.itemTokens,
    other_links_paused: out.otherTokens,
    rules_disabled: out.rules,
    replies_cancelled: out.cancelled,
    posts_to_delete: td.looks.filter((l) => l.post_permalink || l.platform_post_id).map(postOf),
    ...(await removalLists(orgId, td.looks.map((l) => l.look_id), celebritySlug, storefronts)),
    invalidation,
  };
}

/** The stills of the affected looks and the afflino.com addresses whose link previews may be cached. */
async function removalLists(orgId: string, lookIds: string[], celebritySlug: string | null, storefrontSlugs: string[]): Promise<{ stills: StillToRemove[]; share_urls: string[] }> {
  const stills = lookIds.length
    ? (
        await tenantQuery<StillToRemove>(
          orgId,
          `select l.id as look_id, a.id as asset_id, a.source_ref, a.public_url
             from looks l join assets a on a.id = l.still_asset_id and a.org_id = $1
            where l.org_id = $1 and l.id = any($2)
            order by l.id`,
          [lookIds],
        )
      ).rows
    : [];
  const origin = siteOrigin();
  const share = [
    ...lookIds.map((id) => `${origin}/looks/${id}`),
    ...(celebritySlug ? [`${origin}/c/${celebritySlug}`] : []),
    ...storefrontSlugs.map((s) => `${origin}/s/${s}`),
  ];
  return { stills, share_urls: [...new Set(share)] };
}

function postOf(l: PostToDelete): PostToDelete {
  return { look_id: l.look_id, platform: l.platform, account: l.account, post_permalink: l.post_permalink, platform_post_id: l.platform_post_id };
}

function stripLooks<T extends { looks: unknown }>(t: T): Omit<T, 'looks'> {
  const { looks: _looks, ...rest } = t;
  return rest;
}

async function existingResult(orgId: string, takedownId: string): Promise<TakedownResult> {
  const td = await getTakedown(orgId, takedownId);
  if (!td) throw new AppError('NOT_FOUND', 'Takedown not found', 404);
  const celeb = td.celebrity_id ? (await tenantQuery<{ slug: string }>(orgId, `select slug from celebrities where org_id = $1 and id = $2`, [td.celebrity_id])).rows[0] : undefined;
  return {
    takedown: stripLooks(td),
    created: false,
    looks_withdrawn: td.looks_withdrawn,
    looks_named_in_text: [],
    links_paused: td.links_paused,
    other_links_paused: 0,
    rules_disabled: td.rules_disabled,
    replies_cancelled: 0,
    posts_to_delete: td.looks.filter((l) => l.post_permalink || l.platform_post_id).map(postOf),
    ...(await removalLists(orgId, td.looks.map((l) => l.look_id), celeb?.slug ?? null, [])),
    invalidation: null,
  };
}

export interface RestoreResult {
  takedown: TakedownView;
  looks: Array<{ look_id: string; status: string; gate_ok: boolean | null; shoppable: boolean }>;
  links_reactivated: number;
  invalidation: InvalidationResult | null;
}

export async function restoreTakedown(
  orgId: string,
  actor: { id: string; role: string },
  takedownId: string,
  note: string,
  log?: Log,
): Promise<RestoreResult> {
  if (actor.role !== RIGHTS_REVIEWER_ROLE) throw new AppError('FORBIDDEN', 'only the rights reviewer restores a takedown', 403);
  if (!note || note.trim().length < 3) throw new AppError('VALIDATION_ERROR', 'a restore needs a note (why the takedown is lifted)', 400);
  const td = await getTakedown(orgId, takedownId);
  if (!td) throw new AppError('NOT_FOUND', 'Takedown not found', 404);
  if (td.status !== 'active') throw new AppError('CONFLICT', 'the takedown was already restored', 409);

  // A restore needs a rights review newer than the takedown of the celebrity it was about (the celebrity
  // taken down, or the look's own). Other looks withdrawn because their text named that person need no
  // review of their own celebrity: the gate refuses them while their text still names anyone.
  const celebrityIds = new Set<string>();
  if (td.celebrity_id) celebrityIds.add(td.celebrity_id);
  else if (td.look_id) {
    const c = (await tenantQuery<{ celebrity_id: string | null }>(orgId, `select celebrity_id from looks where org_id = $1 and id = $2`, [td.look_id])).rows[0];
    if (c?.celebrity_id) celebrityIds.add(c.celebrity_id);
  }
  let reviewId: string | null = null;
  for (const cid of celebrityIds) {
    const rev = (
      await tenantQuery<{ id: string }>(
        orgId,
        `select id from celebrity_rights_reviews
          where org_id = $1 and celebrity_id = $2 and kind = 'review' and reviewed_at > $3::timestamptz
          order by reviewed_at desc, id limit 1`,
        [cid, td.actioned_at],
      )
    ).rows[0];
    if (!rev) {
      throw new AppError('CONFLICT', 'a restore needs a new rights review of the celebrity, recorded after the takedown (POST /v1/celebrities/:id/rights-review)', 409);
    }
    reviewId = reviewId ?? rev.id;
  }

  // Which looks may be published again: the gate as if this takedown were gone; and whether they may carry products.
  const decisions: Array<{ look_id: string; status: string; gate_ok: boolean | null; shoppable: boolean }> = [];
  const names = await celebrityNames(orgId);
  for (const l of td.looks) {
    const b = await loadLookBundle(orgId, l.look_id);
    if (!b || b.look.takedown_id !== takedownId) continue;
    const asRestored = { ...b, look: { ...b.look, takedown_id: null }, celebrity: b.celebrity && b.celebrity.takedown_id === takedownId ? { ...b.celebrity, takedown_id: null } : b.celebrity };
    const shoppable = !!asRestored.celebrity && effectiveCelebrityRights(asRestored.celebrity).shoppable && bundleDisplay(asRestored).shoppable;
    if (l.previous_status !== 'published') {
      decisions.push({ look_id: l.look_id, status: l.previous_status, gate_ok: null, shoppable });
      continue;
    }
    const gate = await publishGate(orgId, b, { ignoreTakedownId: takedownId, names });
    decisions.push({ look_id: l.look_id, status: gate.ok ? 'published' : 'paused', gate_ok: gate.ok, shoppable });
  }

  const tokens = await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    const upd = await q<{ id: string }>(
      `update takedowns set status = 'restored', restored_at = now(), restored_by = $3, restore_note = $4, restore_review_id = $5
        where org_id = $1 and id = $2 and status = 'active' returning id`,
      [takedownId, actor.id, note.trim(), reviewId],
    );
    if (upd.rows.length === 0) throw new AppError('CONFLICT', 'the takedown was already restored', 409);
    if (td.scope === 'celebrity' && td.celebrity_id) {
      await q(`update celebrities set takedown_id = null, updated_at = now() where org_id = $1 and id = $2 and takedown_id = $3`, [td.celebrity_id, takedownId]);
    }
    for (const d of decisions) {
      await q(
        `update looks set status = $3, takedown_id = null, withdrawn_at = null, updated_at = now()
          where org_id = $1 and id = $2 and takedown_id = $4`,
        [d.look_id, d.status, takedownId],
      );
      await audit(q, actor.id, 'look.restored', 'look', d.look_id);
    }
    // Links come back only for a look published again whose celebrity's new review allows products.
    const live = decisions.filter((d) => d.status === 'published' && d.shoppable).map((d) => d.look_id);
    const noProducts = decisions.filter((d) => d.status === 'published' && !d.shoppable).map((d) => d.look_id);
    let back: string[] = [];
    if (live.length) {
      const itemIds = (await q<{ id: string }>(`select id from look_items where org_id = $1 and look_id = any($2) and removed_at is null`, [live])).rows.map((r) => r.id);
      if (itemIds.length) {
        back = (
          await q<{ token: string }>(
            `update links set status = 'active', paused_by_takedown_id = null, paused_reason = null
              where org_id = $1 and status = 'paused' and paused_by_takedown_id = $2 and look_item_id = any($3)
              returning token`,
            [takedownId, itemIds],
          )
        ).rows.map((r) => r.token);
      }
      // Plain page links for those looks' products on their own pages come back with them.
      const variants = (await q<{ variant_id: string }>(`select distinct variant_id from look_items where org_id = $1 and look_id = any($2) and removed_at is null`, [live])).rows.map((r) => r.variant_id);
      const props = (await q<{ property_id: string }>(`select distinct property_id from looks where org_id = $1 and id = any($2) and property_id is not null`, [live])).rows.map((r) => r.property_id);
      if (variants.length && props.length) {
        const offerIds = (await q<{ id: string }>(`select id from offers where org_id = $1 and variant_id = any($2)`, [variants])).rows.map((r) => r.id);
        const placementIds = (await q<{ id: string }>(`select id from placements where org_id = $1 and property_id = any($2)`, [props])).rows.map((r) => r.id);
        if (offerIds.length && placementIds.length) {
          back.push(
            ...(
              await q<{ token: string }>(
                `update links set status = 'active', paused_by_takedown_id = null, paused_reason = null
                  where org_id = $1 and status = 'paused' and paused_by_takedown_id = $2 and look_item_id is null
                    and offer_id = any($3) and placement_id = any($4)
                  returning token`,
                [takedownId, offerIds, placementIds],
              )
            ).rows.map((r) => r.token),
          );
        }
      }
    }
    // A published look whose celebrity may not carry products now: its links stay paused as a rights review's
    // (a later shoppable review brings them back through ensureLookLinks).
    if (noProducts.length) {
      const itemIds = (await q<{ id: string }>(`select id from look_items where org_id = $1 and look_id = any($2)`, [noProducts])).rows.map((r) => r.id);
      if (itemIds.length) {
        await q(
          `update links set paused_by_takedown_id = null, paused_reason = 'rights_review'
            where org_id = $1 and status = 'paused' and paused_by_takedown_id = $2 and look_item_id = any($3)`,
          [takedownId, itemIds],
        );
      }
    }
    // Plain page links not brought back stay paused (the owner mints new ones when they are wanted).
    await q(
      `update links set paused_by_takedown_id = null, paused_reason = 'rights_review'
        where org_id = $1 and status = 'paused' and paused_by_takedown_id = $2 and look_item_id is null`,
      [takedownId],
    );
    // Links of looks that stay unpublished keep their pause, now as an unpublished look's.
    await q(
      `update links set paused_by_takedown_id = null, paused_reason = 'look_unpublished'
        where org_id = $1 and status = 'paused' and paused_by_takedown_id = $2`,
      [takedownId],
    );
    await audit(q, actor.id, 'takedown.restore', 'takedown', takedownId);
    await outbox(q, 'takedown.restored', { org_id: orgId, takedown_id: takedownId, restored_by: actor.id, looks: decisions });
    return back;
  });
  const celeb = td.celebrity_id ? (await tenantQuery<{ slug: string }>(orgId, `select slug from celebrities where org_id = $1 and id = $2`, [td.celebrity_id])).rows[0] : undefined;
  const invalidation = await invalidateAfterCommit(
    { tokens, tags: [...decisions.flatMap((d) => lookTags({ id: d.look_id })), ...(celeb ? [`celebrity:${celeb.slug}`] : [])] },
    log,
  );
  const after = (await getTakedown(orgId, takedownId)) as NonNullable<Awaited<ReturnType<typeof getTakedown>>>;
  return { takedown: stripLooks(after), looks: decisions, links_reactivated: tokens.length, invalidation };
}

/** The owner's record that the in-house posts of these looks were deleted on Meta. */
export async function markPostsRemoved(orgId: string, actorId: string, takedownId: string, lookIds: string[]): Promise<number> {
  const td = await getTakedown(orgId, takedownId);
  if (!td) throw new AppError('NOT_FOUND', 'Takedown not found', 404);
  const known = new Set(td.looks.map((l) => l.look_id));
  const ids = lookIds.filter((id) => known.has(id));
  if (ids.length === 0) return 0;
  return withTransaction(async (client) => {
    const q = scoped(client, orgId);
    const res = await q<{ look_id: string }>(
      `update takedown_looks set post_removed_at = now()
        where org_id = $1 and takedown_id = $2 and look_id = any($3) and post_removed_at is null
        returning look_id`,
      [takedownId, ids],
    );
    await audit(q, actorId, 'takedown.posts_removed', 'takedown', takedownId);
    return res.rows.length;
  });
}
