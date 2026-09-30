/**
 * Celebrity looks — the pure rules shared by the api (publish gate, public
 * reads, editorial checks, the library import), the workers (comment replies)
 * and the web. No I/O.
 *
 * Nothing here is a legal conclusion. Every rule below is a CONTROL that
 * keeps content hidden until a human (counsel, through the rights reviewer)
 * says otherwise; the wording is a draft pending counsel (docs/counsel-briefing.md
 * §4 and §10; the owner's brief of 2026-09-30, "CELEBRITY-LOOK COMMERCE").
 */

// ---------------------------------------------------------------------------
// Rights status and the capability matrix
// ---------------------------------------------------------------------------

/** celebrities.rights_status. Default 'unreviewed'. */
export const CELEBRITY_RIGHTS_STATUSES = ['unreviewed', 'editorial', 'cleared', 'blocked'] as const;
export type CelebrityRightsStatus = (typeof CELEBRITY_RIGHTS_STATUSES)[number];

/** What may be shown about a celebrity, least to most. */
export const CELEBRITY_DISPLAY_LEVELS = ['none', 'name_only', 'name_and_image'] as const;
export type CelebrityDisplayLevel = (typeof CELEBRITY_DISPLAY_LEVELS)[number];

/** looks.celebrity_display: the operator's choice for one look, capped by the celebrity's rights. */
export const LOOK_DISPLAY_MODES = ['name_only', 'name_and_image'] as const;
export type LookDisplayMode = (typeof LOOK_DISPLAY_MODES)[number];

export interface RightsCeiling {
  /** The most that may be shown about the celebrity. */
  display: CelebrityDisplayLevel;
  /** Whether a page that names or shows the celebrity may carry products and tracked links. */
  shoppable: boolean;
}

/**
 * THE CAPABILITY MATRIX — the one place that says what each rights status
 * allows at most. DEFAULTS PENDING COUNSEL: what 'editorial' and 'cleared'
 * mean is counsel's decision (docs/counsel-briefing.md §4, questions Q1–Q5);
 * the values below are the conservative defaults this build ships with.
 *
 *   unreviewed  nothing about the celebrity is published (no page names or
 *               shows them; no shoppable page) — the default for every
 *               celebrity the library import creates;
 *   blocked     the same, set by a reviewer (or any editor: restricting is
 *               always allowed);
 *   editorial   the name may appear in editorial copy; no image, and no
 *               page that names them carries products or links;
 *   cleared     counsel's explicit clearance (for example a written licence
 *               from the celebrity or their agency, owner action O2): name,
 *               image and a shoppable page AT MOST.
 *
 * The matrix is a ceiling. Each review records what counsel allowed for that
 * one celebrity (celebrities.max_display, celebrities.shoppable), and the
 * review route defaults both to the narrow end (name only, not shoppable):
 * an image or a shoppable page needs the reviewer to say so explicitly.
 * A minor, a never-listed celebrity or one under takedown gets nothing,
 * whatever the status (effectiveCelebrityRights).
 *
 * Changing a row here is the whole change when counsel decides otherwise
 * (a code change, reviewed like any other; the database stores only the
 * per-celebrity decisions, so no migration is needed).
 */
export const CELEBRITY_RIGHTS_MATRIX: Readonly<Record<CelebrityRightsStatus, RightsCeiling>> = {
  unreviewed: { display: 'none', shoppable: false },
  blocked: { display: 'none', shoppable: false },
  editorial: { display: 'name_only', shoppable: false },
  cleared: { display: 'name_and_image', shoppable: true },
};

/** Statuses under which anything may be published (for the SQL read gate). */
export function publishableRightsStatuses(): CelebrityRightsStatus[] {
  return CELEBRITY_RIGHTS_STATUSES.filter((s) => CELEBRITY_RIGHTS_MATRIX[s].display !== 'none');
}

/** Only these two may be set by a network_admin / editor (a restriction); everything else needs the rights reviewer. */
export const STATUSES_ANY_EDITOR_MAY_SET: readonly CelebrityRightsStatus[] = ['blocked'];

