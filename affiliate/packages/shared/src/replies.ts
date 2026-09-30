/**
 * Comment replies (a keyword in a comment on one of the in-house Facebook
 * Pages or Instagram accounts → one private reply carrying the look page's
 * afflino.com URL). Pure rules shared by the api (the Meta webhook) and the
 * workers (the sender). No I/O, no crypto (the keyed hashes live in the
 * services).
 *
 * Meta's rules (docs of 2026-09-30, the "Meta comment-to-DM brief"): one
 * private reply per comment, within 7 days of it, plain text of at most 1000
 * UTF-8 bytes; opt-outs honoured immediately; an automated-message line.
 * Amazon's rule: "Special Links … are not permitted to be used in emails,
 * offline promotions or in any offline manner", so a message only ever
 * carries an afflino.com page URL — never a /r/ link, never a merchant URL.
 */

/** Meta: "Only one message can be sent to the commenter", within 7 days of the comment. */
export const PRIVATE_REPLY_WINDOW_DAYS = 7;

/** Meta: private replies are limited to 750 calls per hour per account; this build stops below it. */
export const PRIVATE_REPLY_HOURLY_CEILING = 700;

/** Instagram: "UTF-8 and be 1,000 bytes or less" (the Messenger limit was not found; the same is used). */
export const REPLY_TEXT_MAX_BYTES = 1000;

export const KEYWORD_MAX_CHARS = 30;
export const KEYWORDS_PER_RULE_MAX = 10;
export const PUBLIC_REPLY_MAX_CHARS = 300;

/**
 * The public comment replies a rule may post under the in-house post (DRAFTS
 * PENDING COUNSEL, Q11 / Q20): fixed texts only. A public reply sits under a
 * celebrity's post, so no free text ever goes there — it never names anyone,
 * never uses an endorsement phrase, never links (tested against the wording
 * lint in replies.test.ts). A rule stores the chosen text itself
 * (reply_rules.public_reply); the api refuses any other.
 */
export const PUBLIC_REPLY_TEMPLATES: readonly string[] = [
  'We sent you a message with the link.',
  'Check your messages: the link is there.',
  'Sent. The link is in your messages.',
];

export function isPublicReplyTemplate(text: string | null | undefined): boolean {
  return typeof text === 'string' && PUBLIC_REPLY_TEMPLATES.includes(text.trim());
}

/** A comment (or a message) that is exactly one of these adds the commenter to the opt-out list. */
export const OPT_OUT_WORDS: readonly string[] = ['stop', 'unsubscribe', 'stop messages', 'no more messages'];

/** reply_events.status. */
export const REPLY_EVENT_STATUSES = [
  'queued',
  'sending',
  'sent',
  'unknown',
  'skipped_suppressed',
  'skipped_expired',
  'skipped_disabled',
  'skipped_shadow',
  'failed_permanent',
  'failed_transient',
] as const;
export type ReplyEventStatus = (typeof REPLY_EVENT_STATUSES)[number];

/** COMMENT_REPLIES_SENDING: off (default) = nothing is sent; shadow = everything but the send; on. */
export const REPLY_SENDING_MODES = ['off', 'shadow', 'on'] as const;
export type ReplySendingMode = (typeof REPLY_SENDING_MODES)[number];

export function parseSendingMode(raw: string | undefined | null): ReplySendingMode {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'on' || v === 'shadow' ? v : 'off';
}

/** NFKC, lower case, runs of anything but letters/digits → one space. */
export function normaliseCommentText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim();
}

/** A rule keyword in its stored form, or null when it is not a usable keyword (empty, too long, an opt-out word). */
export function normaliseKeyword(raw: string): string | null {
  const k = normaliseCommentText(raw);
  if (k === '' || k.length > KEYWORD_MAX_CHARS) return null;
  if (OPT_OUT_WORDS.includes(k)) return null;
  return k;
}

/**
 * The first keyword the comment contains as whole words (token sequence), or
 * null. "LINK please!!" matches "link"; "linked" does not; "send link" matches
 * "send link".
 */
export function matchKeyword(text: string, keywords: readonly string[]): string | null {
  const hay = ` ${normaliseCommentText(text)} `;
  for (const raw of keywords) {
    const k = normaliseCommentText(raw);
    if (k !== '' && hay.includes(` ${k} `)) return k;
  }
  return null;
}

export function isOptOut(text: string): boolean {
  return OPT_OUT_WORDS.includes(normaliseCommentText(text));
}

// ---------------------------------------------------------------------------
// Webhook payloads
// ---------------------------------------------------------------------------

export interface MetaCommentEvent {
  platform: 'instagram' | 'facebook';
  /** entry.id: the Instagram professional account id, or the Page id. */
  accountId: string;
  commentId: string;
  /** The post / media the comment is on (Instagram media id; Facebook post_id "<page>_<post>"). */
  postId: string | null;
  parentId: string | null;
  /** The commenter's scoped id (never stored; only its keyed hash). */
  fromId: string;
  text: string;
  /** Seconds since the epoch: Facebook created_time, else entry.time (when Meta sent it). */
  time: number | null;
}

