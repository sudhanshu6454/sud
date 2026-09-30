/**
 * The publish gate of a celebrity look (POST /v1/editorial/looks/:id/transition
 * {to: 'published'}, and a restore after a takedown). Every check is reported,
 * failing or not, so the editor sees the whole list at once (409 with the
 * report when any fails). The same conditions are re-applied at every public
 * read (src/looks/bundle.ts publicVisibility / publicLook, src/looks/public.ts),
 * so a rights downgrade, an expired licence or a takedown hides content at
 * once without anyone re-publishing.
 */
import {
  AppError,
  PLACE_KINDS_WITHOUT_CONFIRMATION,
  assetImageRefusals,
  displayWithin,
  effectiveCelebrityRights,
  isLookDisplayMode,
  lookTextFindings,
  productTextRefusals,
  sensitivePlaceFinding,
  type PlaceKind,
} from '@paparazzi/shared';
import { checkMintGuards } from '../links/mint.js';
import { chooseLookPlacement } from './look-links.js';
import { lookOwnTexts, type LookBundle } from './bundle.js';
import { celebrityNames, describeNames, namesIn, type CelebrityName } from './names.js';
import { isoDate, istToday } from './sql.js';

export interface GateCheck {
  code: string;
  ok: boolean;
  detail?: string;
}

export interface GateReport {
  ok: boolean;
  checks: GateCheck[];
}

/** The in-house platforms a celebrity look is published from. */
const LOOK_PLATFORMS = ['facebook', 'instagram'];

