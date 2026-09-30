/**
 * Editing a celebrity look: the moment, the outfit piece by piece, the
 * products tagged into each piece (EXACT or SIMILAR), the second person's
 * review of an EXACT tag, publishing and unpublishing, the still's licence
 * metadata and frame screen, and the storefronts. Every write is
 * tenant-scoped and audited.
 *
 * Tagging rules (the migration's CHECKs and partial unique indexes hold the
 * same; they are pre-checked here so the answer is a clear 409 / 422):
 *   - SIMILAR is the default; several per piece, ordered; the product's own
 *     text (the operator's brand / model / category words) may not name the
 *     celebrity or use an endorsement phrase ("worn by", "dupe", "for less",
 *     "X-style", savings claims …);
 *   - EXACT (the same product the celebrity wore): at most one per piece,
 *     only with evidence (what it shows, its source) — else refused — and
 *     'pending' until a DIFFERENT person approves it; a pending EXACT is
 *     never shown and blocks publishing;
 *   - a product once per piece.
 */
import {
  AppError,
  EXACT_EVIDENCE_MIN_CHARS,
  isGarmentCategory,
  isLookDisplayMode,
  isPlaceKind,
  isSlug,
  lookTextFindings,
  productTextRefusals,
  sensitivePlaceFinding,
  similarTextRefusals,
  slugify,
  territoryCovers,
} from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { loadLookBundle, loadLookRow, type LookRow } from './bundle.js';
import { RIGHTS_REVIEWER_ROLE } from './celebrities.js';
import { celebrityNames, describeNames, namesIn } from './names.js';
import { publishGate, type GateReport } from './gate.js';
import { ensureLookLinks, itemIdsOfLooks, pauseItemLinks, type EnsureLinksResult } from './look-links.js';
import { invalidateAfterCommit, lookTags } from './invalidate.js';
import { audit, scoped, withTransaction } from './sql.js';

type Log = { warn: (obj: unknown, msg?: string) => void };
const LOOK_PLATFORMS = ['facebook', 'instagram'];

export interface LookFields {
  title?: string;
  celebrity_id?: string;
  event_name?: string | null;
  place?: string | null;
  place_kind?: string | null;
  moment_date?: string | null;
  property_id?: string | null;
  post_permalink?: string | null;
  platform_post_id?: string | null;
  still_asset_id?: string | null;
  source_video_asset_id?: string | null;
  celebrity_display?: string;
  sponsored?: boolean;
}

/** Field checks shared by create and update (and the library import). */
export function lookFieldProblems(f: LookFields): string[] {
  const out: string[] = [];
  for (const [name, v] of [
    ['event_name', f.event_name],
    ['place', f.place],
  ] as const) {
    if (v === null || v === undefined) continue;
    if (v.length > 120) out.push(`${name} is longer than 120 characters`);
    const words = lookTextFindings(v);
    if (words.length) out.push(`${name}: ${words.join(', ')} (no endorsement wording, no Amazon)`);
    if (sensitivePlaceFinding(v)) out.push(`${name}: a sensitive place (hospital, home, school, place of worship): name the event or a public venue`);
  }
  if (f.place_kind !== undefined && f.place_kind !== null && !isPlaceKind(f.place_kind)) out.push('place_kind is event | venue | airport | street | studio | other');
  if (f.moment_date !== undefined && f.moment_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(f.moment_date)) out.push('moment_date is YYYY-MM-DD');
  if (f.post_permalink !== undefined && f.post_permalink !== null && !/^https:\/\/[^\s/]+\/\S*$/.test(f.post_permalink)) out.push('post_permalink is an https URL');
  if (f.celebrity_display !== undefined && !isLookDisplayMode(f.celebrity_display)) out.push('celebrity_display is name_only | name_and_image');
  if (f.title !== undefined && (f.title.trim() === '' || f.title.length > 200)) out.push('title is 1-200 characters');
  return out;
}

async function assertProperty(orgId: string, propertyId: string): Promise<void> {
  const p = (await tenantQuery<{ platform: string; status: string }>(orgId, `select platform, status from properties where org_id = $1 and id = $2`, [propertyId])).rows[0];
  if (!p) throw new AppError('NOT_FOUND', 'Property not found', 404);
  if (!LOOK_PLATFORMS.includes(p.platform)) throw new AppError('VALIDATION_ERROR', 'a look is published from a Facebook page or an Instagram account', 400);
}

async function assertAsset(orgId: string, assetId: string, kinds: string[]): Promise<void> {
  const a = (await tenantQuery<{ kind: string | null }>(orgId, `select kind from assets where org_id = $1 and id = $2`, [assetId])).rows[0];
  if (!a) throw new AppError('NOT_FOUND', 'Asset not found', 404);
  if (!a.kind || !kinds.includes(a.kind)) throw new AppError('VALIDATION_ERROR', `the asset must be a ${kinds.join(' or ')}`, 400);
}

/**
 * The look's own text never names anyone — not its own celebrity, not
 * another one (the name reaches a page only in the credit line of that
 * person's own look, beside the non-endorsement line).
 */
export async function textNameProblems(orgId: string, fields: Array<[string, string | null | undefined]>): Promise<string[]> {
  const present = fields.filter(([, v]) => v !== null && v !== undefined && v.trim() !== '');
  if (present.length === 0) return [];
  const names = await celebrityNames(orgId);
  const out: string[] = [];
  for (const [field, v] of present) {
    const found = namesIn([v], names);
    if (found.length) out.push(`${field} names a celebrity (${describeNames(found)}): a name appears only in the credit line of that person's own look`);
  }
  return out;
}

