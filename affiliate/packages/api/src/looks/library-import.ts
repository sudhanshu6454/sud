/**
 * The paparazzi library import (src/cli/looks.ts `import`; the owner's line
 * is deploy/linode/looks.sh import, reading /etc/afflino/library/library.csv
 * on the server — real library data never enters this repository; the TEST
 * fixture is db/fixtures/library.example.csv with "Demo Star …" people).
 *
 * One CSV row per outfit piece of a moment (a row without piece columns is a
 * moment with no piece yet). Rows sharing a look key (video_ref, plus
 * '#<moment_ref>' when one video holds several moments) are one look; their
 * look-level fields must agree.
 *
 * Header (case-insensitive; order free):
 *   required  video_ref, celebrity, moment_date (YYYY-MM-DD), still_ref
 *   licence   licence, commercial_reuse (yes|no|unknown), territory (IN, WW,
 *             or a list such as IN,AE), licence_expires (YYYY-MM-DD or none);
 *             with commercial_reuse=yes also the chain of title:
 *             copyright_owner, acquisition, and assignment_ref for anything
 *             but staff work (an image is never shown without it).
 *             The owned default (the owner, 2026-09-30: "all clips are owned
 *             by us"): a row that leaves all seven licence columns blank (or
 *             a file without them) takes its licence from the owner's
 *             ownership statement in force (looks/ownership.ts, looks.sh
 *             owned): commercial reuse yes, WW, no end, the statement's
 *             copyright owner and acquisition, the statement as the
 *             assignment reference (assets.licence_via = 'statement'). With
 *             no statement in force such a row is refused. A row that fills
 *             any of the seven carries its own licence (the per-row override)
 *             and needs the four above.
 *   optional  moment_ref, aliases (;-separated), celebrity_minor (yes|no),
 *             event, place, place_kind (event|venue|airport|street|studio|other),
 *             platform (facebook|instagram) + account (the in-house page),
 *             post_permalink (https), platform_post_id, still_url (https),
 *             source_ref, author,
 *             live_performance, minor_in_frame, bystanders, sensitive_location (yes|no),
 *             celebrity_display (name_only|name_and_image),
 *             piece_label, piece_category (@paparazzi/shared GARMENT_CATEGORIES),
 *             piece_order, piece_x, piece_y (0..1, both or neither)
 *
 * Refused as a whole (nothing written) on any problem: a missing licence
 * field, a bad date or value, an unknown or not owner-operated page, a
 * sensitive place, endorsement wording, an event / place / piece label that
 * names a celebrity (any in the organisation or the file), an ambiguous
 * celebrity alias, rows of one look that disagree; under
 * NODE_ENV=production also TEST rows ("Demo …" names, example.com URLs).
 *
 * Writes, in one transaction under a per-organisation advisory lock (the
 * ownership statement is read after taking it; recording or withdrawing one
 * takes the same lock):
 *   - the video and still assets with their licence metadata (upserted on
 *     (kind, storage_key); a changed still_url sends the still back to the
 *     frame screen). An asset whose licence a person edited through the API
 *     (licence_via = 'review') is never widened by a file: what would widen
 *     (assetWidenings: reuse turned to yes, a territory newly covering India,
 *     a later or no end, a live performance cleared, other licence text or
 *     chain of title) is kept as the person left it and listed in the
 *     answer's licence_kept; what narrows is applied;
 *   - celebrities found by name or alias, else created 'unreviewed'
 *     (nothing about them is published until a rights review); a known
 *     celebrity the file flags a minor is reset to unreviewed and the links
 *     of their looks are paused in the same transaction (their looks
 *     locked), the caches cleared after it;
 *   - the frame flags minor_in_frame, bystanders and sensitive_location
 *     are one-way: a file never clears one an editor set;
 *   - DRAFT looks (never published by the import); descriptive fields are
 *     updated only while a look is still a draft;
 *   - pieces (matched by label) while the look is a draft.
 * A second run of the same file changes nothing.
 */
import type { PoolClient } from 'pg';
import {
  ACQUISITIONS_NEEDING_ASSIGNMENT,
  celebrityNameKey,
  isGarmentCategory,
  isLookDisplayMode,
  isPlaceKind,
  lookTextFindings,
  namedCelebrities,
} from '@paparazzi/shared';
import { getPool } from '../db.js';
import { parseCsv } from '../delimited.js';
import { propertyIsOwnerOperated } from '../amazon/account.js';
import { createCelebrity, findCelebrityByName } from './celebrities.js';
import { assetWidenings, lookFieldProblems } from './editorial.js';
import { audit, isoDate, istToday, scoped, toIso, type Scoped } from './sql.js';
import { celebrityNames } from './names.js';
import { lockAndPauseCelebrityLinks } from './look-links.js';
import { invalidateAfterCommit } from './invalidate.js';
import { LIBRARY_LOCK_KEY, currentOwnershipStatement, ownedLicence, type OwnershipStatement } from './ownership.js';

export class LibraryImportRefusal extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`library import refused (nothing was written):\n  - ${problems.slice(0, 50).join('\n  - ')}`);
    this.name = 'LibraryImportRefusal';
    this.problems = problems;
  }
}

