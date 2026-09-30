/**
 * Celebrities and their rights reviews.
 *
 * - A celebrity starts 'unreviewed' (nothing about them is published).
 * - Only the rights reviewer (counsel's role) sets 'editorial' or 'cleared',
 *   with a note and an evidence reference; any editor may set 'blocked'
 *   (restricting is always allowed). A review's max_display / shoppable
 *   default to the narrow end (name only, not shoppable) and can never
 *   exceed the capability matrix (@paparazzi/shared CELEBRITY_RIGHTS_MATRIX).
 * - A minor or a never-listed celebrity can only be unreviewed or blocked.
 * - Renaming, or adding an alias, sends a reviewed celebrity back to
 *   'unreviewed' (a review is of a person identified by name: a new alias
 *   changes whose library rows match the record).
 * - A review that turns the shoppable page off pauses the links inside its
 *   own transaction, with every look of the celebrity locked (the row lock
 *   link minting takes), so no link is minted in between and none survives
 *   a crash after the commit.
 * - Every decision is a row of celebrity_rights_reviews (append-only) plus an
 *   audit row. A review that turns the shoppable page off pauses the links of
 *   the celebrity's looks at once; one that turns it back on reactivates them
 *   (published looks only); both clear the caches.
 */
import {
  AppError,
  CELEBRITY_RIGHTS_MATRIX,
  STATUSES_ANY_EDITOR_MAY_SET,
  celebrityNameKey,
  displayWithin,
  effectiveCelebrityRights,
  isDisplayLevel,
  slugify,
  type CelebrityDisplayLevel,
  type CelebrityRightsStatus,
} from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { CELEBRITY_COLS, loadCelebrity, type CelebrityRow } from './bundle.js';
import { audit, outbox, scoped, toIso, withTransaction, type Scoped } from './sql.js';
import { ensureLookLinks, lockAndPauseCelebrityLinks } from './look-links.js';
import { invalidateAfterCommit, type InvalidationResult } from './invalidate.js';

export const RIGHTS_REVIEWER_ROLE = 'rights_reviewer';

export function normaliseAliases(aliases: readonly string[] | undefined | null): string[] {
  const out = new Set<string>();
  for (const a of aliases ?? []) {
    const t = a.replace(/\s+/g, ' ').trim();
    if (t !== '' && t.length <= 120) out.add(t);
  }
  return [...out].slice(0, 20);
}

/** A slug unique in the org: the name's, then -2, -3, … */
export async function uniqueCelebritySlug(q: Scoped, name: string, exceptId: string | null = null): Promise<string> {
  const base = slugify(name) || 'celebrity';
  for (let i = 1; i < 1000; i += 1) {
    const slug = i === 1 ? base : `${base.slice(0, 70)}-${i}`;
    const taken = (await q<{ id: string }>(`select id from celebrities where org_id = $1 and slug = $2`, [slug])).rows[0];
    if (!taken || taken.id === exceptId) return slug;
  }
  throw new AppError('CONFLICT', 'no free slug for this name', 409);
}

/** The celebrity whose normalised name or alias equals `name`: one, none, or ambiguous. */
export async function findCelebrityByName(
  q: Scoped,
  name: string,
): Promise<{ kind: 'one'; row: CelebrityRow } | { kind: 'none' } | { kind: 'ambiguous'; ids: string[] }> {
  const key = celebrityNameKey(name);
  const byName = (await q<CelebrityRow>(`select ${CELEBRITY_COLS} from celebrities c where c.org_id = $1 and c.name_key = $2`, [key])).rows[0];
  if (byName) return { kind: 'one', row: byName };
  const all = (await q<CelebrityRow>(`select ${CELEBRITY_COLS} from celebrities c where c.org_id = $1`)).rows;
  const hits = all.filter((r) => (r.aliases ?? []).some((a) => celebrityNameKey(a) === key));
  if (hits.length === 1) return { kind: 'one', row: hits[0] as CelebrityRow };
  if (hits.length > 1) return { kind: 'ambiguous', ids: hits.map((h) => h.id) };
  return { kind: 'none' };
}