export async function createLook(orgId: string, actorId: string, f: LookFields & { celebrity_id: string }): Promise<string> {
  const problems = [...lookFieldProblems(f), ...(await textNameProblems(orgId, [['event_name', f.event_name], ['place', f.place]]))];
  if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('; '), 400);
  const c = (await tenantQuery<{ id: string }>(orgId, `select id from celebrities where org_id = $1 and id = $2`, [f.celebrity_id])).rows[0];
  if (!c) throw new AppError('NOT_FOUND', 'Celebrity not found', 404);
  if (f.property_id) await assertProperty(orgId, f.property_id);
  if (f.still_asset_id) await assertAsset(orgId, f.still_asset_id, ['still', 'cover']);
  if (f.source_video_asset_id) await assertAsset(orgId, f.source_video_asset_id, ['video']);
  const title = f.title?.trim() || [f.event_name, f.moment_date].filter(Boolean).join(' ') || 'Untitled look';
  return withTransaction(async (client) => {
    const q = scoped(client, orgId);
    const res = await q<{ id: string }>(
      `insert into looks (org_id, title, locale, status, celebrity_id, event_name, place, place_kind, moment_date,
                          property_id, post_permalink, platform_post_id, still_asset_id, source_video_asset_id,
                          celebrity_display, sponsored, updated_at)
       values ($1, $2, 'en-IN', 'draft', $3, $4, $5, $6, $7::date, $8, $9, $10, $11, $12, $13, $14, now())
       returning id`,
      [
        title,
        f.celebrity_id,
        f.event_name ?? null,
        f.place ?? null,
        f.place_kind ?? null,
        f.moment_date ?? null,
        f.property_id ?? null,
        f.post_permalink ?? null,
        f.platform_post_id ?? null,
        f.still_asset_id ?? null,
        f.source_video_asset_id ?? null,
        f.celebrity_display ?? 'name_only',
        f.sponsored === true,
      ],
    );
    const id = (res.rows[0] as { id: string }).id;
    await audit(q, actorId, 'look.create', 'look', id);
    return id;
  });
}

const EDITABLE: Array<keyof LookFields> = [
  'title',
  'event_name',
  'place',
  'place_kind',
  'moment_date',
  'property_id',
  'post_permalink',
  'platform_post_id',
  'still_asset_id',
  'source_video_asset_id',
  'celebrity_display',
  'sponsored',
];

/**
 * Edit a look's moment. Only while the look is not published (unpublish
 * first: the gate runs again on publish); a withdrawn look is changed only
 * through its takedown. The celebrity is fixed once created.
 */
export async function updateLook(orgId: string, actorId: string, lookId: string, f: LookFields): Promise<void> {
  const look = await loadLookRow(orgId, lookId);
  if (!look) throw new AppError('NOT_FOUND', 'Look not found', 404);
  if (look.status === 'published') throw new AppError('CONFLICT', 'unpublish the look before changing it', 409);
  if (look.status === 'withdrawn' || look.takedown_id) throw new AppError('GONE', 'the look was withdrawn (takedown)', 410);
  if (f.celebrity_id !== undefined && f.celebrity_id !== look.celebrity_id) throw new AppError('VALIDATION_ERROR', 'the celebrity of a look is fixed; create a new look', 400);
  const problems = [...lookFieldProblems(f), ...(await textNameProblems(orgId, [['event_name', f.event_name], ['place', f.place]]))];
  if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('; '), 400);
  if (f.property_id) await assertProperty(orgId, f.property_id);
  if (f.still_asset_id) await assertAsset(orgId, f.still_asset_id, ['still', 'cover']);
  if (f.source_video_asset_id) await assertAsset(orgId, f.source_video_asset_id, ['video']);
  const sets: string[] = [];
  const params: unknown[] = [lookId];
  for (const k of EDITABLE) {
    if (f[k] === undefined) continue;
    params.push(k === 'title' ? String(f[k]).trim() : f[k]);
    sets.push(`${k} = $${params.length + 1}${k === 'moment_date' ? '::date' : ''}`);
  }
  if (sets.length === 0) return;
  // The rights reviewer confirmed a street / other place as it was: any change to it needs a new confirmation.
  const placeChanged =
    (f.event_name !== undefined && f.event_name !== look.event_name) ||
    (f.place !== undefined && f.place !== look.place) ||
    (f.place_kind !== undefined && f.place_kind !== look.place_kind);
  if (placeChanged) sets.push('place_confirmed_by = null', 'place_confirmed_at = null', 'place_confirmed_note = null');
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    await q(`update looks set ${sets.join(', ')}, updated_at = now() where org_id = $1 and id = $2`, params);
    await audit(q, actorId, 'look.update', 'look', lookId);
  });
}

/**
 * The rights reviewer's confirmation that a 'street' or 'other' place is a
 * public place (never a residence, clinic, school or place of worship):
 * without it such a look is not published (the gate's place_kind check).
 */
export async function confirmPlace(orgId: string, actor: { id: string; role: string }, lookId: string, note: string): Promise<void> {
  if (actor.role !== RIGHTS_REVIEWER_ROLE) throw new AppError('FORBIDDEN', "only the rights reviewer confirms a street or other place", 403);
  if (!note || note.trim().length < 3) throw new AppError('VALIDATION_ERROR', 'a confirmation needs a note (what the place is)', 400);
  const look = await loadLookRow(orgId, lookId);
  if (!look || !look.celebrity_id) throw new AppError('NOT_FOUND', 'Look not found', 404);
  if (look.status === 'withdrawn' || look.takedown_id) throw new AppError('GONE', 'the look was withdrawn (takedown)', 410);
  if (!look.place_kind) throw new AppError('VALIDATION_ERROR', 'the look names no kind of place yet', 400);
  if (sensitivePlaceFinding(look.place) || sensitivePlaceFinding(look.event_name)) {
    throw new AppError('VALIDATION_ERROR', 'the place reads as a sensitive place (hospital, home, school, place of worship)', 400);
  }
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    await q(
      `update looks set place_confirmed_by = $3, place_confirmed_at = now(), place_confirmed_note = $4, updated_at = now() where org_id = $1 and id = $2`,
      [lookId, actor.id, note.trim().slice(0, 300)],
    );
    await audit(q, actor.id, 'look.place_confirmed', 'look', lookId);
  });
}