export function isRightsStatus(v: unknown): v is CelebrityRightsStatus {
  return typeof v === 'string' && (CELEBRITY_RIGHTS_STATUSES as readonly string[]).includes(v);
}

export function isDisplayLevel(v: unknown): v is CelebrityDisplayLevel {
  return typeof v === 'string' && (CELEBRITY_DISPLAY_LEVELS as readonly string[]).includes(v);
}

export function isLookDisplayMode(v: unknown): v is LookDisplayMode {
  return typeof v === 'string' && (LOOK_DISPLAY_MODES as readonly string[]).includes(v);
}

function levelRank(l: CelebrityDisplayLevel): number {
  return CELEBRITY_DISPLAY_LEVELS.indexOf(l);
}

/** The narrower of two display levels. */
export function minDisplayLevel(a: CelebrityDisplayLevel, b: CelebrityDisplayLevel): CelebrityDisplayLevel {
  return levelRank(a) <= levelRank(b) ? a : b;
}

/** True when `level` is within `ceiling`. */
export function displayWithin(level: CelebrityDisplayLevel, ceiling: CelebrityDisplayLevel): boolean {
  return levelRank(level) <= levelRank(ceiling);
}

export interface CelebrityRightsRow {
  rights_status: string;
  max_display: string;
  shoppable: boolean;
  is_minor: boolean;
  never_list: boolean;
  /** An active takedown of the celebrity (celebrities.takedown_id). */
  takedown_id: string | null;
}

/**
 * What may be shown about a celebrity right now: the matrix ceiling of the
 * status, narrowed by the review's own decision; nothing at all for a minor,
 * a never-listed celebrity or one under takedown. An unknown status is
 * treated as 'unreviewed'.
 */
export function effectiveCelebrityRights(row: CelebrityRightsRow): RightsCeiling {
  if (row.is_minor || row.never_list || row.takedown_id) return { display: 'none', shoppable: false };
  const ceiling = isRightsStatus(row.rights_status) ? CELEBRITY_RIGHTS_MATRIX[row.rights_status] : CELEBRITY_RIGHTS_MATRIX.unreviewed;
  const own = isDisplayLevel(row.max_display) ? row.max_display : 'none';
  const display = minDisplayLevel(ceiling.display, own);
  return { display, shoppable: display !== 'none' && ceiling.shoppable && row.shoppable === true };
}

// ---------------------------------------------------------------------------
// Assets: when an image may be shown
// ---------------------------------------------------------------------------

/** The territory Afflino shows images in (afflino.com is India-first). */
export const DISPLAY_TERRITORY = 'IN';

/** True when a licence territory ('IN', 'WW', or a list such as 'IN,AE') covers `territory`. */
export function territoryCovers(licenceTerritory: string | null | undefined, territory: string = DISPLAY_TERRITORY): boolean {
  if (!licenceTerritory) return false;
  const codes = licenceTerritory
    .toUpperCase()
    .split(/[\s,;/]+/)
    .filter((c) => c !== '');
  return codes.includes(territory.toUpperCase()) || codes.includes('WW') || codes.includes('WORLDWIDE');
}

export interface AssetLicenceRow {
  kind: string | null;
  public_url: string | null;
  license: string | null;
  commercial_reuse: string | null;
  territory: string | null;
  /** timestamptz: pg returns string or Date. */
  expires_at: string | Date | null;
  screen_status: string | null;
  minor_in_frame: boolean | null;
  bystanders: boolean | null;
  sensitive_location: boolean | null;
  live_performance: boolean | null;
  /** Chain of title (owner action O1): who owns the copyright, how the file was acquired, the written assignment. */
  copyright_owner?: string | null;
  acquisition?: string | null;
  assignment_ref?: string | null;
}

/** Acquisitions that need the written assignment or licence on record (assignment_ref): everything but staff work. */
export const ACQUISITIONS_NEEDING_ASSIGNMENT: readonly string[] = ['freelance', 'agency', 'licensed', 'other'];

/**
 * Why the chain of title of an asset is incomplete (empty = complete): the
 * copyright owner and the acquisition are recorded, and for anything but
 * staff work the written assignment or licence (assignment_ref; Copyright
 * Act s.19, the brief's §5, owner action O1).
 */