export interface MetaMessageEvent {
  platform: 'instagram' | 'facebook';
  accountId: string;
  senderId: string;
  text: string;
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function epochSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return epochSeconds(n);
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
  }
  return null;
}

/**
 * Comment and message events from one webhook delivery, parsed defensively:
 *   - Instagram: object 'instagram'; each entry carries `changes[]` (Facebook
 *     Login) or `field` / `value` directly (Instagram Login); the comment id
 *     is `value.id` or `value.comment_id`; the field is `comments`;
 *   - Facebook Pages: object 'page', field `feed`, only `item: comment` with
 *     `verb: add` (edits, hides and removals are ignored);
 *   - messages (`entry.messaging[]`, either platform): kept only for the
 *     opt-out check (the text is never stored).
 * Anything else is counted as ignored.
 */
export function parseMetaWebhook(body: unknown): { comments: MetaCommentEvent[]; messages: MetaMessageEvent[]; ignored: number } {
  const out = { comments: [] as MetaCommentEvent[], messages: [] as MetaMessageEvent[], ignored: 0 };
  const b = rec(body);
  if (!b) return out;
  const object = b.object;
  const platform = object === 'instagram' ? 'instagram' : object === 'page' ? 'facebook' : null;
  if (!platform || !Array.isArray(b.entry)) {
    out.ignored += 1;
    return out;
  }
  for (const rawEntry of b.entry) {
    const entry = rec(rawEntry);
    const accountId = entry ? str(entry.id) : null;
    if (!entry || !accountId) {
      out.ignored += 1;
      continue;
    }
    const entryTime = epochSeconds(entry.time);
    const changes: Array<{ field: unknown; value: unknown }> = [];
    if (Array.isArray(entry.changes)) {
      for (const c of entry.changes) {
        const cr = rec(c);
        if (cr) changes.push({ field: cr.field, value: cr.value });
      }
    } else if (entry.field !== undefined) {
      changes.push({ field: entry.field, value: entry.value });
    }
    for (const ch of changes) {
      const v = rec(ch.value);
      if (!v) {
        out.ignored += 1;
        continue;
      }
      if (platform === 'instagram' && (ch.field === 'comments' || ch.field === 'live_comments')) {
        const from = rec(v.from);
        const commentId = str(v.id) ?? str(v.comment_id);
        const fromId = from ? str(from.id) : null;
        const text = typeof v.text === 'string' ? v.text : null;
        if (!commentId || !fromId || text === null || ch.field === 'live_comments') {
          out.ignored += 1;
          continue;
        }
        const media = rec(v.media);
        out.comments.push({
          platform,
          accountId,
          commentId,
          postId: media ? str(media.id) : str(v.media_id),
          parentId: str(v.parent_id),
          fromId,
          text,
          time: entryTime,
        });
      } else if (platform === 'facebook' && ch.field === 'feed') {
        if (v.item !== 'comment' || v.verb !== 'add') {
          out.ignored += 1;
          continue;
        }
        const from = rec(v.from);
        const commentId = str(v.comment_id);
        const fromId = from ? str(from.id) : null;
        const text = typeof v.message === 'string' ? v.message : null;
        if (!commentId || !fromId || text === null) {
          out.ignored += 1;
          continue;
        }
        out.comments.push({
          platform,
          accountId,
          commentId,
          postId: str(v.post_id),
          parentId: str(v.parent_id),
          fromId,
          text,
          time: epochSeconds(v.created_time) ?? entryTime,
        });
      } else {
        out.ignored += 1;
      }
    }
    if (Array.isArray(entry.messaging)) {
      for (const m of entry.messaging) {
        const mr = rec(m);
        const sender = mr ? rec(mr.sender) : null;
        const message = mr ? rec(mr.message) : null;
        const senderId = sender ? str(sender.id) : null;
        const text = message && typeof message.text === 'string' ? message.text : null;
        if (!senderId || text === null || (message && message.is_echo === true)) {
          out.ignored += 1;
          continue;
        }
        out.messages.push({ platform, accountId, senderId, text });
      }
    }
  }
  return out;
}

/** True when a Facebook post id ("<page>_<post>" or "<post>") and a rule's stored id name the same post. */
export function samePost(eventPostId: string | null, rulePostId: string): boolean {
  if (!eventPostId) return false;
  if (eventPostId === rulePostId) return true;
  const tail = (id: string) => (id.includes('_') ? id.slice(id.indexOf('_') + 1) : id);
  return tail(eventPostId) === tail(rulePostId);
}

// ---------------------------------------------------------------------------
// The one message
// ---------------------------------------------------------------------------