export type TransitionTarget = 'draft' | 'in_review' | 'ready' | 'published' | 'paused';

export interface TransitionResult {
  status: string;
  gate: GateReport | null;
  links: EnsureLinksResult | null;
  links_paused: number;
}

const ALLOWED_FROM: Record<TransitionTarget, string[]> = {
  draft: ['in_review', 'ready', 'paused'],
  in_review: ['draft', 'ready', 'paused'],
  ready: ['draft', 'in_review', 'paused'],
  published: ['draft', 'in_review', 'ready', 'paused'],
  paused: ['published'],
};

/**
 * Publish (the gate: 409 with the report when any check fails; then the
 * look's own links are minted) or unpublish (its links pause at once and the
 * caches are cleared). 'withdrawn' is reached only by a takedown.
 */
export async function transitionLook(orgId: string, actorId: string, lookId: string, to: TransitionTarget, log?: Log): Promise<TransitionResult> {
  const b = await loadLookBundle(orgId, lookId);
  if (!b) throw new AppError('NOT_FOUND', 'Look not found', 404);
  if (b.look.status === 'withdrawn' || b.look.takedown_id) throw new AppError('GONE', 'the look was withdrawn (takedown); a restore brings it back', 410);
  if (b.look.status === to) return { status: to, gate: null, links: null, links_paused: 0 };
  if (!ALLOWED_FROM[to].includes(b.look.status)) {
    throw new AppError('CONFLICT', `a '${b.look.status}' look cannot go to '${to}'`, 409);
  }
  let gate: GateReport | null = null;
  if (to === 'published') {
    gate = await publishGate(orgId, b);
    if (!gate.ok) {
      const failing = gate.checks.filter((c) => !c.ok);
      const err = new AppError(
        'CONFLICT',
        `publish refused: ${failing.map((c) => `${c.code}${c.detail ? ` (${c.detail})` : ''}`).join('; ')}`,
        409,
      ) as AppError & { gate?: GateReport };
      err.gate = gate;
      throw err;
    }
  }
  const moved = await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    const res = await q<{ id: string }>(
      `update looks set status = $3, updated_at = now()${to === 'published' ? ', published_at = coalesce(published_at, now())' : ''}
        where org_id = $1 and id = $2 and status = $4 and takedown_id is null
        returning id`,
      [lookId, to, b.look.status],
    );
    if (res.rows.length === 0) return false;
    await audit(q, actorId, to === 'published' ? 'look.publish' : `look.${to}`, 'look', lookId);
    return true;
  });
  if (!moved) throw new AppError('CONFLICT', 'the look changed meanwhile; reload it', 409);
  const tags = lookTags({ id: lookId, celebrity_slug: b.celebrity?.slug, storefront_slug: b.storefront?.slug });
  if (to === 'published') {
    const links = await ensureLookLinks(orgId, lookId, log);
    await invalidateAfterCommit({ tokens: [], tags }, log);
    return { status: to, gate, links, links_paused: 0 };
  }
  let paused = 0;
  if (b.look.status === 'published') {
    const tokens = await pauseItemLinks(orgId, await itemIdsOfLooks(orgId, [lookId]), 'look_unpublished');
    paused = tokens.length;
    await invalidateAfterCommit({ tokens, tags }, log);
  }
  return { status: to, gate: null, links: null, links_paused: paused };
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

export interface PieceFields {
  label?: string;
  garment_category?: string;
  position?: number;
  hotspot?: { x: number; y: number } | null;
}

function pieceProblems(f: PieceFields): string[] {
  const out: string[] = [];
  if (f.label !== undefined) {
    const l = f.label.trim();
    if (l === '' || l.length > 60) out.push('label is 1-60 characters');
    const words = lookTextFindings(l);
    if (words.length) out.push(`label: ${words.join(', ')}`);
  }
  if (f.garment_category !== undefined && !isGarmentCategory(f.garment_category)) out.push('garment_category is not in the list');
  if (f.position !== undefined && (!Number.isInteger(f.position) || f.position < 0 || f.position > 1000)) out.push('position is 0-1000');
  if (f.hotspot) {
    for (const v of [f.hotspot.x, f.hotspot.y]) if (typeof v !== 'number' || !(v >= 0 && v <= 1)) out.push('hotspot x and y are 0..1');
  }
  return out;
}

async function editableLookOf(orgId: string, lookId: string): Promise<LookRow> {
  const look = await loadLookRow(orgId, lookId);
  if (!look) throw new AppError('NOT_FOUND', 'Look not found', 404);
  if (look.status === 'withdrawn' || look.takedown_id) throw new AppError('GONE', 'the look was withdrawn (takedown)', 410);
  if (!look.celebrity_id) throw new AppError('VALIDATION_ERROR', 'pieces belong to celebrity looks', 400);
  return look;
}