export function chainOfTitleRefusals(a: Pick<AssetLicenceRow, 'copyright_owner' | 'acquisition' | 'assignment_ref'>): string[] {
  const out: string[] = [];
  const blank = (v: string | null | undefined) => v === null || v === undefined || v.trim() === '';
  if (blank(a.copyright_owner) || blank(a.acquisition)) out.push('no_chain_of_title');
  else if (ACQUISITIONS_NEEDING_ASSIGNMENT.includes((a.acquisition as string).trim().toLowerCase()) && blank(a.assignment_ref)) out.push('no_chain_of_title');
  return out;
}

/**
 * Why an asset's image may NOT be shown (empty = it may): a public copy, a
 * still or cover, a licence allowing commercial reuse in India that has not
 * expired, a complete chain of title (copyright owner, acquisition, and the
 * written assignment for anything but staff work), and an editor's frame
 * screen passed; never a frame with a minor, bystanders, a sensitive
 * location (hospital, home, school, place of worship) or a live performance
 * (excluded by default: performers' rights, counsel Q13). The same rule
 * covers every place an image appears (look page, feed, hub, storefront,
 * the still's own address /img/looks/<id>).
 */
export function assetImageRefusals(a: AssetLicenceRow | null | undefined, now: number = Date.now()): string[] {
  if (!a) return ['no_image'];
  const out: string[] = [];
  if (!a.public_url) out.push('no_public_copy');
  if (a.kind !== 'still' && a.kind !== 'cover') out.push('not_a_still');
  if (!a.license || a.license.trim() === '') out.push('no_licence');
  if (a.commercial_reuse !== 'yes') out.push('commercial_reuse_not_allowed');
  if (!territoryCovers(a.territory)) out.push('territory_excludes_india');
  if (a.expires_at !== null && a.expires_at !== undefined) {
    const t = new Date(a.expires_at).getTime();
    if (Number.isNaN(t) || t <= now) out.push('licence_expired');
  }
  out.push(...chainOfTitleRefusals(a));
  if (a.screen_status !== 'passed') out.push('frame_not_screened');
  if (a.minor_in_frame) out.push('minor_in_frame');
  if (a.bystanders) out.push('bystanders_in_frame');
  if (a.sensitive_location) out.push('sensitive_location');
  if (a.live_performance) out.push('live_performance');
  return out;
}

export interface EffectiveLookDisplay {
  name: boolean;
  image: boolean;
  shoppable: boolean;
}

/** What one look shows: the look's own mode capped by the celebrity's rights, the image also by its asset. */
export function effectiveLookDisplay(
  rights: RightsCeiling,
  lookMode: string | null | undefined,
  still: AssetLicenceRow | null | undefined,
  now: number = Date.now(),
): EffectiveLookDisplay {
  const mode: CelebrityDisplayLevel = isLookDisplayMode(lookMode) ? lookMode : 'name_only';
  const level = minDisplayLevel(rights.display, mode);
  const name = level !== 'none';
  return {
    name,
    image: level === 'name_and_image' && assetImageRefusals(still, now).length === 0,
    shoppable: name && rights.shoppable,
  };
}

// ---------------------------------------------------------------------------
// Outfit pieces
// ---------------------------------------------------------------------------

/** look_pieces.garment_category (the migration's CHECK holds the same list; tested). */
export const GARMENT_CATEGORIES = [
  'top',
  'shirt',
  't_shirt',
  'kurta',
  'dress',
  'saree',
  'lehenga',
  'outerwear',
  'suit',
  'trousers',
  'jeans',
  'skirt',
  'shorts',
  'co_ord_set',
  'ethnic_set',
  'footwear',
  'bag',
  'eyewear',
  'watch',
  'jewellery',
  'belt',
  'headwear',
  'scarf',
  'other',
] as const;
export type GarmentCategory = (typeof GARMENT_CATEGORIES)[number];

export function isGarmentCategory(v: unknown): v is GarmentCategory {
  return typeof v === 'string' && (GARMENT_CATEGORIES as readonly string[]).includes(v);
}