/** UTF-8 byte length without TextEncoder (this package declares no DOM or node types). */
export function utf8ByteLength(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Every URL-like token in a text (with or without a scheme). */
export function urlsIn(text: string): string[] {
  const re = /(https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|in|net|org|co|io|to|ly|me|app|link|shop|store)\b(\/[^\s<>"']*)?)/gi;
  return [...text.matchAll(re)].map((m) => m[0]);
}

interface ParsedUrl {
  scheme: string;
  authority: string;
  host: string;
  path: string;
  query: string;
  fragment: string;
}

/**
 * A minimal absolute-URL split (this package compiles without a URL parser:
 * no DOM or node types). Lower-cases scheme and host; null when it is not an
 * absolute http(s) URL.
 */
export function splitUrl(raw: string): ParsedUrl | null {
  const m = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i.exec(raw.trim());
  if (!m) return null;
  const authority = (m[2] as string).toLowerCase();
  const host = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  return {
    scheme: (m[1] as string).toLowerCase(),
    authority,
    host,
    path: m[3] || '/',
    query: m[4] ?? '',
    fragment: m[5] ?? '',
  };
}

/**
 * Why a message may NOT be sent (null = it may): exactly one URL, which is
 * https on the site's own host with the path of a look page
 * (/looks/<uuid>) or a storefront (/s/<slug>), no query string, no
 * fragment, no credentials; never a /r/ link, never an Amazon or other
 * merchant host; plain text within REPLY_TEXT_MAX_BYTES.
 */
export function replyTextRefusal(text: string, siteOrigin: string): string | null {
  const site = splitUrl(siteOrigin);
  if (!site) return 'site_origin_invalid';
  if (site.scheme !== 'https') return 'site_origin_not_https';
  if (utf8ByteLength(text) > REPLY_TEXT_MAX_BYTES) return 'too_long';
  if (/\/r\//i.test(text)) return 'tracked_link';
  if (/amazon\.|amzn\.|\bamzn\b/i.test(text)) return 'merchant_url';
  const urls = urlsIn(text);
  if (urls.length !== 1) return urls.length === 0 ? 'no_url' : 'several_urls';
  const u = splitUrl(urls[0] as string);
  if (!u) return 'url_invalid';
  if (u.scheme !== 'https') return 'url_not_https';
  if (u.authority !== u.host) return 'url_has_credentials';
  if (u.host !== site.host) return 'url_not_on_site';
  if (u.query !== '' || u.fragment !== '') return 'url_has_query';
  if (!/^\/looks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u.path) && !/^\/s\/[a-z0-9]+(-[a-z0-9]+)*$/.test(u.path)) {
    return 'url_not_a_look_page';
  }
  return null;
}

/**
 * DRAFT PENDING COUNSEL (Q11, Q19, Q20): the private reply. The label first
 * (ASCI: upfront), the look page's URL, the automated-message line and the
 * opt-out; no celebrity is named, no product, no price.
 */
export function buildReplyText(opts: { lookUrl: string; siteOrigin: string }): string {
  const text = [
    `Ad · The look you asked for, on Afflino: ${opts.lookUrl}`,
    'Afflino may earn a commission from purchases made through the links on that page.',
    'This is an automated message. Reply STOP and we will not message you again.',
  ].join('\n');
  const refusal = replyTextRefusal(text, opts.siteOrigin);
  if (refusal) throw new Error(`reply text refused: ${refusal}`);
  return text;
}

// ---------------------------------------------------------------------------
// Meta errors
// ---------------------------------------------------------------------------

/**
 * permanent  never retried (the comment cannot get a reply);
 * transient  retried with backoff (throttling);
 * auth       the account's token is invalid: the account is paused, the
 *            event waits (nothing was sent);
 * unknown    the outcome is not known (no Graph error body, or Meta's own
 *            "unknown error"): NEVER resent — one message per comment.
 */
export type MetaErrorClass = 'permanent' | 'transient' | 'auth' | 'unknown';

const PERMANENT_PAIRS = new Set([
  '551/1545041',
  '100/2534025',
  '10/2534022',
  '10/2018278',
  '10/2018108',
  '200/2534041',
  '100/2534029',
  '100/2534013',
  '200/2018028',
]);

export function classifyMetaError(err: { code?: number | null; subcode?: number | null } | null | undefined): MetaErrorClass {
  if (!err || typeof err.code !== 'number') return 'unknown';
  const { code } = err;
  const pair = `${code}/${err.subcode ?? ''}`;
  if (code === 190 || code === 102) return 'auth';
  if (PERMANENT_PAIRS.has(pair)) return 'permanent';
  if (code === 10 && err.subcode === 1893063) return 'transient';
  if ([4, 17, 32, 613].includes(code) || (code >= 80001 && code <= 80014)) return 'transient';
  if (code === 1 || code === 2) return 'unknown';
  return 'permanent';
}