export async function addPiece(orgId: string, actorId: string, lookId: string, f: PieceFields & { label: string; garment_category: string }): Promise<string> {
  const look = await editableLookOf(orgId, lookId);
  if (look.status === 'published') throw new AppError('CONFLICT', 'unpublish the look to change its pieces', 409);
  const problems = [...pieceProblems(f), ...(await textNameProblems(orgId, [['label', f.label]]))];
  if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('; '), 400);
  return withTransaction(async (client) => {
    const q = scoped(client, orgId);
    let position = f.position;
    if (position === undefined) {
      const max = (await q<{ m: number | null }>(`select max(position) as m from look_pieces where org_id = $1 and look_id = $2 and removed_at is null`, [lookId])).rows[0];
      position = max?.m === null || max?.m === undefined ? 0 : Number(max.m) + 1;
    }
    const res = await q<{ id: string }>(
      `insert into look_pieces (org_id, look_id, label, garment_category, position, hotspot_x, hotspot_y)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [lookId, f.label.trim(), f.garment_category, position, f.hotspot ? round4(f.hotspot.x) : null, f.hotspot ? round4(f.hotspot.y) : null],
    );
    const id = (res.rows[0] as { id: string }).id;
    await audit(q, actorId, 'piece.create', 'look_piece', id);
    return id;
  });
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

async function pieceRow(orgId: string, pieceId: string) {
  const p = (
    await tenantQuery<{ id: string; look_id: string; removed_at: unknown }>(
      orgId,
      `select id, look_id, removed_at from look_pieces where org_id = $1 and id = $2`,
      [pieceId],
    )
  ).rows[0];
  if (!p || p.removed_at) throw new AppError('NOT_FOUND', 'Piece not found', 404);
  return p;
}

export async function updatePiece(orgId: string, actorId: string, pieceId: string, f: PieceFields): Promise<void> {
  const p = await pieceRow(orgId, pieceId);
  const look = await editableLookOf(orgId, p.look_id);
  // Hotspot and order may change on a published look (they point at the piece, never at a product).
  if (look.status === 'published' && (f.label !== undefined || f.garment_category !== undefined)) {
    throw new AppError('CONFLICT', "unpublish the look to change a piece's label or category", 409);
  }
  const problems = [...pieceProblems(f), ...(await textNameProblems(orgId, [['label', f.label]]))];
  if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('; '), 400);
  const sets: string[] = [];
  const params: unknown[] = [pieceId];
  const push = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length + 1}`);
  };
  if (f.label !== undefined) push('label', f.label.trim());
  if (f.garment_category !== undefined) push('garment_category', f.garment_category);
  if (f.position !== undefined) push('position', f.position);
  if (f.hotspot !== undefined) {
    push('hotspot_x', f.hotspot ? round4(f.hotspot.x) : null);
    push('hotspot_y', f.hotspot ? round4(f.hotspot.y) : null);
  }
  if (sets.length === 0) return;
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    await q(`update look_pieces set ${sets.join(', ')}, updated_at = now() where org_id = $1 and id = $2`, params);
    await audit(q, actorId, 'piece.update', 'look_piece', pieceId);
  });
}

export async function removePiece(orgId: string, actorId: string, pieceId: string, log?: Log): Promise<{ items_removed: number; links_paused: number }> {
  const p = await pieceRow(orgId, pieceId);
  const look = await editableLookOf(orgId, p.look_id);
  if (look.status === 'published') throw new AppError('CONFLICT', 'unpublish the look to remove a piece', 409);
  const itemIds = (await tenantQuery<{ id: string }>(orgId, `select id from look_items where org_id = $1 and piece_id = $2 and removed_at is null`, [pieceId])).rows.map((r) => r.id);
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    await q(`update look_pieces set removed_at = now(), updated_at = now() where org_id = $1 and id = $2`, [pieceId]);
    await q(`update look_items set removed_at = now(), updated_at = now() where org_id = $1 and piece_id = $2 and removed_at is null`, [pieceId]);
    await audit(q, actorId, 'piece.remove', 'look_piece', pieceId);
  });
  const tokens = await pauseItemLinks(orgId, itemIds, 'item_removed');
  if (tokens.length) await invalidateAfterCommit({ tokens, tags: lookTags({ id: p.look_id }) }, log);
  return { items_removed: itemIds.length, links_paused: tokens.length };
}

// ---------------------------------------------------------------------------
// Tagging
// ---------------------------------------------------------------------------

export interface TagInput {
  variant_id?: string;
  offer_id?: string;
  match_type?: 'exact' | 'similar';
  evidence?: string | null;
  evidence_source?: string | null;
  evidence_captured_at?: string | null;
  position?: number;
}

export interface TagResult {
  item_id: string;
  match_type: 'exact' | 'similar';
  review_state: 'pending' | 'approved';
  links: EnsureLinksResult | null;
}

async function celebrityNamesOfLook(orgId: string, lookId: string): Promise<string[]> {
  const r = (
    await tenantQuery<{ name: string; aliases: string[] | null }>(
      orgId,
      `select c.name, c.aliases from looks l join celebrities c on c.id = l.celebrity_id and c.org_id = $1
        where l.org_id = $1 and l.id = $2`,
      [lookId],
    )
  ).rows[0];
  return r ? [r.name, ...(r.aliases ?? [])] : [];
}

/** The product text of a variant (the operator's own words). */
async function productText(orgId: string, variantId: string): Promise<{ brand: string; model: string; category: string } | null> {
  return (
    (
      await tenantQuery<{ brand: string; model: string; category: string }>(
        orgId,
        `select p.brand, p.model, p.category from variants v join products p on p.id = v.product_id and p.org_id = $1
          where v.org_id = $1 and v.id = $2`,
        [variantId],
      )
    ).rows[0] ?? null
  );
}

/**
 * Why a product's own text may not be tagged into this look (empty = it
 * may): whatever the match, no endorsement phrase and no celebrity of the
 * organisation named (@paparazzi/shared productTextRefusals); for SIMILAR
 * also not the look's own celebrity (by name or alias).
 */