export async function publishGate(
  orgId: string,
  b: LookBundle,
  opts: { now?: number; ignoreTakedownId?: string | null; names?: CelebrityName[] } = {},
): Promise<GateReport> {
  const now = opts.now ?? Date.now();
  const names = opts.names ?? (await celebrityNames(orgId));
  const ignore = opts.ignoreTakedownId ?? null;
  const checks: GateCheck[] = [];
  const add = (code: string, ok: boolean, detail?: string) => checks.push(detail === undefined ? { code, ok } : { code, ok, detail });
  const c = b.celebrity;

  add('celebrity', !!c, c ? undefined : 'a celebrity look names its celebrity (celebrity_id)');
  const lookTakedown = b.look.takedown_id && b.look.takedown_id !== ignore ? b.look.takedown_id : null;
  const celebTakedown = c?.takedown_id && c.takedown_id !== ignore ? c.takedown_id : null;
  add('no_takedown', !lookTakedown && !celebTakedown, lookTakedown || celebTakedown ? `takedown ${lookTakedown ?? celebTakedown} is active` : undefined);
  add('not_withdrawn', b.look.status !== 'withdrawn' || !!ignore, b.look.status === 'withdrawn' && !ignore ? 'a withdrawn look comes back only through a takedown restore' : undefined);

  const rights = c ? effectiveCelebrityRights({ ...c, takedown_id: celebTakedown }) : { display: 'none' as const, shoppable: false };
  add('not_minor_or_never_list', !!c && !c.is_minor && !c.never_list, c && (c.is_minor || c.never_list) ? 'minors and never-listed celebrities are never published' : undefined);
  add(
    'rights_status',
    rights.display !== 'none',
    c ? `status '${c.rights_status}' (review: ${c.max_display}${c.shoppable ? ', shoppable' : ''}) allows ${rights.display}${rights.shoppable ? ' with products' : ', no products'}` : undefined,
  );
  const mode = isLookDisplayMode(b.look.celebrity_display) ? b.look.celebrity_display : 'name_only';
  add(
    'display_mode',
    rights.display !== 'none' && displayWithin(mode, rights.display),
    `the look shows ${mode}; the celebrity's rights allow ${rights.display}`,
  );
  if (mode === 'name_and_image') {
    const refusals = assetImageRefusals(b.still, now);
    add('image_licence', refusals.length === 0, refusals.length ? `the still may not be shown: ${refusals.join(', ')}` : undefined);
  }

  const date = isoDate(b.look.moment_date);
  const today = istToday(now);
  add('moment_date', !!date && date < today, !date ? 'the moment has no date' : date >= today ? 'published after the day of the moment, never as live whereabouts' : undefined);

  const p = b.property;
  const pageOk = !!p && p.status === 'approved' && b.propertyOwnerOperated && LOOK_PLATFORMS.includes(p.platform);
  add('in_house_page', pageOk, pageOk ? undefined : 'the moment names the approved, owner-operated Facebook or Instagram page that published it');

  const texts: Array<[string, string | null]> = [
    ['event', b.look.event_name],
    ['place', b.look.place],
    ...b.pieces.map((pc): [string, string | null] => [`piece '${pc.label}'`, pc.label]),
  ];
  const wording: string[] = [];
  for (const [where, text] of texts) {
    const f = lookTextFindings(text);
    if (f.length) wording.push(`${where}: ${f.join(', ')}`);
    if (where !== 'event' && where !== 'place') continue;
    if (sensitivePlaceFinding(text)) wording.push(`${where}: a sensitive place (hospital, home, school, place of worship)`);
  }
  if (c && b.look.event_name && b.look.event_name.toLowerCase().includes(c.name.toLowerCase())) wording.push('event: repeats the name');
  add('wording', wording.length === 0, wording.length ? wording.join('; ') : undefined);

  // No text but the credit line names anyone: not the look's own celebrity, not another one (withheld or not).
  const named = namesIn(lookOwnTexts(b), names);
  add('no_names_in_text', named.length === 0, named.length ? `the event, place or a piece label names a celebrity (${describeNames(named)}): the name appears only in the credit line` : undefined);

  const kind = b.look.place_kind as PlaceKind | null;
  const confirmed = !!b.look.place_confirmed_at;
  const placeOk = !!kind && (PLACE_KINDS_WITHOUT_CONFIRMATION.includes(kind) || confirmed);
  add(
    'place_kind',
    placeOk,
    !kind
      ? 'the moment names its kind of place (event, venue, airport, studio; street or other with the rights reviewer\'s confirmation)'
      : !placeOk
        ? `a '${kind}' place is published only after the rights reviewer confirmed it (never a residence, clinic, school or place of worship)`
        : undefined,
  );

  const badText = b.items
    .filter((i) => i.review_state === 'approved')
    .map((i) => ({ i, r: productTextRefusals([i.brand, i.model, i.product_category], names) }))
    .filter((x) => x.r.length > 0);
  add(
    'product_text',
    badText.length === 0,
    badText.length ? badText.map((x) => `${x.i.brand} ${x.i.model}: ${x.r.join(', ')}`).join('; ') : undefined,
  );

  add('pieces', b.pieces.length > 0, b.pieces.length ? undefined : 'the outfit has no pieces');
  const empty = b.pieces.filter((pc) => !b.items.some((i) => i.piece_id === pc.id && i.review_state === 'approved'));
  add('every_piece_has_a_product', b.pieces.length > 0 && empty.length === 0, empty.length ? `no product yet: ${empty.map((e) => e.label).join(', ')}` : undefined);
  const pending = b.items.filter((i) => i.match_type === 'exact' && i.review_state !== 'approved');
  add('exact_reviewed', pending.length === 0, pending.length ? `${pending.length} EXACT tag(s) wait for a second person's review` : undefined);

  if (rights.shoppable) {
    const unpriced = b.pieces.filter(
      (pc) => !b.items.some((i) => i.piece_id === pc.id && i.review_state === 'approved' && b.offers.get(i.variant_id)),
    );
    add('live_offers', unpriced.length === 0, unpriced.length ? `no live offer: ${unpriced.map((e) => e.label).join(', ')}` : undefined);
    const linkProblems: string[] = [];
    for (const item of b.items.filter((i) => i.review_state === 'approved')) {
      const offer = b.offers.get(item.variant_id);
      if (!offer) continue;
      const choice = await chooseLookPlacement(orgId, offer.programme_id);
      if (!choice) {
        linkProblems.push(`${item.brand} ${item.model}: no afflino.com placement in the programme (for Amazon: one with its own tracking ID)`);
        continue;
      }
      try {
        await checkMintGuards(orgId, {
          property_id: choice.property_id,
          programme_id: offer.programme_id,
          offer_id: offer.id,
          placement_id: choice.placement_id,
        });
      } catch (err) {
        linkProblems.push(`${item.brand} ${item.model}: ${err instanceof AppError ? `${err.code} ${err.message}` : 'unexpected error'}`);
      }
    }
    add('link_rules', linkProblems.length === 0, linkProblems.length ? linkProblems.join('; ') : undefined);
  }

  return { ok: checks.every((x) => x.ok), checks };
}