export async function createCelebrity(
  q: Scoped,
  input: { name: string; aliases?: string[]; is_minor?: boolean; never_list?: boolean },
): Promise<CelebrityRow> {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (name === '' || name.length > 120) throw new AppError('VALIDATION_ERROR', 'name must be 1-120 characters', 400);
  const key = celebrityNameKey(name);
  if (key === '') throw new AppError('VALIDATION_ERROR', 'name must contain letters or digits', 400);
  if ((await q<{ id: string }>(`select id from celebrities where org_id = $1 and name_key = $2`, [key])).rows[0]) {
    throw new AppError('CONFLICT', 'a celebrity with this name already exists', 409);
  }
  const slug = await uniqueCelebritySlug(q, name);
  const res = await q<CelebrityRow>(
    `insert into celebrities (org_id, name, name_key, slug, aliases, is_minor, never_list)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [name, key, slug, normaliseAliases(input.aliases), input.is_minor === true, input.never_list === true],
  );
  const id = (res.rows[0] as { id: string }).id;
  return (await q<CelebrityRow>(`select ${CELEBRITY_COLS} from celebrities c where c.org_id = $1 and c.id = $2`, [id])).rows[0] as CelebrityRow;
}

export function celebrityView(c: CelebrityRow) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    aliases: c.aliases ?? [],
    is_minor: c.is_minor,
    never_list: c.never_list,
    rights_status: c.rights_status,
    max_display: c.max_display,
    shoppable: c.shoppable,
    rights_note: c.rights_note,
    rights_evidence_ref: c.rights_evidence_ref,
    rights_reviewed_by: c.rights_reviewed_by,
    rights_reviewed_at: toIso(c.rights_reviewed_at),
    takedown_id: c.takedown_id,
    effective: effectiveCelebrityRights(c),
    created_at: toIso(c.created_at),
    updated_at: toIso(c.updated_at),
  };
}

export interface ReviewInput {
  rights_status: CelebrityRightsStatus;
  max_display?: CelebrityDisplayLevel;
  shoppable?: boolean;
  note?: string | null;
  evidence_ref?: string | null;
}

export interface ReviewResult {
  celebrity: CelebrityRow;
  review_id: string;
  links_paused: number;
  links_reactivated: number;
  invalidation: InvalidationResult | null;
}

/**
 * Record a rights decision. `actorRole` decides what may be set (rights
 * reviewer: anything; network_admin / editor: 'blocked' only).
 */
export async function reviewCelebrity(
  orgId: string,
  actor: { id: string; role: string },
  celebrityId: string,
  input: ReviewInput,
  log?: { warn: (obj: unknown, msg?: string) => void },
): Promise<ReviewResult> {
  const status = input.rights_status;
  if (actor.role !== RIGHTS_REVIEWER_ROLE && !STATUSES_ANY_EDITOR_MAY_SET.includes(status)) {
    throw new AppError('FORBIDDEN', `only the rights reviewer sets '${status}' (an editor may set 'blocked')`, 403);
  }
  const ceiling = CELEBRITY_RIGHTS_MATRIX[status];
  const maxDisplay: CelebrityDisplayLevel =
    ceiling.display === 'none' ? 'none' : input.max_display ?? 'name_only';
  if (!isDisplayLevel(maxDisplay) || !displayWithin(maxDisplay, ceiling.display)) {
    throw new AppError('VALIDATION_ERROR', `status '${status}' allows at most '${ceiling.display}'`, 400);
  }
  const shoppable = input.shoppable === true;
  if (shoppable && (!ceiling.shoppable || maxDisplay === 'none')) {
    throw new AppError('VALIDATION_ERROR', `status '${status}' does not allow a shoppable page`, 400);
  }
  const note = input.note?.trim() || null;
  const evidence = input.evidence_ref?.trim() || null;
  if ((status === 'editorial' || status === 'cleared') && (!evidence || evidence.length < 3 || !note)) {
    throw new AppError('VALIDATION_ERROR', `'${status}' needs the evidence reference (counsel's written advice, a licence) and a note`, 400);
  }

  const before = await loadCelebrity(orgId, celebrityId);
  if (!before) throw new AppError('NOT_FOUND', 'Celebrity not found', 404);
  if ((before.is_minor || before.never_list) && status !== 'unreviewed' && status !== 'blocked') {
    throw new AppError('CONFLICT', 'a minor or never-listed celebrity can only be unreviewed or blocked', 409);
  }
  const wasShoppable = effectiveCelebrityRights(before).shoppable;
  const willBeShoppable = effectiveCelebrityRights({ ...before, rights_status: status, max_display: maxDisplay, shoppable }).shoppable;

  let pausedInTx: string[] = [];
  const reviewId = await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    const rev = await q<{ id: string }>(
      `insert into celebrity_rights_reviews
         (org_id, celebrity_id, kind, rights_status, max_display, shoppable, note, evidence_ref, reviewed_by, reviewed_role)
       values ($1, $2, 'review', $3, $4, $5, $6, $7, $8, $9)
       returning id`,
      [celebrityId, status, maxDisplay, shoppable, note, evidence, actor.id, actor.role],
    );
    await q(
      `update celebrities
          set rights_status = $3, max_display = $4, shoppable = $5, rights_note = $6, rights_evidence_ref = $7,
              rights_reviewed_by = $8, rights_reviewed_at = now(), updated_at = now()
        where org_id = $1 and id = $2`,
      [celebrityId, status, maxDisplay, shoppable, note, evidence, actor.id],
    );
    if (wasShoppable && !willBeShoppable) {
      pausedInTx = (await lockAndPauseCelebrityLinks(client, orgId, celebrityId, 'rights_review')).tokens;
    }
    await audit(q, actor.id, 'celebrity.rights_review', 'celebrity', celebrityId);
    await outbox(q, 'celebrity.rights_reviewed', {
      org_id: orgId,
      celebrity_id: celebrityId,
      rights_status: status,
      max_display: maxDisplay,
      shoppable,
      reviewed_by: actor.id,
    });
    return (rev.rows[0] as { id: string }).id;
  });

  const after = (await loadCelebrity(orgId, celebrityId)) as CelebrityRow;
  const nowShoppable = effectiveCelebrityRights(after).shoppable;
  let paused = 0;
  let reactivated = 0;
  let invalidation: InvalidationResult | null = null;
  const looks = (await tenantQuery<{ id: string; status: string }>(orgId, `select id, status from looks where org_id = $1 and celebrity_id = $2`, [celebrityId])).rows;
  if (wasShoppable && !nowShoppable) {
    const tokens = pausedInTx;
    paused = tokens.length;
    invalidation = await invalidateAfterCommit(
      { tokens, tags: [`celebrity:${after.slug}`, 'spotted', 'sitemap', ...looks.map((l) => `look:${l.id}`)] },
      log,
    );
  } else if (!wasShoppable && nowShoppable) {
    for (const l of looks.filter((x) => x.status === 'published')) {
      const r = await ensureLookLinks(orgId, l.id, log);
      reactivated += r.reactivated;
    }
    invalidation = await invalidateAfterCommit({ tokens: [], tags: [`celebrity:${after.slug}`, 'spotted', 'sitemap', ...looks.map((l) => `look:${l.id}`)] }, log);
  } else {
    invalidation = await invalidateAfterCommit({ tokens: [], tags: [`celebrity:${after.slug}`, 'spotted', 'sitemap', ...looks.map((l) => `look:${l.id}`)] }, log);
  }
  return { celebrity: after, review_id: reviewId, links_paused: paused, links_reactivated: reactivated, invalidation };
}