export async function productRefusals(orgId: string, lookId: string, match: 'exact' | 'similar', text: { brand: string; model: string; category: string }): Promise<string[]> {
  const fields = [text.brand, text.model, text.category];
  const out = new Set(productTextRefusals(fields, await celebrityNames(orgId)));
  if (match === 'similar') for (const r of similarTextRefusals(fields, await celebrityNamesOfLook(orgId, lookId))) out.add(r);
  return [...out];
}

export function evidenceProblems(match: 'exact' | 'similar', evidence: string | null | undefined, source: string | null | undefined): string[] {
  if (match !== 'exact') return [];
  const out: string[] = [];
  if (!evidence || evidence.trim().length < EXACT_EVIDENCE_MIN_CHARS) out.push(`an EXACT tag needs evidence: what it shows, at least ${EXACT_EVIDENCE_MIN_CHARS} characters`);
  if (!source || source.trim().length < 3) out.push('an EXACT tag needs the evidence source (a URL or a file reference)');
  return out;
}

export async function tagPieceItem(orgId: string, actorId: string, pieceId: string, input: TagInput, log?: Log): Promise<TagResult> {
  const piece = await pieceRow(orgId, pieceId);
  const look = await editableLookOf(orgId, piece.look_id);
  const match = input.match_type ?? 'similar';
  let variantId = input.variant_id ?? null;
  if (input.offer_id) {
    const o = (await tenantQuery<{ variant_id: string }>(orgId, `select variant_id from offers where org_id = $1 and id = $2`, [input.offer_id])).rows[0];
    if (!o) throw new AppError('NOT_FOUND', 'Offer not found', 404);
    if (variantId && variantId !== o.variant_id) throw new AppError('VALIDATION_ERROR', 'offer_id and variant_id name different products', 400);
    variantId = o.variant_id;
  }
  if (!variantId) throw new AppError('VALIDATION_ERROR', 'variant_id or offer_id is required', 400);
  const text = await productText(orgId, variantId);
  if (!text) throw new AppError('NOT_FOUND', 'Variant not found', 404);
  const problems = evidenceProblems(match, input.evidence, input.evidence_source);
  if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('; '), 422);
  const refusals = await productRefusals(orgId, look.id, match, text);
  if (refusals.length) {
    throw new AppError(
      'VALIDATION_ERROR',
      match === 'similar'
        ? `a SIMILAR product's text may not say or imply the celebrity wore, owns, chose or recommends it, or name anyone: ${refusals.join(', ')}`
        : `a product's text never names a celebrity or uses an endorsement phrase: ${refusals.join(', ')}`,
      422,
    );
  }
  const id = await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    const same = (await q<{ id: string }>(`select id from look_items where org_id = $1 and piece_id = $2 and variant_id = $3 and removed_at is null`, [pieceId, variantId])).rows[0];
    if (same) throw new AppError('CONFLICT', 'this product is already tagged into the piece', 409);
    if (match === 'exact') {
      const ex = (await q<{ id: string }>(`select id from look_items where org_id = $1 and piece_id = $2 and match_type = 'exact' and removed_at is null`, [pieceId])).rows[0];
      if (ex) throw new AppError('CONFLICT', 'the piece already has its EXACT product (at most one per piece)', 409);
    }
    let position = input.position;
    if (position === undefined) {
      const max = (await q<{ m: number | null }>(`select max(position) as m from look_items where org_id = $1 and piece_id = $2 and removed_at is null`, [pieceId])).rows[0];
      position = match === 'exact' ? 0 : max?.m === null || max?.m === undefined ? 1 : Number(max.m) + 1;
    }
    const res = await q<{ id: string }>(
      `insert into look_items (org_id, look_id, asset_id, variant_id, match_type, evidence, evidence_source, evidence_captured_at,
                               piece_id, position, review_state, tagged_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11, $12, now())
       returning id`,
      [
        look.id,
        look.still_asset_id,
        variantId,
        match,
        match === 'exact' ? (input.evidence as string).trim() : input.evidence?.trim() || null,
        match === 'exact' ? (input.evidence_source as string).trim() : input.evidence_source?.trim() || null,
        input.evidence_captured_at ?? null,
        pieceId,
        position,
        match === 'exact' ? 'pending' : 'approved',
        actorId,
      ],
    );
    const itemId = (res.rows[0] as { id: string }).id;
    await audit(q, actorId, match === 'exact' ? 'look_item.tag_exact' : 'look_item.tag_similar', 'look_item', itemId);
    return itemId;
  });
  const links = match === 'similar' && look.status === 'published' ? await ensureLookLinks(orgId, look.id, log) : null;
  return { item_id: id, match_type: match, review_state: match === 'exact' ? 'pending' : 'approved', links };
}

/**
 * The second person's decision on an EXACT tag: approve (a reviewer other
 * than the tagger: 403 otherwise), downgrade to SIMILAR (the product text
 * checks apply), or reject (the item is removed).
 */
