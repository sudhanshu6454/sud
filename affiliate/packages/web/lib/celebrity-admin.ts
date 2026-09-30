/**
 * The operator screens for celebrity looks (admin: celebrities and their
 * rights, the library import, the looks pipeline and the outfit editor,
 * takedowns, instant links, comment replies, analytics): the v1 wire types
 * they read (packages/api/src/routes/{celebrities,editorial,takedowns,
 * replies,analytics}.ts, docs/openapi.yaml) and the pure display rules.
 * No React, relative imports only (test/celebrity-admin.test.ts).
 *
 * Nothing here decides a right: the API enforces every rule (the rights
 * reviewer alone sets 'editorial' / 'cleared'; EXACT needs evidence and a
 * second person; the publish gate; takedowns). The screens show what the
 * API says and explain it plainly.
 */
import { csvRow } from './csv';

/* ---------- celebrities ---------- */

export type RightsStatus = 'unreviewed' | 'editorial' | 'cleared' | 'blocked';
export type DisplayLevel = 'none' | 'name_only' | 'name_and_image';

export const RIGHTS_STATUSES: readonly RightsStatus[] = ['unreviewed', 'editorial', 'cleared', 'blocked'];

export interface RightsCeiling {
  display: DisplayLevel;
  shoppable: boolean;
}

export interface CelebrityView {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  is_minor: boolean;
  never_list: boolean;
  rights_status: RightsStatus | string;
  max_display: DisplayLevel | string;
  shoppable: boolean;
  rights_note: string | null;
  rights_evidence_ref: string | null;
  rights_reviewed_by: string | null;
  rights_reviewed_at: string | null;
  takedown_id: string | null;
  effective: RightsCeiling;
  created_at: string | null;
  updated_at: string | null;
}

export interface CelebrityList {
  items: CelebrityView[];
  matrix: Record<string, RightsCeiling>;
}

export interface RightsReviewRow {
  id: string;
  kind: string;
  rights_status: string;
  max_display: string;
  shoppable: boolean;
  note: string | null;
  evidence_ref: string | null;
  reviewed_by: string;
  reviewed_role: string;
  reviewed_at: string | null;
}

export interface CelebrityDetail extends CelebrityView {
  reviews: RightsReviewRow[];
  looks: Array<{ id: string; status: string; title: string }>;
}

/** The capability matrix as the API ships it (packages/shared/src/celebrity.ts; a default pending counsel). */
export const DEFAULT_MATRIX: Record<RightsStatus, RightsCeiling> = {
  unreviewed: { display: 'none', shoppable: false },
  blocked: { display: 'none', shoppable: false },
  editorial: { display: 'name_only', shoppable: false },
  cleared: { display: 'name_and_image', shoppable: true },
};

export function statusLabel(s: string): string {
  switch (s) {
    case 'unreviewed':
      return 'Unreviewed';
    case 'editorial':
      return 'Editorial';
    case 'cleared':
      return 'Cleared';
    case 'blocked':
      return 'Blocked';
    default:
      return s;
  }
}

export function displayLabel(d: string): string {
  if (d === 'name_and_image') return 'Name and image';
  if (d === 'name_only') return 'Name only';
  if (d === 'none') return 'Nothing';
  return d;
}

/** What a status allows at most, in words ("Name and image, with products" / "Nothing is published"). */
export function allowsText(c: RightsCeiling): string {
  if (c.display === 'none') return 'Nothing is published';
  return `${displayLabel(c.display)}${c.shoppable ? ', with products' : ', no products'}`;
}

/** The Tag tone of a status: cleared accent, editorial outline, blocked ink, unreviewed neutral. */
export function statusTone(s: string): 'accent' | 'outline' | 'ink' | 'neutral' {
  if (s === 'cleared') return 'accent';
  if (s === 'editorial') return 'outline';
  if (s === 'blocked') return 'ink';
  return 'neutral';
}