/** looks.place_kind: coarse place only (never a residence, hospital, school or place of worship). */
export const PLACE_KINDS = ['event', 'venue', 'airport', 'street', 'studio', 'other'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export function isPlaceKind(v: unknown): v is PlaceKind {
  return typeof v === 'string' && (PLACE_KINDS as readonly string[]).includes(v);
}

/**
 * The place kinds a look is published from without anyone else's word: an
 * event, a public venue, an airport, a studio. A 'street' or 'other' moment
 * (where no word list can tell a residence gate or a clinic's pavement from
 * a public street) is published only after the rights reviewer confirmed its
 * place (looks.place_confirmed_by; counsel's list, Q6).
 */
export const PLACE_KINDS_WITHOUT_CONFIRMATION: readonly PlaceKind[] = ['event', 'venue', 'airport', 'studio'];

/** look_items.match_type (domain.ts MatchType is the same union). */
export const MATCH_TYPES = ['exact', 'similar'] as const;
type MatchType = (typeof MATCH_TYPES)[number];

/** Minimum length of the evidence text behind an EXACT tag (the migration's CHECK uses the same number). */
export const EXACT_EVIDENCE_MIN_CHARS = 10;

// ---------------------------------------------------------------------------
// Wording (DRAFTS PENDING COUNSEL, Q7–Q11)
// ---------------------------------------------------------------------------

export const CELEBRITY_COPY = {
  /** At the top of every look page and every celebrity page (ASCI: upfront, not buried). */
  commercialLabel: 'Ad · This page has affiliate links',
  /** Beside the name wherever a celebrity is named, same language and type size as the claim. */
  nonEndorsement: (name: string) => `${name} is not affiliated with Afflino and has not endorsed any product on this page.`,
  /** An approved EXACT item (evidence on record, a second person's review). */
  exactItem: 'The same item',
  exactDetail: "Identified by Afflino's editors from the evidence on record.",
  /** Heading above a piece's SIMILAR items. */
  similarHeading: 'Similar styles',
  /** Every SIMILAR item carries this line (the brief's B3 wording). */
  similarItem: (name: string) => `Similar style. ${name} did not wear or endorse this product.`,
} as const;

/**
 * The public headline of a celebrity look, composed from structured fields
 * (free-text titles never reach a page): "Spotted at <event>", "Spotted in
 * <place>", or "Spotted". It never carries the celebrity's name: a headline
 * is set far larger than body text, and the name appears only in the credit
 * line, which carries the non-endorsement line in the same sentence and at
 * the same size (CCPA 2022 cl.11: "the font used in a disclaimer shall be
 * the same"; the brief's B3). The event and place are the editors' words,
 * checked for endorsement wording, sensitive places and any celebrity's name
 * before they are stored, at publish and again at every public read.
 */
export function lookHeadline(opts: { event: string | null; place: string | null }): string {
  const event = opts.event?.trim() || null;
  const place = opts.place?.trim() || null;
  if (event) return `Spotted at ${event}`;
  if (place) return `Spotted in ${place}`;
  return 'Spotted';
}

/** Per item: the wording the page shows for an EXACT or SIMILAR product. */
export function itemWording(match: MatchType, celebrityName: string): { label: string; detail: string } {
  if (match === 'exact') return { label: CELEBRITY_COPY.exactItem, detail: CELEBRITY_COPY.exactDetail };
  return { label: CELEBRITY_COPY.similarHeading, detail: CELEBRITY_COPY.similarItem(celebrityName) };
}

// ---------------------------------------------------------------------------
// Text checks
// ---------------------------------------------------------------------------

/** NFKC, lower case, every run of non-letters/digits collapsed to one space, trimmed. */
export function normaliseForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}