export async function reviewLookItem(
  orgId: string,
  actorId: string,
  itemId: string,
  decision: 'approve' | 'downgrade' | 'reject',
  log?: Log,
): Promise<{ item_id: string; match_type: string; review_state: string | null; removed: boolean; links: EnsureLinksResult | null }> {
  const it = (
    await tenantQuery<{ id: string; look_id: string; piece_id: string | null; match_type: string; review_state: string | null; tagged_by: string | null; variant_id: string; removed_at: unknown }>(
      orgId,
      `select id, look_id, piece_id, match_type, review_state, tagged_by, variant_id, removed_at from look_items where org_id = $1 and id = $2`,
      [itemId],
    )
  ).rows[0];
  if (!it || it.removed_at || !it.piece_id) throw new AppError('NOT_FOUND', 'Look item not found', 404);
  const look = await editableLookOf(orgId, it.look_id);
  if (it.match_type !== 'exact' || it.review_state !== 'pending') throw new AppError('CONFLICT', 'only a pending EXACT tag is reviewed', 409);
  if (decision === 'reject') {
    await removeLookItem(orgId, actorId, itemId, log);
    return { item_id: itemId, match_type: it.match_type, review_state: it.review_state, removed: true, links: null };
  }
  if (decision === 'approve') {
    if (it.tagged_by === actorId) throw new AppError('FORBIDDEN', 'the person who tagged an EXACT product cannot approve it (maker-checker)', 403);
    await withTransaction(async (client) => {
      const q = scoped(client, orgId);
      await q(
        `update look_items set review_state = 'approved', match_reviewed_by = $3, match_reviewed_at = now(), updated_at = now()
          where org_id = $1 and id = $2 and review_state = 'pending'`,
        [itemId, actorId],
      );
      await audit(q, actorId, 'look_item.exact_approve', 'look_item', itemId);
    });
  } else {
    const text = await productText(orgId, it.variant_id);
    const refusals = text ? await productRefusals(orgId, look.id, 'similar', text) : ['no_product'];
    if (refusals.length) throw new AppError('VALIDATION_ERROR', `the product text cannot be a SIMILAR item: ${refusals.join(', ')}`, 422);
    await withTransaction(async (client) => {
      const q = scoped(client, orgId);
      await q(
        `update look_items set match_type = 'similar', review_state = 'approved', match_reviewed_by = $3, match_reviewed_at = now(), updated_at = now()
          where org_id = $1 and id = $2`,
        [itemId, actorId],
      );
      await audit(q, actorId, 'look_item.exact_downgrade', 'look_item', itemId);
    });
  }
  const links = look.status === 'published' ? await ensureLookLinks(orgId, look.id, log) : null;
  return { item_id: itemId, match_type: decision === 'approve' ? 'exact' : 'similar', review_state: 'approved', removed: false, links };
}

export async function removeLookItem(orgId: string, actorId: string, itemId: string, log?: Log): Promise<{ links_paused: number }> {
  const it = (await tenantQuery<{ id: string; look_id: string; removed_at: unknown }>(orgId, `select id, look_id, removed_at from look_items where org_id = $1 and id = $2`, [itemId])).rows[0];
  if (!it || it.removed_at) throw new AppError('NOT_FOUND', 'Look item not found', 404);
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    await q(`update look_items set removed_at = now(), updated_at = now() where org_id = $1 and id = $2`, [itemId]);
    await audit(q, actorId, 'look_item.remove', 'look_item', itemId);
  });
  const tokens = await pauseItemLinks(orgId, [itemId], 'item_removed');
  if (tokens.length) await invalidateAfterCommit({ tokens, tags: lookTags({ id: it.look_id }) }, log);
  return { links_paused: tokens.length };
}

// ---------------------------------------------------------------------------
// Assets: licence metadata and the frame screen
// ---------------------------------------------------------------------------

export interface AssetFields {
  public_url?: string | null;
  license?: string;
  commercial_reuse?: 'yes' | 'no' | 'unknown';
  territory?: string | null;
  expires_at?: string | null;
  source_ref?: string | null;
  copyright_owner?: string | null;
  author?: string | null;
  acquisition?: string | null;
  assignment_ref?: string | null;
  live_performance?: boolean;
  minor_in_frame?: boolean;
  bystanders?: boolean;
  sensitive_location?: boolean;
  screen_status?: 'unscreened' | 'passed' | 'rejected';
}

/**
 * True when a territory change widens what may be shown: afflino.com shows
 * images in India only (DISPLAY_TERRITORY), so a change that makes India
 * covered where it was not ("AE" → "IN", anything → "WW").
 */
export function territoryWidens(prev: string | null | undefined, next: string | null | undefined): boolean {
  return territoryCovers(next) && !territoryCovers(prev);
}

interface AssetNow {
  id: string;
  public_url: string | null;
  license: string | null;
  commercial_reuse: string;
  territory: string | null;
  expires_at: string | Date | null;
  copyright_owner: string | null;
  acquisition: string | null;
  assignment_ref: string | null;
  live_performance: boolean;
  minor_in_frame: boolean;
  bystanders: boolean;
  sensitive_location: boolean;
}

/**
 * Which of the requested changes would widen what may be shown (the rights
 * reviewer's alone): commercial reuse turned to 'yes', a territory that
 * covers more, a licence that ends later or never, a live performance
 * cleared, the licence text or the chain of title (copyright owner,
 * acquisition, assignment) recorded or changed. Clearing a chain-of-title
 * field only narrows (the image is hidden), so anyone may.
 */
export function assetWidenings(cur: AssetNow, f: AssetFields): string[] {
  const out: string[] = [];
  if (f.commercial_reuse !== undefined && f.commercial_reuse === 'yes' && cur.commercial_reuse !== 'yes') out.push('commercial_reuse');
  if (f.territory !== undefined && territoryWidens(cur.territory, f.territory)) out.push('territory');
  if (f.expires_at !== undefined) {
    const was = cur.expires_at === null ? null : new Date(cur.expires_at).getTime();
    const next = f.expires_at === null ? null : Date.parse(f.expires_at);
    if (was !== null && (next === null || next > was)) out.push('expires_at');
  }
  if (f.live_performance === false && cur.live_performance) out.push('live_performance');
  if (f.license !== undefined && f.license.trim() !== (cur.license ?? '').trim()) out.push('license');
  for (const k of ['copyright_owner', 'acquisition', 'assignment_ref'] as const) {
    const v = f[k];
    if (v === undefined || v === null || v.trim() === '') continue;
    if (v.trim() !== (cur[k] ?? '').trim()) out.push(k);
  }
  return out;
}