export interface ReviewDraft {
  rights_status: RightsStatus;
  max_display: DisplayLevel;
  shoppable: boolean;
  evidence_ref: string;
  note: string;
}

/**
 * Why a review may not be sent yet (empty = it may). The screen asks for a
 * note on every change (the owner's rule: changes need a note); the API
 * requires the evidence reference and the note for editorial / cleared and
 * never lets a review exceed the status's ceiling.
 */
export function reviewProblems(d: ReviewDraft, role: string | null, matrix: Record<string, RightsCeiling> = DEFAULT_MATRIX): string[] {
  const out: string[] = [];
  const ceiling = matrix[d.rights_status] ?? DEFAULT_MATRIX.unreviewed;
  if (d.note.trim().length < 3) out.push('Write a note: why this status (every change needs one).');
  if ((d.rights_status === 'editorial' || d.rights_status === 'cleared') && d.evidence_ref.trim().length < 3) {
    out.push("Give the evidence reference (counsel's written advice or the licence).");
  }
  const rank = (l: string) => ['none', 'name_only', 'name_and_image'].indexOf(l);
  // Only a 'cleared' decision carries its own display level and products (reviewBody).
  if (d.rights_status === 'cleared' && rank(d.max_display) > rank(ceiling.display)) out.push(`${statusLabel(d.rights_status)} allows at most: ${displayLabel(ceiling.display)}.`);
  if (d.rights_status === 'cleared' && d.shoppable && !ceiling.shoppable) out.push(`${statusLabel(d.rights_status)} never allows products.`);
  if (role && role !== 'rights_reviewer' && d.rights_status !== 'blocked') out.push('Only the rights reviewer (counsel) sets this status; your role can set Blocked.');
  return out;
}

/** The review body the API takes (max_display only where the status allows something). */
export function reviewBody(d: ReviewDraft): Record<string, unknown> {
  const allows = d.rights_status === 'editorial' || d.rights_status === 'cleared';
  return {
    rights_status: d.rights_status,
    ...(allows ? { max_display: d.rights_status === 'editorial' ? 'name_only' : d.max_display } : {}),
    shoppable: d.rights_status === 'cleared' ? d.shoppable : false,
    note: d.note.trim(),
    evidence_ref: d.evidence_ref.trim() || null,
  };
}

/* ---------- editorial looks ---------- */

export type LookStatus = 'draft' | 'in_review' | 'ready' | 'published' | 'paused' | 'withdrawn';