/** A celebrity's name key (celebrities.name_key): the matching form of the name. */
export function celebrityNameKey(name: string): string {
  return normaliseForMatch(name);
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/** The matching tokens of a text: normalised words, a standalone number 0–20 written as its word ("Demo Star 1" = "demo star one"). */
function matchTokens(text: string): string[] {
  return normaliseForMatch(text)
    .split(' ')
    .filter((t) => t !== '')
    .map((t) => (/^\d{1,2}$/.test(t) && Number(t) <= 20 ? (NUMBER_WORDS[Number(t)] as string) : t));
}

/**
 * True when `text` names any of `names` (normalised; numbers 0–20 match
 * their words): as whole words ("Demo Star One" in "demo-star-one's bag",
 * "Demo Star 1 jacket"), glued across neighbouring words ("DemoStarOne
 * jacket", "Demo StarOne"), or, for a name of two or more words with 8+
 * letters, inside one handle-like word ("demostartwofans"). A different word
 * that only starts with the name ("Demo Star Oneplus") is not a match.
 */
export function mentionsName(text: string | null | undefined, names: readonly string[]): boolean {
  if (!text) return false;
  const hay = matchTokens(text);
  if (hay.length === 0) return false;
  return names.some((n) => {
    const needle = matchTokens(n);
    if (needle.length === 0) return false;
    const words = needle.join(' ');
    for (let i = 0; i + needle.length <= hay.length; i += 1) if (hay.slice(i, i + needle.length).join(' ') === words) return true;
    const compact = needle.join('');
    for (let i = 0; i < hay.length; i += 1) {
      let acc = '';
      for (let j = i; j < hay.length && acc.length < compact.length; j += 1) {
        acc += hay[j];
        if (acc === compact) return true;
      }
    }
    return needle.length >= 2 && compact.length >= 8 && hay.some((t) => t.length > compact.length && t.includes(compact));
  });
}

/** A celebrity as the name checks see it: the name and its aliases. */
export interface NamedCelebrity {
  id: string;
  name: string;
  aliases?: readonly string[] | null;
}

/** The celebrities that `text` names (by name or alias; mentionsName), each once, in the given order. */
export function namedCelebrities<T extends NamedCelebrity>(text: string | null | undefined, celebrities: readonly T[]): T[] {
  if (!text) return [];
  return celebrities.filter((c) => mentionsName(text, [c.name, ...(c.aliases ?? [])]));
}

/** A URL-safe slug: ASCII letters and digits joined by single hyphens, at most `max` characters. */
export function slugify(text: string, max = 60): string {
  const s = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, max).replace(/-+$/g, '');
}

export function isSlug(v: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) && v.length <= 80;
}

interface Pattern {
  code: string;
  re: RegExp;
}

/** Garments and belongings a possessive ("her bag") turns into the celebrity's own. */
const BELONGINGS =
  'bag|bags|clutch|purse|tote|shoes?|sneakers?|heels|sandals|boots|loafers|look|looks|outfits?|style|dress|dresses|shirt|tee|top|jacket|blazer|coat|kurta|saree|sari|lehenga|jeans|trousers|pants|skirt|sunglasses|shades|glasses|watch|jewell?ery|necklace|earrings|belt|cap|hat|scarf|wardrobe|fit|ootd|closet';

/**
 * Phrases that say or imply a celebrity wore, owns, chose, loves or
 * recommends a product, or that trade on the original ("dupe", "for less",
 * "first copy", "<Brand> style", "inspired", savings claims). Refused in
 * every product text (brand, model, category — the operator's own words),
 * and, but for the few that only make sense about a product, in the look's
 * own text and in public replies. English only (a Hindi list is a
 * counsel / owner item, Q11).
 */