const REQUIRED = ['video_ref', 'celebrity', 'moment_date', 'still_ref'] as const;
/** The licence columns: all blank = the owned default (the ownership statement); any filled = the row's own licence. */
const LICENCE = ['licence', 'commercial_reuse', 'territory', 'licence_expires', 'copyright_owner', 'acquisition', 'assignment_ref'] as const;
const OPTIONAL = [
  ...LICENCE,
  'moment_ref',
  'aliases',
  'celebrity_minor',
  'event',
  'place',
  'place_kind',
  'platform',
  'account',
  'post_permalink',
  'platform_post_id',
  'still_url',
  'source_ref',
  'author',
  'live_performance',
  'minor_in_frame',
  'bystanders',
  'sensitive_location',
  'celebrity_display',
  'piece_label',
  'piece_category',
  'piece_order',
  'piece_x',
  'piece_y',
] as const;
type Column = (typeof REQUIRED)[number] | (typeof OPTIONAL)[number];

export interface LibraryPiece {
  row: number;
  label: string;
  category: string;
  order: number | null;
  x: number | null;
  y: number | null;
}

export interface LibraryLook {
  key: string;
  rows: number[];
  video_ref: string;
  celebrity: string;
  aliases: string[];
  celebrity_minor: boolean;
  moment_date: string;
  event: string | null;
  place: string | null;
  place_kind: string | null;
  platform: string | null;
  account: string | null;
  post_permalink: string | null;
  platform_post_id: string | null;
  still_ref: string;
  still_url: string | null;
  licence: {
    license: string;
    commercial_reuse: 'yes' | 'no' | 'unknown';
    territory: string;
    expires_at: string | null;
    source_ref: string | null;
    copyright_owner: string | null;
    author: string | null;
    acquisition: string | null;
    assignment_ref: string | null;
    /** 'import' = the row's own columns; 'statement' = the owned default. */
    via: 'import' | 'statement';
  };
  flags: { live_performance: boolean; minor_in_frame: boolean; bystanders: boolean; sensitive_location: boolean };
  celebrity_display: 'name_only' | 'name_and_image';
  pieces: LibraryPiece[];
}

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0', '']);