/**
 * Licence metadata and the editor's frame screen ('passed' = no voyeuristic,
 * body-zoom or wardrobe-malfunction framing, garments visible without a
 * sexualised crop; 'rejected' = never shown).
 *   - Anything that widens what may be shown (assetWidenings) is the rights
 *     reviewer's alone (403 for anyone else), with its own audit row;
 *     narrowing is anyone's.
 *   - minor_in_frame, bystanders and sensitive_location are one-way: they
 *     are set, never cleared through the API (403; a frame flagged by
 *     mistake is replaced by another still) — like a celebrity's minor flag.
 *   - A new public_url is a new image: its frame screen starts again
 *     ('unscreened') unless the same request records the screen.
 *   - A change to the licence facts marks them a person's (licence_via =
 *     'review'): a later library import never widens them.
 * The look caches are cleared either way.
 */
export async function updateAsset(orgId: string, actor: { id: string; role: string }, assetId: string, f: AssetFields, log?: Log): Promise<{ widened: string[] }> {
  const actorId = actor.id;
  const cur = (
    await tenantQuery<AssetNow>(
      orgId,
      `select id, public_url, license, commercial_reuse, territory, expires_at, copyright_owner, acquisition, assignment_ref,
              live_performance, minor_in_frame, bystanders, sensitive_location
         from assets where org_id = $1 and id = $2`,
      [assetId],
    )
  ).rows[0];
  if (!cur) throw new AppError('NOT_FOUND', 'Asset not found', 404);
  const problems: string[] = [];
  if (f.public_url !== undefined && f.public_url !== null && !/^https:\/\/[^\s/]+\/\S*$/.test(f.public_url)) problems.push('public_url is an https URL');
  if (f.license !== undefined && (f.license.trim() === '' || f.license.length > 200)) problems.push('license is 1-200 characters');
  if (f.expires_at !== undefined && f.expires_at !== null && Number.isNaN(Date.parse(f.expires_at))) problems.push('expires_at is an ISO date or time');
  if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('; '), 400);
  for (const k of ['minor_in_frame', 'bystanders', 'sensitive_location'] as const) {
    if (f[k] === false && cur[k]) throw new AppError('FORBIDDEN', `${k} is never cleared through the API (use another still)`, 403);
  }
  const widened = assetWidenings(cur, f);
  if (widened.length && actor.role !== RIGHTS_REVIEWER_ROLE) {
    throw new AppError('FORBIDDEN', `only the rights reviewer widens what may be shown (${widened.join(', ')})`, 403);
  }
  const cols: Array<keyof AssetFields> = [
    'public_url',
    'license',
    'commercial_reuse',
    'territory',
    'expires_at',
    'source_ref',
    'copyright_owner',
    'author',
    'acquisition',
    'assignment_ref',
    'live_performance',
    'minor_in_frame',
    'bystanders',
    'sensitive_location',
    'screen_status',
  ];
  const sets: string[] = [];
  const params: unknown[] = [assetId];
  for (const k of cols) {
    if (f[k] === undefined) continue;
    params.push(f[k]);
    sets.push(`${k} = $${params.length + 1}${k === 'expires_at' ? '::timestamptz' : ''}`);
  }
  // A person recorded these licence facts: a later library import narrows them, never widens them.
  if ((['license', 'commercial_reuse', 'territory', 'expires_at', 'source_ref', 'copyright_owner', 'author', 'acquisition', 'assignment_ref', 'live_performance'] as const).some((k) => f[k] !== undefined)) {
    sets.push(`licence_via = 'review'`);
  }
  const newImage = f.public_url !== undefined && (f.public_url ?? null) !== (cur.public_url ?? null);
  if (f.screen_status !== undefined) {
    params.push(actorId);
    sets.push(`screened_by = $${params.length + 1}`, 'screened_at = now()');
  } else if (newImage) {
    // Another image: the frame screen starts again (the library import's rule).
    sets.push(`screen_status = 'unscreened'`, 'screened_by = null', 'screened_at = null');
  }
  if (sets.length === 0) return { widened: [] };
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    await q(`update assets set ${sets.join(', ')}, updated_at = now() where org_id = $1 and id = $2`, params);
    await audit(q, actorId, f.screen_status !== undefined ? 'asset.screen' : 'asset.licence_update', 'asset', assetId);
    if (widened.length) await audit(q, actorId, `asset.widen:${widened.join(',')}`.slice(0, 200), 'asset', assetId);
  });
  const looks = (await tenantQuery<{ id: string }>(orgId, `select id from looks where org_id = $1 and still_asset_id = $2`, [assetId])).rows;
  await invalidateAfterCommit({ tokens: [], tags: looks.flatMap((l) => lookTags({ id: l.id })) }, log);
  return { widened };
}

// ---------------------------------------------------------------------------
// Storefronts
// ---------------------------------------------------------------------------