const ENDORSEMENT_PATTERNS: readonly Pattern[] = [
  { code: 'worn_by', re: /(\bworn\s+(by|at|on)\b|\bwore\b)/i },
  { code: 'wears', re: /\b(she|he|they|who)\s+(wears|is\s+wearing|was\s+wearing|are\s+wearing)\b/i },
  { code: 'owns', re: /(\b(she|he|they|who)\s+(owns?|has|had|have)\b|\bowned\s+by\b)/i },
  { code: 'celebrity_reference', re: /(\bcelebs?\b|\bcelebrit(y|ies)\b|\bthe\s+star\b|\bbollywood\b)/i },
  { code: 'loves', re: /\blov(e|es|ed|ing)\b/i },
  { code: 'recommends', re: /\brecommend(s|ed|ation|ations)?\b/i },
  { code: 'endorses', re: /\bendors(e|es|ed|ement)\b/i },
  { code: 'favourite', re: /\bfavou?rites?\b/i },
  { code: 'pick', re: /(\b(her|his|their|my)\s+picks?\b|'s\s+picks?\b)/i },
  { code: 'choice', re: /\b(her|his|their|my)\s+choice\b/i },
  { code: 'dupe', re: /\bdupes?\b/i },
  { code: 'for_less', re: /\bfor\s+less\b/i },
  { code: 'inspired_by', re: /\binspired\b|\binspo\b/i },
  { code: 'brand_style', re: /(\w-style\b|\bstyle\s+of\b|\b\w+'s\s+style\b)/i },
  { code: 'replica', re: /\b(replicas?|imitations?|knock[\s-]?offs?|fakes?)\b/i },
  { code: 'first_copy', re: /(\b(first|1st|master|mirror)[\s-]+copy\b|\bcopy\s+of\b|\b7a\b|\baaa\+?\s+(quality|copy)\b)/i },
  { code: 'lookalike', re: /(\blook[\s-]?alikes?\b|\bclones?\b|\btwinning\b)/i },
  { code: 'as_seen', re: /(\bas\s+seen\s+(on|at|in|with)\b|\bseen\s+(on|with)\b)/i },
  { code: 'spotted_wearing', re: /\bspotted\s+(in|wearing|with|carrying|sporting)\b/i },
  { code: 'same_as', re: /(\bsame\s+as\b|\b(like|as)\s+(hers|his|theirs)\b|\b(exactly|just)\s+like\b|\bsame\s+\w+\s+(she|he|they)\b|\bidentical\s+to\b)/i },
  { code: 'steal_the_look', re: /(\bsteal\s+(her|his|their|the)\s+(look|style)\b|\bget\s+(her|his|their|the)\s+(look|style|vibe)\b|\brecreate\s+(her|his|their|the)\b)/i },
  { code: 'budget_version', re: /\b(budget|affordable|cheap|pocket[\s-]?friendly)\s+(version|alternative|option|pick|take)s?\b/i },
  { code: 'savings_claim', re: /(\bsave\b|\bsavings?\b|\bcheaper\b|\b\d+\s*%\s*(off|less|cheaper)\b|\bfraction\s+of\s+the\s+(price|cost)\b)/i },
  { code: 'first_person', re: /(\bi'?m\s+wearing\b|\bi\s+am\s+wearing\b|\bmy\s+(look|outfit|style)\b)/i },
  // Product text only (below): an ordinary look label ("her bag") or event name ("… Style Awards") is fine.
  { code: 'word_style', re: /\b[\p{L}\p{N}]+\s+style\b/iu },
  { code: 'possessive', re: new RegExp(`\\b(her|his|their)\\s+([\\w-]+\\s+)?(${BELONGINGS})\\b`, 'i') },
  { code: 'rocked', re: /(\b(rocked|rocking|slayed|slaying|nailed|flaunted|flaunting|sported|sporting)\b|\b(rocks|slays|nails|flaunts)\s+(this|it|the|that|her|his)\b)/i },
];

/** Codes that only make sense about a product (never refused in the look's own text). */
const PRODUCT_ONLY = ['word_style', 'possessive', 'rocked'];

/** Refused in the look's own text (event, place, piece labels) and in storefront text: Amazon is never linked with a celebrity (PR 11). */
const LOOK_TEXT_PATTERNS: readonly Pattern[] = [
  ...ENDORSEMENT_PATTERNS.filter((p) => !['wears', 'worn_by', 'owns', 'celebrity_reference', ...PRODUCT_ONLY].includes(p.code)),
  { code: 'amazon', re: /\bamazon\b/i },
];

/** Refused in a public comment reply (it is posted under the celebrity's post): every endorsement phrase, and Amazon. */
const REPLY_TEXT_PATTERNS: readonly Pattern[] = [...ENDORSEMENT_PATTERNS.filter((p) => p.code !== 'word_style'), { code: 'amazon', re: /\bamazon\b/i }];

/**
 * Words that point at a place a look never comes from (hospitals and clinics,
 * homes and residential gates, schools and classes, places of worship: the
 * brief's §6 and Meta's Privacy Violations policy). English plus common
 * Indian terms; a hit refuses the row (the operator rewrites the place
 * coarsely). No list can catch a named residence: a 'street' or 'other'
 * place also needs the rights reviewer's confirmation to publish
 * (PLACE_KINDS_WITHOUT_CONFIRMATION).
 */
const SENSITIVE_PLACE_RE = new RegExp(
  '\\b(' +
    [
      // medical
      'hospitals?', 'clinics?', 'nursing\\s+home', 'maternity', 'icu', 'doctors?', "doctor's", 'dermatologists?', 'dentists?', 'dental',
      'diagnostics?', 'pathology', 'path\\s+lab', 'ivf', 'fertility', 'rehab', 'rehabilitation', 'pharmacy', 'chemist',
      'physio', 'physiotherapy', 'therapist', 'dialysis', 'scan\\s+centre', 'medical',
      // homes
      'residences?', 'residential', 'residency', 'home', 'homes', 'house', 'bungalow', 'apartments?', 'flat', 'flats', 'building',
      'tower', 'towers', 'society', 'society\\s+gate', 'villa', 'villas', 'penthouse', 'duplex', 'chawl', 'colony', 'gated',
      // schools and classes
      'schools?', 'college', 'kindergarten', 'creche', 'playschool', 'play\\s+school', 'preschool', 'pre-school', 'daycare', 'day\\s+care',
      'nursery', 'classes', '(dance|music|art|drawing|swimming|karate|ballet|tuition|coaching)\\s+class', 'tuitions?', 'coaching',
      // worship and last rites
      'temples?', 'mandir', 'mosque', 'masjid', 'dargah', 'church', 'gurudwara', 'gurdwara', 'synagogue', 'monastery',
      'cemetery', 'crematorium', 'funeral', 'shamshan', 'burial',
    ].join('|') +
    ')\\b',
  'i',
);

export function endorsementFindings(text: string | null | undefined): string[] {
  if (!text) return [];
  return ENDORSEMENT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.code);
}

export function lookTextFindings(text: string | null | undefined): string[] {
  if (!text) return [];
  return LOOK_TEXT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.code);
}

/** Findings in a public comment reply's text (every endorsement phrase and Amazon). */
export function replyTextFindings(text: string | null | undefined): string[] {
  if (!text) return [];
  return REPLY_TEXT_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.code);
}

export function sensitivePlaceFinding(text: string | null | undefined): boolean {
  return !!text && SENSITIVE_PLACE_RE.test(text);
}

/**
 * Why a SIMILAR product's own text may not be tagged into a celebrity's
 * outfit (empty = it may): no endorsement phrase and no mention of the
 * celebrity's name or aliases.
 */
export function similarTextRefusals(fields: Array<string | null | undefined>, celebrityNames: readonly string[]): string[] {
  const out = new Set<string>();
  for (const f of fields) {
    for (const code of endorsementFindings(f)) out.add(code);
    if (mentionsName(f, celebrityNames)) out.add('names_the_celebrity');
  }
  return [...out];
}

/**
 * Why a product's own text (brand, model, category) may not stand in any
 * celebrity's outfit, whatever its match (empty = it may): no endorsement
 * phrase, and no celebrity of the organisation named (EXACT or SIMILAR: no
 * copy links a product — or Amazon — with a person; the name appears only
 * in the look's credit line). `names` are every celebrity's name and
 * aliases; `own` the look's own celebrity's (SIMILAR items also must not
 * name them, which `names` already covers).
 */
export function productTextRefusals(fields: Array<string | null | undefined>, celebrities: readonly NamedCelebrity[]): string[] {
  const out = new Set<string>();
  for (const f of fields) {
    for (const code of endorsementFindings(f)) out.add(code);
    if (namedCelebrities(f, celebrities).length > 0) out.add('names_a_celebrity');
  }
  return [...out];
}