function isTestHost(url: string): boolean {
  const m = /^https:\/\/([^/?#]+)/i.exec(url);
  const host = (m?.[1] ?? '').toLowerCase();
  return /(^|\.)example\.(com|net|org)$/.test(host) || host.endsWith('.invalid') || host.endsWith('.test');
}

/**
 * Parse and check the file; problems are collected for every row (the whole
 * file is refused on any). `ownership` is the statement in force (null: none,
 * so a row without licence columns is refused).
 */
export function parseLibraryCsv(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
  ownership: OwnershipStatement | null = null,
): { looks: LibraryLook[]; problems: string[] } {
  const problems: string[] = [];
  let records: string[][];
  try {
    records = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  } catch (err) {
    return { looks: [], problems: [`not valid CSV: ${err instanceof Error ? err.message : String(err)}`] };
  }
  if (records.length < 2) return { looks: [], problems: ['the file has no data rows'] };
  const header = (records[0] as string[]).map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
  const idx = new Map<string, number>();
  header.forEach((h, i) => idx.set(h, i));
  for (const r of REQUIRED) if (!idx.has(r)) problems.push(`missing column '${r}'`);
  const known = new Set<string>([...REQUIRED, ...OPTIONAL]);
  for (const h of header) if (h !== '' && !known.has(h)) problems.push(`unknown column '${h}'`);
  if (problems.length) return { looks: [], problems };

  const production = env.NODE_ENV === 'production';
  const today = istToday(now);
  const owned = ownership ? ownedLicence(ownership) : null;
  const byKey = new Map<string, LibraryLook>();
  const sigOf = new Map<string, string>();
  const stillSig = new Map<string, { sig: string; key: string }>();
  const videoSig = new Map<string, { sig: string; key: string }>();

  records.slice(1).forEach((cells, i) => {
    const row = i + 2; // the file's line number (header = 1)
    const get = (c: Column) => {
      const at = idx.get(c);
      return at === undefined ? '' : (cells[at] ?? '').trim();
    };
    const bad = (msg: string) => problems.push(`row ${row}: ${msg}`);
    const flag = (c: Column): boolean => {
      const v = get(c).toLowerCase();
      if (YES.has(v)) return true;
      if (!NO.has(v)) bad(`${c} is yes or no`);
      return false;
    };
    const video = get('video_ref');
    const celeb = get('celebrity').replace(/\s+/g, ' ');
    const date = get('moment_date');
    const stillRef = get('still_ref');
    // The owned default: a row that leaves every licence column blank takes the ownership statement's licence.
    const ownRow = LICENCE.some((c) => get(c) !== '');
    if (!ownRow && !owned) {
      bad("no licence: fill licence, commercial_reuse, territory and licence_expires, or record the owner's ownership statement first (looks.sh owned), which every row without licence columns then takes");
    }
    const licence = ownRow ? get('licence') : (owned?.license ?? '');
    const reuse = ownRow ? get('commercial_reuse').toLowerCase() : 'yes';
    const territory = ownRow ? get('territory').toUpperCase().replace(/\s+/g, '') : 'WW';
    const expires = ownRow ? get('licence_expires').toLowerCase() : 'none';
    if (!video || video.length > 200) bad('video_ref is 1-200 characters');
    if (!celeb || celeb.length > 120 || celebrityNameKey(celeb) === '') bad('celebrity is 1-120 characters with letters');
    if (production && /^demo\b/i.test(celeb)) bad(`REFUSING under NODE_ENV=production: TEST celebrity '${celeb}'`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || isoDate(date) !== date) bad('moment_date is YYYY-MM-DD');
    else if (date > today) bad('moment_date is in the future');
    if (!stillRef || stillRef.length > 200) bad('still_ref is 1-200 characters');
    if (ownRow || owned) {
      if (!licence || licence.length > 200) bad('licence is required with the licence columns (the licence or assignment the footage is held under); leave all seven blank for the ownership statement');
      if (!['yes', 'no', 'unknown'].includes(reuse)) bad('commercial_reuse is yes, no or unknown');
      if (!territory || !territory.split(',').every((t) => /^[A-Z]{2}$/.test(t) || t === 'WW')) bad('territory is IN, WW or a comma-separated list of country codes');
    }
    let expiresAt: string | null = null;
    if (expires === 'none') expiresAt = null;
    else if (/^\d{4}-\d{2}-\d{2}$/.test(expires) && !Number.isNaN(Date.parse(`${expires}T00:00:00Z`))) expiresAt = new Date(`${expires}T23:59:59+05:30`).toISOString();
    else if (ownRow || owned) bad("licence_expires is YYYY-MM-DD, or 'none' for a licence without an end");
    const stillUrl = get('still_url') || null;
    const permalink = get('post_permalink') || null;
    for (const [name, u] of [
      ['still_url', stillUrl],
      ['post_permalink', permalink],
    ] as const) {
      if (!u) continue;
      if (!/^https:\/\/[^\s/?#]+(\/\S*)?$/.test(u)) bad(`${name} is an https URL`);
      else if (production && isTestHost(u)) bad(`REFUSING under NODE_ENV=production: TEST URL in ${name}`);
    }
    const platform = get('platform').toLowerCase() || null;
    const account = get('account').replace(/^@/, '') || null;
    if (!!platform !== !!account) bad('platform and account go together (the in-house page that published the moment)');
    if (platform && platform !== 'facebook' && platform !== 'instagram') bad('platform is facebook or instagram');
    const event = get('event') || null;
    const place = get('place') || null;
    const placeKind = get('place_kind').toLowerCase() || null;
    if (placeKind && !isPlaceKind(placeKind)) bad('place_kind is event, venue, airport, street, studio or other');
    for (const p of lookFieldProblems({ event_name: event, place })) bad(p);
    const copyrightOwner = ownRow ? get('copyright_owner') || null : (owned?.copyright_owner ?? null);
    const acquisition = ownRow ? get('acquisition').toLowerCase() || null : (owned?.acquisition ?? null);
    const assignmentRef = ownRow ? get('assignment_ref') || null : (owned?.assignment_ref ?? null);
    if (ownRow && acquisition && !['staff', 'freelance', 'agency', 'licensed', 'other'].includes(acquisition)) bad('acquisition is staff, freelance, agency, licensed or other');
    if (ownRow && reuse === 'yes') {
      // Commercial reuse is claimed: the chain of title behind it is required (the image is never shown without it).
      if (!copyrightOwner) bad('copyright_owner is required with commercial_reuse=yes (the chain of title)');
      if (!acquisition) bad('acquisition is required with commercial_reuse=yes (staff, freelance, agency, licensed or other)');
      else if (ACQUISITIONS_NEEDING_ASSIGNMENT.includes(acquisition) && !assignmentRef) bad(`assignment_ref is required for ${acquisition} footage with commercial_reuse=yes (the written assignment or licence)`);
    }
    const display = get('celebrity_display').toLowerCase() || 'name_only';
    if (!isLookDisplayMode(display)) bad('celebrity_display is name_only or name_and_image');
    const postId = get('platform_post_id') || null;
    if (postId && postId.length > 100) bad('platform_post_id is at most 100 characters');
    const aliases = get('aliases')
      .split(';')
      .map((a) => a.replace(/\s+/g, ' ').trim())
      .filter((a) => a !== '');
    if (production && aliases.some((a) => /^demo\b/i.test(a))) bad('REFUSING under NODE_ENV=production: TEST alias');
    const flags = {
      live_performance: flag('live_performance'),
      minor_in_frame: flag('minor_in_frame'),
      bystanders: flag('bystanders'),
      sensitive_location: flag('sensitive_location'),
    };
    const minor = flag('celebrity_minor');

    const momentRef = get('moment_ref');
    const key = momentRef ? `${video}#${momentRef}` : video;
    const lic: LibraryLook['licence'] = {
      license: licence,
      commercial_reuse: reuse as 'yes' | 'no' | 'unknown',
      territory,
      expires_at: expiresAt,
      source_ref: get('source_ref') || null,
      copyright_owner: copyrightOwner,
      author: get('author') || null,
      acquisition,
      assignment_ref: assignmentRef,
      via: ownRow ? 'import' : 'statement',
    };
    const lookSig = JSON.stringify([celebrityNameKey(celeb), date, event, place, placeKind, platform, account, permalink, postId, stillRef, stillUrl, lic, flags, display, minor, aliases]);
    const assetSig = JSON.stringify([stillUrl, lic, flags]);

    // pieces
    const label = get('piece_label');
    const category = get('piece_category').toLowerCase();
    let piece: LibraryPiece | null = null;
    if (label || category) {
      if (!label || label.length > 60) bad('piece_label is 1-60 characters (in your words: the shirt, the bag …)');
      const words = lookTextFindings(label);
      if (words.length) bad(`piece_label: ${words.join(', ')}`);
      if (!isGarmentCategory(category)) bad(`piece_category '${category}' is not in the list`);
      const orderRaw = get('piece_order');
      const order = orderRaw === '' ? null : Number(orderRaw);
      if (order !== null && (!Number.isInteger(order) || order < 0 || order > 1000)) bad('piece_order is a whole number 0-1000');
      const xs = get('piece_x');
      const ys = get('piece_y');
      if ((xs === '') !== (ys === '')) bad('piece_x and piece_y go together');
      const x = xs === '' ? null : Number(xs);
      const y = ys === '' ? null : Number(ys);
      for (const v of [x, y]) if (v !== null && !(v >= 0 && v <= 1)) bad('piece_x / piece_y are 0..1 (of the width / height)');
      piece = { row, label, category, order, x, y };
    }

    const existing = byKey.get(key);
    if (existing) {
      if (sigOf.get(key) !== lookSig) bad(`the look '${key}' has look-level fields that differ from row ${existing.rows[0]}`);
      existing.rows.push(row);
      if (piece) {
        if (existing.pieces.some((p) => p.label.toLowerCase() === piece.label.toLowerCase())) bad(`piece '${piece.label}' appears twice in the look '${key}'`);
        existing.pieces.push(piece);
      }
    } else {
      sigOf.set(key, lookSig);
      byKey.set(key, {
        key,
        rows: [row],
        video_ref: video,
        celebrity: celeb,
        aliases,
        celebrity_minor: minor,
        moment_date: date,
        event,
        place,
        place_kind: placeKind,
        platform,
        account,
        post_permalink: permalink,
        platform_post_id: postId,
        still_ref: stillRef,
        still_url: stillUrl,
        licence: lic,
        flags,
        celebrity_display: display as 'name_only' | 'name_and_image',
        pieces: piece ? [piece] : [],
      });
    }
    const s = stillSig.get(stillRef);
    if (s && s.sig !== assetSig) bad(`still_ref '${stillRef}' has other licence data on the look '${s.key}'`);
    else if (!s) stillSig.set(stillRef, { sig: assetSig, key });
    const vs = JSON.stringify(lic);
    const v = videoSig.get(video);
    if (v && v.sig !== vs) bad(`video_ref '${video}' has other licence data on the look '${v.key}'`);
    else if (!v) videoSig.set(video, { sig: vs, key });
  });
  return { looks: [...byKey.values()], problems };
}

export interface LibraryImportSummary {
  org_id: string;
  rows: number;
  looks: number;
  looks_created: number;
  looks_updated: number;
  looks_unchanged: number;
  looks_not_draft_kept: number;
  celebrities_created: number;
  celebrities_matched: number;
  celebrities_flagged_minor: number;
  assets_created: number;
  assets_updated: number;
  pieces_created: number;
  pieces_updated: number;
  /** Links paused because the file flagged a known celebrity a minor. */
  links_paused: number;
  created_looks: Array<{ key: string; look_id: string; celebrity: string; celebrity_status: string }>;
  /** Looks whose licence came from the ownership statement (the owned default). */
  licence_from_statement: number;
  /** The statement those took it from (null when no row used it). */
  ownership_statement: { id: string; copyright_owner: string; acquisition: string; recorded_at: string } | null;
  /** Assets a person edited: the file's widening changes not applied (the rights reviewer changes those in the admin). */
  licence_kept: Array<{ kind: 'still' | 'video'; ref: string; kept: string[] }>;
}

const LOCK_KEY = LIBRARY_LOCK_KEY;

type LicenceFacts = Pick<
  LibraryLook['licence'],
  'license' | 'commercial_reuse' | 'territory' | 'expires_at' | 'source_ref' | 'copyright_owner' | 'author' | 'acquisition' | 'assignment_ref'
> & { live_performance: boolean };

/**
 * A file's licence facts over those a person recorded (licence_via =
 * 'review'): each field takes the file's value where that narrows or keeps
 * what may be shown, and keeps the person's where the file would widen it
 * (the same test as the API's, assetWidenings). `kept` lists those fields.
 */
export function mergeOverReviewed(cur: LicenceFacts, file: LicenceFacts): { facts: LicenceFacts; kept: string[] } {
  const widened = new Set(
    assetWidenings(
      {
        id: '',
        public_url: null,
        license: cur.license,
        commercial_reuse: cur.commercial_reuse,
        territory: cur.territory,
        expires_at: cur.expires_at,
        copyright_owner: cur.copyright_owner,
        acquisition: cur.acquisition,
        assignment_ref: cur.assignment_ref,
        live_performance: cur.live_performance,
        minor_in_frame: false,
        bystanders: false,
        sensitive_location: false,
      },
      {
        license: file.license,
        commercial_reuse: file.commercial_reuse,
        territory: file.territory,
        expires_at: file.expires_at,
        copyright_owner: file.copyright_owner,
        acquisition: file.acquisition,
        assignment_ref: file.assignment_ref,
        live_performance: file.live_performance,
      },
    ),
  );
  const facts: LicenceFacts = { ...file };
  for (const k of ['license', 'commercial_reuse', 'territory', 'expires_at', 'copyright_owner', 'acquisition', 'assignment_ref', 'live_performance'] as const) {
    if (widened.has(k)) (facts as Record<string, unknown>)[k] = cur[k];
  }
  return { facts, kept: [...widened].sort() };
}

interface Precheck {
  problems: string[];
  propertyOf: Map<string, string | null>;
  matchOf: Map<string, { id: string; status: string; is_minor: boolean } | null>;
  existing: Set<string>;
}

/** The read-only pre-pass of an import: every problem the database can reveal, before anything is written. */
async function libraryPrecheck(q: Scoped, orgId: string, looks: LibraryLook[]): Promise<Precheck> {
  const problems: string[] = [];
  const propertyOf = new Map<string, string | null>();
  const matchOf = new Map<string, { id: string; status: string; is_minor: boolean } | null>();
  const existingKeys = new Set<string>();
  for (const l of looks) {
    let propertyId: string | null = null;
    if (l.platform && l.account) {
      const p = (
        await q<{ id: string; status: string }>(
          `select id, status from properties where org_id = $1 and platform = $2 and lower(external_account_id) = $3`,
          [l.platform, l.account.toLowerCase()],
        )
      ).rows[0];
      if (!p) problems.push(`look '${l.key}' (row ${l.rows[0]}): no ${l.platform} page '${l.account}' in the in-house network`);
      else if (p.status !== 'approved' || !(await propertyIsOwnerOperated(orgId, p.id))) problems.push(`look '${l.key}': the ${l.platform} page '${l.account}' is not approved and owner-operated`);
      else propertyId = p.id;
    }
    propertyOf.set(l.key, propertyId);
    const ck = celebrityNameKey(l.celebrity);
    if (!matchOf.has(ck)) {
      const found = await findCelebrityByName(q, l.celebrity);
      if (found.kind === 'ambiguous') problems.push(`look '${l.key}': '${l.celebrity}' matches the aliases of several celebrities; use the full name`);
      matchOf.set(ck, found.kind === 'one' ? { id: found.row.id, status: found.row.rights_status, is_minor: found.row.is_minor } : null);
    }
    const existing = (await q<{ celebrity_id: string | null }>(`select celebrity_id from looks where org_id = $1 and library_ref = $2`, [l.key])).rows[0];
    const match = matchOf.get(ck);
    if (existing) existingKeys.add(l.key);
    if (existing && existing.celebrity_id !== (match?.id ?? null)) problems.push(`look '${l.key}' exists with another celebrity; a look's celebrity is fixed`);
  }
  // No event, place or piece label names anyone: a celebrity already known, or one in this file.
  const known = await celebrityNames(orgId, q);
  const inFile = looks.map((l, i) => ({ id: `file:${i}`, name: l.celebrity, aliases: l.aliases }));
  const everyone = [...known, ...inFile];
  for (const l of looks) {
    for (const [field, text] of [['event', l.event], ['place', l.place], ...l.pieces.map((p): [string, string] => [`piece_label '${p.label}'`, p.label])] as Array<[string, string | null]>) {
      const found = namedCelebrities(text, everyone);
      if (found.length) problems.push(`look '${l.key}' (row ${l.rows[0]}): ${field} names a celebrity (${[...new Set(found.map((f) => f.name))].join('; ')}); a name appears only in the credit line of that person's own look`);
    }
  }
  return { problems, propertyOf, matchOf, existing: existingKeys };
}


async function upsertAsset(
  q: Scoped,
  kind: 'still' | 'video',
  key: string,
  l: LibraryLook,
  summary: LibraryImportSummary,
): Promise<string> {
  const lic = l.licence;
  const flags = kind === 'still' ? l.flags : { live_performance: l.flags.live_performance, minor_in_frame: false, bystanders: false, sensitive_location: false };
  const publicUrl = kind === 'still' ? l.still_url : null;
  const cur = (
    await q<{
      id: string;
      public_url: string | null;
      license: string;
      licence_via: string | null;
      commercial_reuse: string;
      territory: string | null;
      expires_at: string | Date | null;
      source_ref: string | null;
      copyright_owner: string | null;
      author: string | null;
      acquisition: string | null;
      assignment_ref: string | null;
      live_performance: boolean;
      minor_in_frame: boolean;
      bystanders: boolean;
      sensitive_location: boolean;
    }>(
      `select id, public_url, license, licence_via, commercial_reuse, territory, expires_at, source_ref, copyright_owner, author, acquisition,
              assignment_ref, live_performance, minor_in_frame, bystanders, sensitive_location
         from assets where org_id = $1 and kind = $2 and storage_key = $3`,
      [kind, key],
    )
  ).rows[0];
  // One-way frame flags: a file never clears one an editor (or an earlier file) set.
  const sticky = cur
    ? { minor_in_frame: flags.minor_in_frame || cur.minor_in_frame, bystanders: flags.bystanders || cur.bystanders, sensitive_location: flags.sensitive_location || cur.sensitive_location }
    : { minor_in_frame: flags.minor_in_frame, bystanders: flags.bystanders, sensitive_location: flags.sensitive_location };
  let facts: LicenceFacts = {
    license: lic.license,
    commercial_reuse: lic.commercial_reuse,
    territory: lic.territory,
    expires_at: lic.expires_at,
    source_ref: lic.source_ref,
    copyright_owner: lic.copyright_owner,
    author: lic.author,
    acquisition: lic.acquisition,
    assignment_ref: lic.assignment_ref,
    live_performance: flags.live_performance,
  };
  let via: string = lic.via;
  if (cur && cur.licence_via === 'review') {
    // A person recorded this asset's licence: the file narrows it, never widens it.
    const have: LicenceFacts = {
      license: cur.license,
      commercial_reuse: cur.commercial_reuse as LicenceFacts['commercial_reuse'],
      territory: cur.territory ?? '',
      expires_at: toIso(cur.expires_at),
      source_ref: cur.source_ref,
      copyright_owner: cur.copyright_owner,
      author: cur.author,
      acquisition: cur.acquisition,
      assignment_ref: cur.assignment_ref,
      live_performance: cur.live_performance,
    };
    const merged = mergeOverReviewed(have, facts);
    facts = merged.facts;
    if (merged.kept.length) {
      via = 'review';
      summary.licence_kept.push({ kind, ref: key, kept: merged.kept });
    }
  }
  const want = [publicUrl, facts.license, facts.commercial_reuse, facts.territory, facts.expires_at, facts.source_ref, facts.copyright_owner, facts.author, facts.acquisition, facts.assignment_ref, facts.live_performance, sticky.minor_in_frame, sticky.bystanders, sticky.sensitive_location, via];
  if (!cur) {
    const res = await q<{ id: string }>(
      `insert into assets (org_id, kind, storage_key, public_url, license, commercial_reuse, territory, expires_at, source_ref,
                           copyright_owner, author, acquisition, assignment_ref, live_performance, minor_in_frame, bystanders,
                           sensitive_location, licence_via, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
       returning id`,
      [kind, key, ...want],
    );
    summary.assets_created += 1;
    return (res.rows[0] as { id: string }).id;
  }
  const have = [cur.public_url, cur.license, cur.commercial_reuse, cur.territory, toIso(cur.expires_at), cur.source_ref, cur.copyright_owner, cur.author, cur.acquisition, cur.assignment_ref, cur.live_performance, cur.minor_in_frame, cur.bystanders, cur.sensitive_location, cur.licence_via];
  if (JSON.stringify(have) !== JSON.stringify(want)) {
    const newImage = cur.public_url !== publicUrl;
    await q(
      `update assets set public_url = $3, license = $4, commercial_reuse = $5, territory = $6, expires_at = $7::timestamptz,
              source_ref = $8, copyright_owner = $9, author = $10, acquisition = $11, assignment_ref = $12,
              live_performance = $13, minor_in_frame = $14, bystanders = $15, sensitive_location = $16, licence_via = $17, updated_at = now()
              ${newImage ? `, screen_status = 'unscreened', screened_by = null, screened_at = null` : ''}
        where org_id = $1 and id = $2`,
      [cur.id, ...want],
    );
    summary.assets_updated += 1;
  }
  return cur.id;
}

export async function importLibrary(opts: { orgSlug: string; text: string; actorId?: string | null; env?: NodeJS.ProcessEnv; now?: number }): Promise<LibraryImportSummary> {
  const env = opts.env ?? process.env;
  const org = (await getPool().query<{ id: string }>(`select id from organisations where slug = $1`, [opts.orgSlug])).rows[0];
  if (!org) throw new LibraryImportRefusal([`no organisation '${opts.orgSlug}'`]);
  const orgId = org.id;

  const client: PoolClient = await getPool().connect();
  let locked = false;
  try {
    locked = (await client.query<{ locked: boolean }>(`select pg_try_advisory_lock(hashtext($1)) as locked`, [LOCK_KEY(orgId)])).rows[0]?.locked === true;
    if (!locked) throw new LibraryImportRefusal(['another library import is running for this organisation, or an ownership statement is being recorded; try again when it finishes']);
    const q = scoped(client, orgId);
    // Read under the lock: a statement cannot be withdrawn while this import uses it.
    const ownership = await currentOwnershipStatement(q);
    const parsed = parseLibraryCsv(opts.text, env, opts.now, ownership);
    if (parsed.problems.length) throw new LibraryImportRefusal(parsed.problems);
    const fromStatement = ownership ? parsed.looks.filter((l) => l.licence.via === 'statement').length : 0;
    const summary: LibraryImportSummary = {
      org_id: orgId,
      rows: parsed.looks.reduce((n, l) => n + l.rows.length, 0),
      looks: parsed.looks.length,
      looks_created: 0,
      looks_updated: 0,
      looks_unchanged: 0,
      looks_not_draft_kept: 0,
      celebrities_created: 0,
      celebrities_matched: 0,
      celebrities_flagged_minor: 0,
      assets_created: 0,
      assets_updated: 0,
      pieces_created: 0,
      pieces_updated: 0,
      links_paused: 0,
      created_looks: [],
      licence_from_statement: fromStatement,
      ownership_statement:
        fromStatement && ownership ? { id: ownership.id, copyright_owner: ownership.copyright_owner, acquisition: ownership.acquisition, recorded_at: ownership.recorded_at } : null,
      licence_kept: [],
    };
    // Read-only pre-pass: every problem the database can reveal, before anything is written.
    const { problems, propertyOf, matchOf } = await libraryPrecheck(q, orgId, parsed.looks);
    if (problems.length) throw new LibraryImportRefusal(problems);

    await client.query('BEGIN');
    const celebCache = new Map<string, { id: string; status: string }>();
    const pausedTokens: string[] = [];
    const flaggedSlugs: string[] = [];
    const flaggedLooks: string[] = [];
    for (const l of parsed.looks) {
      const propertyId = propertyOf.get(l.key) ?? null;
      const ck = celebrityNameKey(l.celebrity);
      let celeb = celebCache.get(ck);
      if (!celeb) {
        const match = matchOf.get(ck) ?? null;
        if (match) {
          celeb = { id: match.id, status: match.status };
          summary.celebrities_matched += 1;
          if (l.celebrity_minor && !match.is_minor) {
            const reset = match.status === 'editorial' || match.status === 'cleared';
            await q(
              `update celebrities set is_minor = true, updated_at = now()
                      ${reset ? `, rights_status = 'unreviewed', max_display = 'none', shoppable = false` : ''}
                where org_id = $1 and id = $2`,
              [match.id],
            );
            if (reset && opts.actorId) {
              await q(
                `insert into celebrity_rights_reviews (org_id, celebrity_id, kind, rights_status, max_display, shoppable, note, reviewed_by, reviewed_role)
                 values ($1, $2, 'minor_flag', 'unreviewed', 'none', false, 'flagged a minor by the library import', $3, 'library_import')`,
                [match.id, opts.actorId],
              );
            }
            summary.celebrities_flagged_minor += 1;
            celeb.status = reset ? 'unreviewed' : celeb.status;
            // A minor is never published: their looks' links pause now, in this transaction (the looks locked).
            const paused = await lockAndPauseCelebrityLinks(client, orgId, match.id, 'rights_review');
            pausedTokens.push(...paused.tokens);
            flaggedLooks.push(...paused.lookIds);
            const slug = (await q<{ slug: string }>(`select slug from celebrities where org_id = $1 and id = $2`, [match.id])).rows[0]?.slug;
            if (slug) flaggedSlugs.push(slug);
          }
        } else {
          const created = await createCelebrity(q, { name: l.celebrity, aliases: l.aliases, is_minor: l.celebrity_minor });
          celeb = { id: created.id, status: created.rights_status };
          summary.celebrities_created += 1;
        }
        celebCache.set(ck, celeb);
      }
      const videoId = await upsertAsset(q, 'video', l.video_ref, l, summary);
      const stillId = await upsertAsset(q, 'still', l.still_ref, l, summary);
      const title = [l.event, l.moment_date].filter(Boolean).join(' ') || l.key;
      const existing = (
        await q<{ id: string; status: string; celebrity_id: string | null; event_name: string | null; place: string | null; place_kind: string | null; moment_date: string | Date | null; property_id: string | null; post_permalink: string | null; platform_post_id: string | null; still_asset_id: string | null; source_video_asset_id: string | null; celebrity_display: string }>(
          `select id, status, celebrity_id, event_name, place, place_kind, moment_date, property_id, post_permalink, platform_post_id,
                  still_asset_id, source_video_asset_id, celebrity_display
             from looks where org_id = $1 and library_ref = $2`,
          [l.key],
        )
      ).rows[0];
      const want = [l.event, l.place, l.place_kind, l.moment_date, propertyId, l.post_permalink, l.platform_post_id, stillId, videoId, l.celebrity_display];
      let lookId: string;
      let isDraft: boolean;
      if (!existing) {
        const res = await q<{ id: string }>(
          `insert into looks (org_id, title, locale, status, library_ref, celebrity_id, event_name, place, place_kind, moment_date,
                              property_id, post_permalink, platform_post_id, still_asset_id, source_video_asset_id, celebrity_display,
                              cover_asset_id, updated_at)
           values ($1, $2, 'en-IN', 'draft', $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13, $14, null, now())
           returning id`,
          [title, l.key, celeb.id, ...want],
        );
        lookId = (res.rows[0] as { id: string }).id;
        isDraft = true;
        summary.looks_created += 1;
        summary.created_looks.push({ key: l.key, look_id: lookId, celebrity: l.celebrity, celebrity_status: celeb.status });
        if (opts.actorId) await audit(q, opts.actorId, 'look.import', 'look', lookId);
      } else {
        lookId = existing.id;
        isDraft = existing.status === 'draft';
        const have = [existing.event_name, existing.place, existing.place_kind, isoDate(existing.moment_date), existing.property_id, existing.post_permalink, existing.platform_post_id, existing.still_asset_id, existing.source_video_asset_id, existing.celebrity_display];
        if (JSON.stringify(have) === JSON.stringify(want)) summary.looks_unchanged += 1;
        else if (!isDraft) summary.looks_not_draft_kept += 1;
        else {
          const placeChanged = existing.event_name !== l.event || existing.place !== l.place || existing.place_kind !== l.place_kind;
          await q(
            `update looks set event_name = $3, place = $4, place_kind = $5, moment_date = $6::date, property_id = $7, post_permalink = $8,
                    platform_post_id = $9, still_asset_id = $10, source_video_asset_id = $11, celebrity_display = $12, updated_at = now()
                    ${placeChanged ? ', place_confirmed_by = null, place_confirmed_at = null, place_confirmed_note = null' : ''}
              where org_id = $1 and id = $2 and status = 'draft'`,
            [lookId, ...want],
          );
          summary.looks_updated += 1;
        }
      }
      if (!isDraft) continue;
      const pieces = (await q<{ id: string; label: string; garment_category: string; position: number; hotspot_x: string | number | null; hotspot_y: string | number | null }>(
        `select id, label, garment_category, position, hotspot_x, hotspot_y from look_pieces where org_id = $1 and look_id = $2 and removed_at is null`,
        [lookId],
      )).rows;
      let next = pieces.reduce((m, p) => Math.max(m, Number(p.position) + 1), 0);
      for (const p of l.pieces) {
        const cur = pieces.find((x) => x.label.toLowerCase() === p.label.toLowerCase());
        const position = p.order ?? (cur ? Number(cur.position) : next++);
        const hx = p.x === null ? null : Math.round(p.x * 10_000) / 10_000;
        const hy = p.y === null ? null : Math.round(p.y * 10_000) / 10_000;
        if (!cur) {
          await q(
            `insert into look_pieces (org_id, look_id, label, garment_category, position, hotspot_x, hotspot_y) values ($1, $2, $3, $4, $5, $6, $7)`,
            [lookId, p.label, p.category, position, hx, hy],
          );
          summary.pieces_created += 1;
        } else {
          const same =
            cur.garment_category === p.category &&
            Number(cur.position) === position &&
            (cur.hotspot_x === null ? null : Number(cur.hotspot_x)) === hx &&
            (cur.hotspot_y === null ? null : Number(cur.hotspot_y)) === hy;
          if (!same) {
            await q(
              `update look_pieces set garment_category = $3, position = $4, hotspot_x = $5, hotspot_y = $6, updated_at = now() where org_id = $1 and id = $2`,
              [cur.id, p.category, position, hx, hy],
            );
            summary.pieces_updated += 1;
          }
        }
      }
    }
    await client.query('COMMIT');
    // After the commit: the paused links' routes, and every public answer (a new name or alias can match text written before).
    await invalidateAfterCommit({
      tokens: pausedTokens,
      tags: ['spotted', 'sitemap', ...flaggedSlugs.map((sl) => `celebrity:${sl}`), ...flaggedLooks.map((id) => `look:${id}`)],
    });
    summary.links_paused = pausedTokens.length;
    return summary;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the original error is what matters
    }
    throw err;
  } finally {
    if (locked) {
      try {
        await client.query(`select pg_advisory_unlock(hashtext($1))`, [LOCK_KEY(orgId)]);
      } catch {
        // closing the session drops the lock anyway
      }
    }
    client.release();
  }
}

export interface LibraryCheckResult {
  ok: boolean;
  problems: string[];
  rows: number;
  looks: number;
  looks_new: number;
  looks_existing: number;
  pieces: number;
  /** Looks that would take their licence from the ownership statement in force. */
  licence_from_statement: number;
  ownership_statement: { id: string; copyright_owner: string; acquisition: string; recorded_at: string } | null;
  celebrities: Array<{ name: string; known: boolean; rights_status: string | null; looks: number }>;
}

/**
 * A dry run of importLibrary: the same parsing and the same read-only
 * database pre-pass, nothing written (no lock taken, no transaction). What
 * the admin's library screen shows before the operator imports.
 */
export async function checkLibrary(opts: { orgId: string; text: string; env?: NodeJS.ProcessEnv; now?: number }): Promise<LibraryCheckResult> {
  const client: PoolClient = await getPool().connect();
  try {
    const q = scoped(client, opts.orgId);
    const ownership = await currentOwnershipStatement(q);
    const parsed = parseLibraryCsv(opts.text, opts.env ?? process.env, opts.now, ownership);
    const rows = parsed.looks.reduce((n, l) => n + l.rows.length, 0);
    const pieces = parsed.looks.reduce((n, l) => n + l.pieces.length, 0);
    const fromStatement = ownership ? parsed.looks.filter((l) => l.licence.via === 'statement').length : 0;
    const statement =
      fromStatement && ownership ? { id: ownership.id, copyright_owner: ownership.copyright_owner, acquisition: ownership.acquisition, recorded_at: ownership.recorded_at } : null;
    if (parsed.problems.length) {
      return { ok: false, problems: parsed.problems, rows, looks: parsed.looks.length, looks_new: 0, looks_existing: 0, pieces, licence_from_statement: fromStatement, ownership_statement: statement, celebrities: [] };
    }
    const pre = await libraryPrecheck(q, opts.orgId, parsed.looks);
    const people = new Map<string, { name: string; known: boolean; rights_status: string | null; looks: number }>();
    for (const l of parsed.looks) {
      const ck = celebrityNameKey(l.celebrity);
      const m = pre.matchOf.get(ck) ?? null;
      const cur = people.get(ck) ?? { name: l.celebrity, known: !!m, rights_status: m?.status ?? null, looks: 0 };
      cur.looks += 1;
      people.set(ck, cur);
    }
    return {
      ok: pre.problems.length === 0,
      problems: pre.problems,
      rows,
      looks: parsed.looks.length,
      looks_new: parsed.looks.filter((l) => !pre.existing.has(l.key)).length,
      looks_existing: parsed.looks.filter((l) => pre.existing.has(l.key)).length,
      pieces,
      licence_from_statement: fromStatement,
      ownership_statement: statement,
      celebrities: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  } finally {
    client.release();
  }
}