export const LOOK_COLUMNS: ReadonlyArray<{ id: LookStatus; label: string }> = [
  { id: 'draft', label: 'Draft' },
  { id: 'in_review', label: 'In review' },
  { id: 'ready', label: 'Ready' },
  { id: 'published', label: 'Published' },
  { id: 'paused', label: 'Paused' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

export function lookStatusLabel(s: string): string {
  return LOOK_COLUMNS.find((c) => c.id === s)?.label ?? s;
}

export interface EditorialLookRow {
  id: string;
  title: string;
  status: LookStatus | string;
  library_ref: string | null;
  event: string | null;
  moment_date: string | null;
  published_at: string | null;
  takedown_id: string | null;
  /** EXACT tags waiting for their second person (the reviewer's queue). */
  pending_exact?: number;
  celebrity: { id: string; name: string; rights_status: string };
}

export interface GateCheck {
  code: string;
  ok: boolean;
  detail?: string;
}

export interface GateReport {
  ok: boolean;
  checks: GateCheck[];
}

export interface OfferView {
  id: string;
  connector: string | null;
  merchant: { name: string };
  price_minor: number | null;
  price_as_of: string | null;
  currency: string;
  stock_status: string;
  disclosure: string | null;
}

export interface EditorialItem {
  id: string;
  match_type: 'exact' | 'similar';
  review_state: 'pending' | 'approved';
  position: number;
  evidence: string | null;
  evidence_source: string | null;
  evidence_captured_at: string | null;
  tagged_by: string | null;
  match_reviewed_by: string | null;
  match_reviewed_at: string | null;
  product: { id: string; brand: string; model: string; category: string };
  variant: { id: string; size_text: string | null; colour: string | null; merchant_sku: string | null };
  offer: OfferView | null;
  links: Array<{ id: string; url: string; property_id: string; offer_id: string }>;
}

export interface EditorialPiece {
  id: string;
  label: string;
  category: string;
  position: number;
  hotspot: { x: number; y: number } | null;
  items: EditorialItem[];
}

export interface EditorialLook {
  id: string;
  title: string;
  status: LookStatus | string;
  published_at: string | null;
  withdrawn_at: string | null;
  takedown_id: string | null;
  library_ref: string | null;
  celebrity_display: 'name_only' | 'name_and_image' | string;
  celebrity: {
    id: string;
    name: string;
    slug: string;
    rights_status: string;
    max_display: string;
    shoppable: boolean;
    takedown_id: string | null;
    effective: RightsCeiling;
  } | null;
  moment: {
    event: string | null;
    place: string | null;
    place_kind: string | null;
    date: string | null;
    place_confirmed_by?: string | null;
    place_confirmed_at?: string | null;
  };
  property: { id: string; platform: string; external_account_id: string; canonical_url: string | null; status: string; owner_operated: boolean } | null;
  post: { platform_post_id: string | null; permalink: string | null };
  storefront: { id: string; slug: string; display_name: string; bio: string | null; status: string } | null;
  still: {
    id: string;
    storage_key: string;
    public_url: string | null;
    licence: {
      license: string | null;
      commercial_reuse: string | null;
      territory: string | null;
      expires_at: string | null;
      source_ref: string | null;
      copyright_owner: string | null;
      author: string | null;
      acquisition: string | null;
      assignment_ref: string | null;
    };
    flags: { live_performance: boolean | null; minor_in_frame: boolean | null; bystanders: boolean | null; sensitive_location: boolean | null };
    screen_status: string | null;
  } | null;
  display: { name: boolean; image: boolean; shoppable: boolean };
  pieces: EditorialPiece[];
  gate: GateReport;
  look_url: string;
}

/** The publish gate's checks in plain words (the API's `detail` says what is wrong). */
export const GATE_LABELS: Record<string, string> = {
  celebrity: 'The look names its celebrity',
  no_takedown: 'No takedown is active',
  not_withdrawn: 'The look is not withdrawn',
  not_minor_or_never_list: 'Not a minor, not on the never-list',
  rights_status: "The celebrity's rights allow publishing",
  display_mode: "The look shows no more than the rights allow",
  image_licence: 'The still may be shown (licence, territory, expiry, frame screen)',
  moment_date: 'The moment has a date in the past (never live whereabouts)',
  in_house_page: 'An approved, owner-operated Facebook or Instagram page published it',
  wording: 'No endorsement wording and no sensitive place',
  no_names_in_text: 'No celebrity is named in the event, place or piece labels',
  place_kind: 'A kind of place that may be published (street or other: the rights reviewer confirms it)',
  product_text: 'No product text names a celebrity or uses endorsement wording',
  pieces: 'The outfit has at least one piece',
  every_piece_has_a_product: 'Every piece has a product',
  exact_reviewed: 'Every EXACT tag has a second person’s approval',
  live_offers: 'Every piece has a live offer',
  link_rules: 'Tracked links can be made for this page (the Amazon rules)',
};

export function gateLabel(code: string): string {
  return GATE_LABELS[code] ?? code.replace(/_/g, ' ');
}

/** The transitions an editor may ask for from a status (the API decides; publish runs the gate). */
export function nextStatuses(status: string): Array<{ to: LookStatus; label: string }> {
  switch (status) {
    case 'draft':
      return [{ to: 'in_review', label: 'Send to review' }];
    case 'in_review':
      return [
        { to: 'ready', label: 'Mark ready' },
        { to: 'draft', label: 'Back to draft' },
      ];
    case 'ready':
      return [
        { to: 'published', label: 'Publish' },
        { to: 'in_review', label: 'Back to review' },
      ];
    case 'published':
      return [{ to: 'paused', label: 'Unpublish (pause)' }];
    case 'paused':
      return [
        { to: 'published', label: 'Publish again' },
        { to: 'draft', label: 'Back to draft' },
      ];
    default:
      return [];
  }
}

/** Pieces in order with EXACT first, then SIMILAR by position (what the look page shows). */
export function sortedItems(items: ReadonlyArray<EditorialItem>): EditorialItem[] {
  return [...items].sort((a, b) => (a.match_type === b.match_type ? a.position - b.position : a.match_type === 'exact' ? -1 : 1));
}

/** The minimum evidence the API accepts for an EXACT tag (packages/shared EXACT_EVIDENCE_MIN_CHARS). */
export const EXACT_EVIDENCE_MIN_CHARS = 10;

export interface TagDraft {
  match_type: 'exact' | 'similar';
  evidence: string;
  evidence_source: string;
  /** The pasted amazon.in link or ASIN (checked when given). */
  input?: string;
  brand?: string;
  model?: string;
}

/**
 * Why a tag may not be sent (empty = it may), for every match: the product
 * link or ASIN, the brand and the product in the operator's words; EXACT
 * also its evidence and where it comes from.
 */
export function tagProblems(d: TagDraft): string[] {
  const out: string[] = [];
  if (d.input !== undefined && !looksLikeProductInput(d.input)) out.push('Paste an amazon.in link or a 10-character ASIN.');
  if (d.brand !== undefined && d.brand.trim() === '') out.push('Brand is needed.');
  if (d.model !== undefined && d.model.trim() === '') out.push('Product is needed.');
  if (d.match_type !== 'exact') return out;
  if (d.evidence.trim().length < EXACT_EVIDENCE_MIN_CHARS) out.push(`EXACT needs the evidence: what shows it is the same item (at least ${EXACT_EVIDENCE_MIN_CHARS} characters).`);
  if (d.evidence_source.trim().length < 3) out.push('EXACT needs the evidence source (a URL or file reference).');
  return out;
}

/**
 * A 10-character ASIN or an https product URL, as pasted (the API alone
 * decides whether it is an Amazon.in product: no merchant host is named in
 * the web's sources).
 */
export function looksLikeProductInput(v: string): boolean {
  const t = v.trim();
  return /^[A-Z0-9]{10}$/i.test(t) || (/^https:\/\/[^\s]+$/i.test(t) && t.length <= 500);
}

/** Hotspot from a click on the still preview: 0..1, 4 decimals. */
export function hotspotFrom(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10_000) / 10_000;
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

export const GARMENT_CATEGORIES = [
  'top', 'shirt', 't_shirt', 'kurta', 'dress', 'saree', 'lehenga', 'outerwear', 'suit', 'trousers', 'jeans', 'skirt',
  'shorts', 'co_ord_set', 'ethnic_set', 'footwear', 'bag', 'eyewear', 'watch', 'jewellery', 'belt', 'headwear', 'scarf', 'other',
] as const;

export const PLACE_KINDS = ['event', 'venue', 'airport', 'street', 'studio', 'other'] as const;

/* ---------- takedowns ---------- */

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

export function reasonLabel(r: string): string {
  const words = r.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface TakedownView {
  id: string;
  scope: 'celebrity' | 'look' | string;
  celebrity_id: string | null;
  look_id: string | null;
  reason_code: string;
  reason_note: string | null;
  requester_ref: string | null;
  requested_at: string | null;
  actioned_at: string | null;
  completed_at: string | null;
  actioned_by: string;
  status: 'active' | 'restored' | string;
  restored_at: string | null;
  restored_by: string | null;
  restore_note: string | null;
  looks_withdrawn: number;
  links_paused: number;
  rules_disabled: number;
  minutes_to_action: number | null;
  sla: 'ok' | 'warn' | 'breach' | null;
}

export interface TakedownLook {
  look_id: string;
  previous_status: string;
  post_removed_at: string | null;
  platform: string | null;
  account: string | null;
  post_permalink: string | null;
  platform_post_id: string | null;
}

export interface TakedownDetail extends TakedownView {
  looks: TakedownLook[];
}

export interface TakedownResult {
  takedown: TakedownView;
  created: boolean;
  looks_withdrawn: number;
  links_paused: number;
  rules_disabled: number;
  replies_cancelled: number;
  posts_to_delete: Array<{ look_id: string; platform: string | null; account: string | null; post_permalink: string | null; platform_post_id: string | null }>;
  /** Other looks whose text named the person taken down (withdrawn too). */
  looks_named_in_text?: string[];
  other_links_paused?: number;
  stills?: Array<{ look_id: string; asset_id: string; source_ref: string | null; public_url: string | null }>;
  /** afflino.com addresses whose link previews Meta should scrape again. */
  share_urls?: string[];
}

export function slaLabel(sla: string | null, minutes: number | null): string {
  if (minutes === null) return '—';
  const m = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  if (sla === 'breach') return `${m} (over 3 h)`;
  if (sla === 'warn') return `${m} (over 1 h)`;
  return m;
}

/** A datetime-local value (IST) → ISO with offset, for requested_at; '' → null. */
export function istLocalToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const t = new Date(`${v}:00+05:30`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/* ---------- comment replies ---------- */

export interface ReplyRule {
  id: string;
  look_id: string;
  property_id: string;
  platform_post_id: string;
  keywords: string[];
  public_reply: string | null;
  enabled: boolean;
  disabled_by_takedown_id: string | null;
  created_at: string | null;
  look_url: string;
  dm_preview: string | null;
  dm_bytes: number | null;
  dm_refusal: string | null;
}

export interface ReplyEvent {
  id: string;
  rule_id: string;
  look_id: string;
  property_id: string;
  account: string;
  platform: string;
  matched_keyword: string;
  status: string;
  attempts: number;
  error_code: string | null;
  public_reply_status: string | null;
  received_at: string | null;
  sent_at: string | null;
}

export interface MetaAccount {
  id: string;
  property_id: string;
  platform: string;
  meta_account_id: string;
  linked_page_id: string | null;
  messaging_status: string;
  last_error_code: string | null;
  paused_until: string | null;
  checked_at: string | null;
  account: string;
}

/** Keywords typed as "link, price, shop" → the list (the API normalises and checks them). */
export function parseKeywords(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((k) => k.trim()).filter((k) => k !== ''))].slice(0, 10);
}

/** The public comment answer is text only (the API refuses links too). */
/**
 * The public answers a rule may post under the post (the API's fixed texts,
 * @paparazzi/shared PUBLIC_REPLY_TEMPLATES, drafts pending counsel): never
 * free text under a celebrity's post. The screen offers the API's list
 * (GET /v1/replies/rules → public_reply_templates); this copy is the demo's
 * (shared's replies.test.ts checks the two agree).
 */
export const PUBLIC_REPLY_TEMPLATES: readonly string[] = [
  'We sent you a message with the link.',
  'Check your messages: the link is there.',
  'Sent. The link is in your messages.',
];

export function publicReplyProblem(text: string, templates: readonly string[] = PUBLIC_REPLY_TEMPLATES): string | null {
  if (text.trim() === '') return null;
  return templates.includes(text.trim()) ? null : 'Choose one of the fixed answers (no free text goes under a post).';
}

export function eventStatusLabel(s: string): string {
  const words = s.replace(/^skipped_/, 'skipped: ').replace(/^failed_/, 'failed: ').replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ---------- properties, instant links ---------- */

export interface PropertyRow {
  id: string;
  platform: string;
  account: string;
  url: string | null;
  status: string;
  owner_operated: boolean;
  amazon_tracking_id: string | null;
  storefront: { id: string; slug: string; status: string } | null;
}

/** Pages an Amazon link may go on: approved, owner-operated, with its own tracking ID. */
export function linkablePages(rows: ReadonlyArray<PropertyRow>): PropertyRow[] {
  return rows.filter((r) => r.status === 'approved' && r.owner_operated && !!r.amazon_tracking_id);
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

export interface InstantLinksResult {
  asin: string;
  offer: { id: string; variant_id: string; product_id: string; created: boolean; status: string; fresh_until: string };
  item: { item_id: string; match_type: string; review_state: string } | null;
  links: InstantLinkRow[];
  links_withheld: string | null;
  look_url: string | null;
  message_rule: string;
}

/* ---------- library ---------- */

export interface LibraryCheck {
  dry_run: true;
  ok: boolean;
  problems: string[];
  rows: number;
  looks: number;
  looks_new: number;
  looks_existing: number;
  pieces: number;
  /** Looks that take their licence from the owner's ownership statement (rows without licence columns). */
  licence_from_statement?: number;
  ownership_statement?: OwnershipStatementRef | null;
  celebrities: Array<{ name: string; known: boolean; rights_status: string | null; looks: number }>;
}

/** The owner's statement that the organisation owns its library footage (recorded on the server: looks.sh owned). */
export interface OwnershipStatementRef {
  id: string;
  copyright_owner: string;
  acquisition: string;
  recorded_at: string;
}

export interface LibrarySummary {
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
  created_looks: Array<{ key: string; look_id: string; celebrity: string; celebrity_status: string }>;
  licence_from_statement?: number;
  ownership_statement?: OwnershipStatementRef | null;
  /** Assets whose licence a person set: the file's widening changes were not applied. */
  licence_kept?: Array<{ kind: string; ref: string; kept: string[] }>;
}

/** The library file's columns (packages/api/src/looks/library-import.ts), for the screen and the runbook. */
export const LIBRARY_COLUMNS: ReadonlyArray<{ name: string; required: boolean; what: string }> = [
  { name: 'video_ref', required: true, what: 'The source video in the library (one look per video; add moment_ref for several moments in one video)' },
  { name: 'celebrity', required: true, what: 'The full name; a new name is created unreviewed' },
  { name: 'moment_date', required: true, what: 'YYYY-MM-DD, in the past' },
  { name: 'still_ref', required: true, what: 'The still in the library' },
  { name: 'licence', required: false, what: 'Blank on every licence column = the owner’s ownership statement (looks.sh owned): commercial use, worldwide, no end, the statement as the chain of title. Filled = this row’s own licence (e.g. the agency licence reference), with the next three' },
  { name: 'commercial_reuse', required: false, what: 'With a licence of its own: yes | no | unknown' },
  { name: 'territory', required: false, what: 'With a licence of its own: IN, WW or a list such as IN,AE' },
  { name: 'licence_expires', required: false, what: 'With a licence of its own: YYYY-MM-DD or none' },
  { name: 'moment_ref', required: false, what: 'Several moments of one video' },
  { name: 'aliases', required: false, what: 'Other names, ;-separated' },
  { name: 'celebrity_minor', required: false, what: 'yes | no (a minor is never published)' },
  { name: 'event, place, place_kind', required: false, what: 'A public event or venue, coarse (never a home, hospital, school or place of worship); place_kind event | venue | airport | street | studio | other' },
  { name: 'platform, account', required: false, what: 'The in-house page that posted it (facebook | instagram, the page ID or handle)' },
  { name: 'post_permalink, platform_post_id', required: false, what: 'The post (https) and its id (comment replies need the id)' },
  { name: 'still_url', required: false, what: 'The still’s public copy (https)' },
  { name: 'copyright_owner, acquisition, assignment_ref', required: false, what: 'Chain of title of a licence of its own — required with commercial_reuse=yes (acquisition staff | freelance | agency | licensed | other; assignment_ref, the written assignment or licence, for anything but staff): without it no image is shown. Blank with the other licence columns = the ownership statement' },
  { name: 'source_ref, author', required: false, what: 'Where the file came from in the library; who shot it' },
  { name: 'live_performance, minor_in_frame, bystanders, sensitive_location', required: false, what: 'yes | no: any yes keeps the still off the page' },
  { name: 'celebrity_display', required: false, what: 'name_only | name_and_image (capped by the rights review)' },
  { name: 'piece_label, piece_category, piece_order, piece_x, piece_y', required: false, what: 'One row per piece: the label in your words, the garment category, the order, the marker position 0..1 (both or neither)' },
];

/** A TEST example of the library file (fictional "Demo Star" people, example.com URLs), two pieces of one look. */
export const LIBRARY_EXAMPLE = [
  'video_ref,celebrity,moment_date,event,place,place_kind,platform,account,post_permalink,platform_post_id,still_ref,still_url,licence,commercial_reuse,territory,licence_expires,copyright_owner,author,acquisition,assignment_ref,live_performance,minor_in_frame,bystanders,sensitive_location,celebrity_display,piece_label,piece_category,piece_order,piece_x,piece_y',
  'demo-vid-0101,Demo Star One,2026-09-12,Demo Film Premiere,Demo City,event,instagram,demo.afflino,https://instagram.example.com/p/demo-0101,17900000000000101,demo-stills/0101.jpg,https://cdn.example.com/demo-stills/0101.jpg,TEST staff footage,yes,IN,2027-12-31,Demo Media (TEST),Demo Shooter,staff,TEST-ASSIGN-001,no,no,no,no,name_and_image,The shirt,shirt,0,0.42,0.35',
  'demo-vid-0101,Demo Star One,2026-09-12,Demo Film Premiere,Demo City,event,instagram,demo.afflino,https://instagram.example.com/p/demo-0101,17900000000000101,demo-stills/0101.jpg,https://cdn.example.com/demo-stills/0101.jpg,TEST staff footage,yes,IN,2027-12-31,Demo Media (TEST),Demo Shooter,staff,TEST-ASSIGN-001,no,no,no,no,name_and_image,The shoes,footwear,1,0.47,0.9',
].join('\n');

/* ---------- analytics ---------- */

export const CLICK_GROUPS = [
  { value: 'day', label: 'Day' },
  { value: 'celebrity', label: 'Celebrity' },
  { value: 'look', label: 'Look' },
  { value: 'piece', label: 'Piece' },
  { value: 'property', label: 'Page' },
  { value: 'link', label: 'Link' },
  { value: 'via', label: 'Surface' },
] as const;

export type ClickGroup = (typeof CLICK_GROUPS)[number]['value'];

export interface ClickAnalytics {
  from: string;
  to: string;
  group_by: string;
  total_clicks: number;
  groups: Array<{ key: string; label: string; clicks: number }>;
}

export interface ReplyAnalytics {
  from: string;
  to: string;
  days: Array<{ day: string; received: number; sent: number; skipped: number; failed: number }>;
  rules: Array<{ rule_id: string; look_id: string; received: number; sent: number; skipped: number; failed: number }>;
}

/** The IST calendar day `daysAgo` days before `now` (YYYY-MM-DD). */
export function istDay(daysAgo: number, now: number = Date.now()): string {
  return new Date(now + 330 * 60_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** The inclusive range of the last `days` IST days, ending today. */
export function lastDays(days: number, now: number = Date.now()): { from: string; to: string } {
  return { from: istDay(days - 1, now), to: istDay(0, now) };
}

/** Every day of a range (YYYY-MM-DD), for a chart with zero days filled in. */
export function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  while (Number.isFinite(t) && t <= end && out.length < 400) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

/** The analytics table as CSV (RFC 4180, formula-guarded by lib/csv). */
export function clicksCsv(a: ClickAnalytics, groupLabel: string): string {
  const lines = [csvRow([groupLabel, 'Key', 'Clicks']), ...a.groups.map((g) => csvRow([g.label, g.key, g.clicks]))];
  lines.push(csvRow(['Total', '', a.total_clicks]));
  return `${lines.join('\r\n')}\r\n`;
}