export async function upsertStorefront(
  orgId: string,
  actorId: string,
  input: { id?: string; property_id?: string; slug?: string; display_name?: string; bio?: string | null; status?: 'draft' | 'live' | 'hidden' },
  log?: Log,
): Promise<string> {
  const problems: string[] = [];
  if (input.slug !== undefined && !isSlug(input.slug)) problems.push('slug is lower-case letters and digits joined by hyphens, at most 80');
  if (input.display_name !== undefined && (input.display_name.trim() === '' || input.display_name.length > 80)) problems.push('display_name is 1-80 characters');
  if (input.bio !== undefined && input.bio !== null && input.bio.length > 300) problems.push('bio is at most 300 characters');
  for (const t of [input.display_name, input.bio]) {
    const f = lookTextFindings(t ?? null);
    if (f.length) problems.push(`storefront text: ${f.join(', ')}`);
  }
  if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('; '), 400);
  // A storefront is the in-house page's own, never a celebrity page: its slug, name and bio name nobody.
  const names = await celebrityNames(orgId);
  const naming = (fields: Array<[string, string | null | undefined]>) => {
    const out: string[] = [];
    for (const [field, v] of fields) {
      const found = namesIn([v], names);
      if (found.length) out.push(`the storefront's ${field} names a celebrity (${describeNames(found)}); give the page a name of its own`);
    }
    return out;
  };
  const given = naming([
    ['slug', input.slug],
    ['name', input.display_name],
    ['bio', input.bio],
  ]);
  if (given.length) throw new AppError('VALIDATION_ERROR', given.join('; '), 422);
  let oldSlug: string | null = null;
  const id = await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    if (input.slug) {
      const taken = (await q<{ id: string }>(`select id from storefronts where org_id = $1 and slug = $2`, [input.slug])).rows[0];
      if (taken && taken.id !== input.id) throw new AppError('CONFLICT', 'the slug is taken', 409);
    }
    if (input.id) {
      const cur = (await q<{ id: string; slug: string; display_name: string; bio: string | null }>(`select id, slug, display_name, bio from storefronts where org_id = $1 and id = $2`, [input.id])).rows[0];
      if (!cur) throw new AppError('NOT_FOUND', 'Storefront not found', 404);
      oldSlug = cur.slug;
      if (input.status === 'live') {
        const now = naming([
          ['slug', input.slug ?? cur.slug],
          ['name', input.display_name ?? cur.display_name],
          ['bio', input.bio === undefined ? cur.bio : input.bio],
        ]);
        if (now.length) throw new AppError('VALIDATION_ERROR', `not made live: ${now.join('; ')}`, 422);
      }
      const sets: string[] = [];
      const params: unknown[] = [input.id];
      for (const k of ['slug', 'display_name', 'bio', 'status'] as const) {
        if (input[k] === undefined) continue;
        params.push(k === 'display_name' ? (input[k] as string).trim() : input[k]);
        sets.push(`${k} = $${params.length + 1}`);
      }
      if (sets.length) await q(`update storefronts set ${sets.join(', ')}, updated_at = now() where org_id = $1 and id = $2`, params);
      await audit(q, actorId, 'storefront.update', 'storefront', input.id);
      return input.id;
    }
    if (!input.property_id) throw new AppError('VALIDATION_ERROR', 'property_id is required for a new storefront', 400);
    const p = (await q<{ platform: string; external_account_id: string; status: string }>(`select platform, external_account_id, status from properties where org_id = $1 and id = $2`, [input.property_id])).rows[0];
    if (!p) throw new AppError('NOT_FOUND', 'Property not found', 404);
    if (!LOOK_PLATFORMS.includes(p.platform)) throw new AppError('VALIDATION_ERROR', 'storefronts are for the in-house Facebook pages and Instagram accounts', 400);
    if ((await q<{ id: string }>(`select id from storefronts where org_id = $1 and property_id = $2`, [input.property_id])).rows[0]) {
      throw new AppError('CONFLICT', 'this page already has a storefront', 409);
    }
    let slug = input.slug ?? null;
    if (slug) {
      if ((await q<{ id: string }>(`select id from storefronts where org_id = $1 and slug = $2`, [slug])).rows[0]) throw new AppError('CONFLICT', `the slug '${slug}' is taken`, 409);
    } else {
      // The handle (a Facebook page ID becomes fb-<id>); on a clash the platform, then a number.
      const base = slugify(p.platform === 'facebook' && /^\d+$/.test(p.external_account_id) ? `fb-${p.external_account_id}` : p.external_account_id) || 'page';
      const candidates = [base, `${base}-${p.platform === 'facebook' ? 'fb' : 'ig'}`, ...Array.from({ length: 20 }, (_, i) => `${base}-${i + 2}`)];
      for (const c of candidates) {
        if (!(await q<{ id: string }>(`select id from storefronts where org_id = $1 and slug = $2`, [c])).rows[0]) {
          slug = c;
          break;
        }
      }
      if (!slug) throw new AppError('CONFLICT', `no free slug for '${base}'`, 409);
    }
    const defaults = naming([
      ['slug', slug],
      ['name', input.display_name ?? p.external_account_id],
    ]);
    if (defaults.length) throw new AppError('VALIDATION_ERROR', defaults.join('; '), 422);
    const res = await q<{ id: string }>(
      `insert into storefronts (org_id, property_id, slug, display_name, bio, status) values ($1, $2, $3, $4, $5, $6) returning id`,
      [input.property_id, slug, (input.display_name ?? p.external_account_id).trim().slice(0, 80), input.bio ?? null, input.status ?? 'draft'],
    );
    const newId = (res.rows[0] as { id: string }).id;
    await audit(q, actorId, 'storefront.create', 'storefront', newId);
    return newId;
  });
  const cur = (await tenantQuery<{ slug: string }>(orgId, `select slug from storefronts where org_id = $1 and id = $2`, [id])).rows[0];
  await invalidateAfterCommit({ tokens: [], tags: ['sitemap', 'spotted', ...(oldSlug ? [`storefront:${oldSlug}`] : []), ...(cur ? [`storefront:${cur.slug}`] : [])] }, log);
  return id;
}