/**
 * Edit a celebrity. A new name (or aliases that change who matches) sends
 * the celebrity back to 'unreviewed'; flagging a minor / never-list sends a
 * reviewed celebrity back to 'unreviewed' too (the database refuses any other
 * status for them).
 */
export async function updateCelebrity(
  orgId: string,
  actor: { id: string; role: string },
  celebrityId: string,
  input: { name?: string; aliases?: string[]; is_minor?: boolean; never_list?: boolean },
  log?: { warn: (obj: unknown, msg?: string) => void },
): Promise<CelebrityRow> {
  const before = await loadCelebrity(orgId, celebrityId);
  if (!before) throw new AppError('NOT_FOUND', 'Celebrity not found', 404);
  const name = input.name !== undefined ? input.name.replace(/\s+/g, ' ').trim() : before.name;
  if (name === '' || name.length > 120) throw new AppError('VALIDATION_ERROR', 'name must be 1-120 characters', 400);
  const key = celebrityNameKey(name);
  const renamed = key !== celebrityNameKey(before.name);
  const minor = input.is_minor ?? before.is_minor;
  const never = input.never_list ?? before.never_list;
  const flagged = (minor && !before.is_minor) || (never && !before.never_list);
  const nextAliases = input.aliases ? normaliseAliases(input.aliases) : before.aliases ?? [];
  const beforeKeys = new Set((before.aliases ?? []).map((a) => celebrityNameKey(a)));
  const aliasesAdded = nextAliases.map((a) => celebrityNameKey(a)).filter((k) => k !== '' && !beforeKeys.has(k));
  if (input.is_minor === false && before.is_minor) throw new AppError('FORBIDDEN', 'a minor flag is never removed through the API', 403);
  if (input.never_list === false && before.never_list && actor.role !== RIGHTS_REVIEWER_ROLE) {
    throw new AppError('FORBIDDEN', 'only the rights reviewer takes a celebrity off the never-list', 403);
  }
  // Only a status that allows something goes back (a blocked celebrity stays blocked).
  const reviewed = before.rights_status === 'editorial' || before.rights_status === 'cleared';
  const reset = reviewed && (renamed || flagged || aliasesAdded.length > 0);
  let pausedTokens: string[] = [];
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    if (renamed && (await q<{ id: string }>(`select id from celebrities where org_id = $1 and name_key = $2 and id <> $3`, [key, celebrityId])).rows[0]) {
      throw new AppError('CONFLICT', 'a celebrity with this name already exists', 409);
    }
    const slug = renamed ? await uniqueCelebritySlug(q, name, celebrityId) : before.slug;
    await q(
      `update celebrities
          set name = $3, name_key = $4, slug = $5, aliases = $6, is_minor = $7, never_list = $8, updated_at = now()
              ${reset ? `, rights_status = 'unreviewed', max_display = 'none', shoppable = false` : ''}
        where org_id = $1 and id = $2`,
      [celebrityId, name, key, slug, nextAliases, minor, never],
    );
    if (reset) {
      const kind = renamed || (!flagged && aliasesAdded.length > 0) ? 'rename' : 'minor_flag';
      const note = renamed ? 'renamed: needs a new review' : flagged ? 'flagged minor / never-list' : `alias added (${aliasesAdded.length}): needs a new review`;
      await q(
        `insert into celebrity_rights_reviews
           (org_id, celebrity_id, kind, rights_status, max_display, shoppable, note, reviewed_by, reviewed_role)
         values ($1, $2, $3, 'unreviewed', 'none', false, $4, $5, $6)`,
        [celebrityId, kind, note, actor.id, actor.role],
      );
      if (effectiveCelebrityRights(before).shoppable) pausedTokens = (await lockAndPauseCelebrityLinks(client, orgId, celebrityId, 'rights_review')).tokens;
    }
    await audit(q, actor.id, reset ? 'celebrity.update_reset' : 'celebrity.update', 'celebrity', celebrityId);
  });
  const after = (await loadCelebrity(orgId, celebrityId)) as CelebrityRow;
  if (reset || renamed || aliasesAdded.length > 0) {
    // A new name or alias can also match text elsewhere (a name reaches a page only in its own credit line): every public answer is recomputed.
    const looks = (await tenantQuery<{ id: string }>(orgId, `select id from looks where org_id = $1 and celebrity_id = $2`, [celebrityId])).rows;
    await invalidateAfterCommit({ tokens: pausedTokens, tags: [`celebrity:${before.slug}`, `celebrity:${after.slug}`, 'spotted', 'sitemap', ...looks.map((l) => `look:${l.id}`)] }, log);
  }
  return after;
}

export async function listReviews(orgId: string, celebrityId: string) {
  const rows = (
    await tenantQuery<{
      id: string;
      kind: string;
      rights_status: string;
      max_display: string;
      shoppable: boolean;
      note: string | null;
      evidence_ref: string | null;
      reviewed_by: string;
      reviewed_role: string;
      reviewed_at: string | Date;
    }>(
      orgId,
      `select id, kind, rights_status, max_display, shoppable, note, evidence_ref, reviewed_by, reviewed_role, reviewed_at
         from celebrity_rights_reviews where org_id = $1 and celebrity_id = $2
        order by reviewed_at, id`,
      [celebrityId],
    )
  ).rows;
  return rows.map((r) => ({ ...r, reviewed_at: toIso(r.reviewed_at) }));
}
