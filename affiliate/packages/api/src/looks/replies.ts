/**
 * Comment replies, the api side: the Meta webhook's intake and the rules.
 *
 * Intake (POST /v1/integrations/meta/webhook, routes/meta-webhook.ts):
 *   1. X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(META_APP_SECRET, the RAW
 *      request bytes), compared in constant time; missing secret → 503,
 *      missing or wrong signature → 401 and nothing is read;
 *   2. each comment's account (entry.id) is resolved to its organisation and
 *      in-house property through meta_accounts — the ONE cross-organisation
 *      lookup here (a Meta account id belongs to exactly one property, unique
 *      (platform, meta_account_id)); everything after it is tenant-scoped;
 *   3. the account's own comments are dropped (no reply loops); a comment
 *      (or a message) that is exactly an opt-out word adds its author to the
 *      opt-out list; a comment on a rule's post with one of its keywords
 *      becomes ONE reply_events row — `on conflict (platform, comment_id) do
 *      nothing`, so Meta's retries and duplicate deliveries add nothing;
 *   4. nothing but hashes is kept: commenter_hash = HMAC-SHA256(
 *      COMMENT_ID_HASH_KEY, platform:account:scoped id); no comment text, no
 *      username, no raw id.
 * The workers send the one private reply (packages/workers/src/replies/).
 *
 * Rules: one per (in-house page, post); keywords normalised (1–10, each 1–30
 * characters, never an opt-out word); an optional public answer, one of the
 * fixed texts (@paparazzi/shared PUBLIC_REPLY_TEMPLATES: never free text
 * under a celebrity's post); created disabled; enabled only while the look
 * is public AND carries products (a shoppable page with at least one
 * product on a live offer: the message says the page has affiliate links);
 * a rule a takedown turned off stays off until the takedown is restored.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  AppError,
  KEYWORDS_PER_RULE_MAX,
  PUBLIC_REPLY_MAX_CHARS,
  PUBLIC_REPLY_TEMPLATES,
  isOptOut,
  isPublicReplyTemplate,
  matchKeyword,
  normaliseKeyword,
  parseMetaWebhook,
  samePost,
  urlsIn,
} from '@paparazzi/shared';
import { getPool, tenantQuery } from '../db.js';
import { bundleDisplay, loadLookBundle, publicLook } from './bundle.js';
import { celebrityNames } from './names.js';
import { audit, scoped, toIso, withTransaction } from './sql.js';

export const COMMENT_ID_HASH_KEY_MIN_LENGTH = 32;

export function verifyMetaSignature(raw: Buffer, header: string | string[] | undefined, appSecret: string): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('sha256=')) return false;
  const given = value.slice('sha256='.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac('sha256', appSecret).update(raw).digest('hex');
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(expected, 'hex'));
}

/** Constant-time string comparison (the verify token). */
export function sameSecret(a: string, b: string): boolean {
  const x = createHmac('sha256', 'compare').update(a).digest();
  const y = createHmac('sha256', 'compare').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

export function commenterHash(key: string, platform: string, accountId: string, scopedId: string): string {
  return createHmac('sha256', key).update(`${platform}:${accountId}:${scopedId}`).digest('hex');
}

function b64url(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(text)) return null;
  return Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Meta's signed_request (the data deletion callback): base64url(signature)
 * "." base64url(payload JSON), the signature HMAC-SHA256(app secret, the
 * ENCODED payload). Null unless the signature matches (constant time) and
 * the payload is {"algorithm":"HMAC-SHA256", "user_id": …}.
 */
export function parseSignedRequest(signed: string, appSecret: string): { user_id: string; issued_at: number | null } | null {
  const [sigPart, payloadPart, extra] = signed.split('.');
  if (!sigPart || !payloadPart || extra !== undefined || signed.length > 8192) return null;
  const sig = b64url(sigPart);
  const payload = b64url(payloadPart);
  if (!sig || !payload || sig.length !== 32) return null;
  const expected = createHmac('sha256', appSecret).update(payloadPart).digest();
  if (!timingSafeEqual(sig, expected)) return null;
  let body: unknown;
  try {
    body = JSON.parse(payload.toString('utf8'));
  } catch {
    return null;
  }
  const b = body as { algorithm?: unknown; user_id?: unknown; issued_at?: unknown };
  if (typeof b.algorithm !== 'string' || b.algorithm.toUpperCase() !== 'HMAC-SHA256') return null;
  const userId = typeof b.user_id === 'string' || typeof b.user_id === 'number' ? String(b.user_id) : null;
  if (!userId || !/^[0-9A-Za-z_-]{1,128}$/.test(userId)) return null;
  return { user_id: userId, issued_at: typeof b.issued_at === 'number' ? b.issued_at : null };
}

/**
 * A person's data deletion request: every reply event whose commenter hash
 * is theirs on any in-house account is deleted (the hash is per platform
 * and account, so each mapped account's hash is computed). The opt-out list
 * keeps its hash: it holds no other data, and it is what stops any message
 * to them (counsel's question, Q14). Cross-organisation by design, like the
 * webhook's account lookup; each delete names its org_id.
 */
export async function deleteMetaUserData(userId: string, hashKey: string): Promise<{ events_deleted: number; accounts: number; confirmation_code: string }> {
  const accounts = (await getPool().query<AccountRow>(`select id, org_id, property_id, platform, meta_account_id, linked_page_id from meta_accounts order by id`)).rows;
  let deleted = 0;
  for (const a of accounts) {
    const hash = commenterHash(hashKey, a.platform, a.meta_account_id, userId);
    const res = await tenantQuery<{ id: string }>(a.org_id, `delete from reply_events where org_id = $1 and platform = $2 and commenter_hash = $3 returning id`, [a.platform, hash]);
    deleted += res.rows.length;
  }
  return { events_deleted: deleted, accounts: accounts.length, confirmation_code: randomBytes(8).toString('hex') };
}

export interface IntakeSummary {
  comments: number;
  queued: number;
  duplicates: number;
  no_rule: number;
  own_comments: number;
  unmapped_accounts: number;
  opt_outs: number;
  ignored: number;
}

interface AccountRow {
  id: string;
  org_id: string;
  property_id: string;
  platform: string;
  meta_account_id: string;
  linked_page_id: string | null;
}

/** Process one verified delivery (already parsed JSON). */
export async function ingestMetaDelivery(body: unknown, hashKey: string, now: number = Date.now()): Promise<IntakeSummary> {
  const parsed = parseMetaWebhook(body);
  const out: IntakeSummary = {
    comments: parsed.comments.length,
    queued: 0,
    duplicates: 0,
    no_rule: 0,
    own_comments: 0,
    unmapped_accounts: 0,
    opt_outs: 0,
    ignored: parsed.ignored,
  };
  const accounts = new Map<string, AccountRow | null>();
  const account = async (platform: string, id: string): Promise<AccountRow | null> => {
    const k = `${platform}:${id}`;
    if (!accounts.has(k)) {
      // The one cross-organisation read (see the file docstring).
      const r = (
        await getPool().query<AccountRow>(
          `select id, org_id, property_id, platform, meta_account_id, linked_page_id from meta_accounts where platform = $1 and meta_account_id = $2`,
          [platform, id],
        )
      ).rows[0];
      accounts.set(k, r ?? null);
    }
    return accounts.get(k) ?? null;
  };

  for (const m of parsed.messages) {
    if (!isOptOut(m.text)) continue;
    const acc = await account(m.platform, m.accountId);
    if (!acc || m.senderId === acc.meta_account_id || m.senderId === acc.linked_page_id) continue;
    await tenantQuery(
      acc.org_id,
      `insert into reply_suppressions (org_id, platform, commenter_hash) values ($1, $2, $3) on conflict do nothing`,
      [m.platform, commenterHash(hashKey, m.platform, acc.meta_account_id, m.senderId)],
    );
    out.opt_outs += 1;
  }

  for (const c of parsed.comments) {
    const acc = await account(c.platform, c.accountId);
    if (!acc) {
      out.unmapped_accounts += 1;
      continue;
    }
    if (c.fromId === acc.meta_account_id || c.fromId === acc.linked_page_id) {
      out.own_comments += 1;
      continue;
    }
    const hash = commenterHash(hashKey, c.platform, acc.meta_account_id, c.fromId);
    if (isOptOut(c.text)) {
      await tenantQuery(acc.org_id, `insert into reply_suppressions (org_id, platform, commenter_hash) values ($1, $2, $3) on conflict do nothing`, [c.platform, hash]);
      out.opt_outs += 1;
      continue;
    }
    const rules = (
      await tenantQuery<{ id: string; platform_post_id: string; keywords: string[] }>(
        acc.org_id,
        `select id, platform_post_id, keywords from reply_rules where org_id = $1 and property_id = $2 and enabled = true order by created_at, id`,
        [acc.property_id],
      )
    ).rows;
    let hit: { rule: string; keyword: string } | null = null;
    for (const r of rules) {
      if (!samePost(c.postId, r.platform_post_id)) continue;
      const k = matchKeyword(c.text, r.keywords ?? []);
      if (k) {
        hit = { rule: r.id, keyword: k };
        break;
      }
    }
    if (!hit) {
      out.no_rule += 1;
      continue;
    }
    const commentAt = c.time ? new Date(c.time * 1000).toISOString() : new Date(now).toISOString();
    const ins = await tenantQuery<{ id: string }>(
      acc.org_id,
      `insert into reply_events (org_id, rule_id, property_id, platform, meta_account_id, comment_id, media_id, commenter_hash,
                                 matched_keyword, comment_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
       on conflict (platform, comment_id) do nothing
       returning id`,
      [hit.rule, acc.property_id, c.platform, acc.meta_account_id, c.commentId, c.postId, hash, hit.keyword, commentAt],
    );
    if (ins.rows.length > 0) out.queued += 1;
    else out.duplicates += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function normaliseKeywords(raw: readonly string[]): { keywords: string[]; problems: string[] } {
  const problems: string[] = [];
  const out: string[] = [];
  for (const k of raw) {
    const n = normaliseKeyword(k);
    if (!n) problems.push(`'${k}' is not a usable keyword (1-30 letters or digits; never an opt-out word)`);
    else if (!out.includes(n)) out.push(n);
  }
  if (out.length === 0) problems.push('at least one keyword');
  if (out.length > KEYWORDS_PER_RULE_MAX) problems.push(`at most ${KEYWORDS_PER_RULE_MAX} keywords`);
  return { keywords: out, problems };
}

export function publicReplyProblems(text: string | null | undefined): string[] {
  if (text === null || text === undefined || text === '') return [];
  const out: string[] = [];
  if (text.length > PUBLIC_REPLY_MAX_CHARS) out.push(`the public reply is at most ${PUBLIC_REPLY_MAX_CHARS} characters`);
  if (urlsIn(text).length > 0 || /http|www\./i.test(text)) out.push('the public reply is text only: no link');
  if (!isPublicReplyTemplate(text)) out.push(`the public reply is one of the fixed texts (${PUBLIC_REPLY_TEMPLATES.map((t) => `'${t}'`).join(', ')}): never free text under a post`);
  return out;
}

/**
 * True when a rule may send for the look now: the look page is public AND
 * carries products (shoppable, with at least one approved product on a live
 * offer) — the message says the page has affiliate links, so a name-only
 * look never gets one. The workers re-check the same before every send.
 */
export async function lookSendable(orgId: string, lookId: string): Promise<boolean> {
  const b = await loadLookBundle(orgId, lookId);
  if (!b) return false;
  const out = publicLook(b, Date.now(), await celebrityNames(orgId));
  if (out.kind !== 'ok' || !bundleDisplay(b).shoppable) return false;
  return b.items.some((i) => i.review_state === 'approved' && !!b.offers.get(i.variant_id));
}

export interface RuleView {
  id: string;
  look_id: string;
  property_id: string;
  platform_post_id: string;
  keywords: string[];
  public_reply: string | null;
  enabled: boolean;
  disabled_by_takedown_id: string | null;
  created_at: string | null;
}

const RULE_COLS = `id, look_id, property_id, platform_post_id, keywords, public_reply, enabled, disabled_by_takedown_id, created_at`;

function ruleView(r: RuleView & { created_at: string | Date | null }): RuleView {
  return { ...r, keywords: r.keywords ?? [], created_at: toIso(r.created_at) };
}

export async function createRule(
  orgId: string,
  actorId: string,
  input: { look_id: string; platform_post_id?: string | null; keywords: string[]; public_reply?: string | null; enabled?: boolean },
): Promise<RuleView> {
  const look = (
    await tenantQuery<{ id: string; property_id: string | null; platform_post_id: string | null; takedown_id: string | null }>(
      orgId,
      `select id, property_id, platform_post_id, takedown_id from looks where org_id = $1 and id = $2`,
      [input.look_id],
    )
  ).rows[0];
  if (!look) throw new AppError('NOT_FOUND', 'Look not found', 404);
  if (look.takedown_id) throw new AppError('GONE', 'the look was withdrawn (takedown)', 410);
  if (!look.property_id) throw new AppError('VALIDATION_ERROR', "the look names no in-house page (property_id)", 400);
  const postId = (input.platform_post_id ?? look.platform_post_id ?? '').trim();
  if (!postId || postId.length > 100) throw new AppError('VALIDATION_ERROR', "the rule needs the post's id (platform_post_id, on the look or given here)", 400);
  const kw = normaliseKeywords(input.keywords);
  const problems = [...kw.problems, ...publicReplyProblems(input.public_reply)];
  if (problems.length) throw new AppError('VALIDATION_ERROR', problems.join('; '), 400);
  if (input.enabled && !(await lookSendable(orgId, look.id))) throw new AppError('CONFLICT', 'a rule is turned on only while its look is public and carries products', 409);
  const id = await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    if ((await q<{ id: string }>(`select id from reply_rules where org_id = $1 and property_id = $2 and platform_post_id = $3`, [look.property_id, postId])).rows[0]) {
      throw new AppError('CONFLICT', 'this post already has a rule', 409);
    }
    const res = await q<{ id: string }>(
      `insert into reply_rules (org_id, look_id, property_id, platform_post_id, keywords, public_reply, enabled, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [look.id, look.property_id, postId, kw.keywords, input.public_reply?.trim() || null, input.enabled === true, actorId],
    );
    const ruleId = (res.rows[0] as { id: string }).id;
    await audit(q, actorId, 'reply_rule.create', 'reply_rule', ruleId);
    return ruleId;
  });
  return (await getRule(orgId, id)) as RuleView;
}

export async function getRule(orgId: string, id: string): Promise<RuleView | null> {
  const r = (await tenantQuery<RuleView & { created_at: string | Date | null }>(orgId, `select ${RULE_COLS} from reply_rules where org_id = $1 and id = $2`, [id])).rows[0];
  return r ? ruleView(r) : null;
}

export async function listRules(orgId: string, lookId?: string): Promise<RuleView[]> {
  const rows = (
    await tenantQuery<RuleView & { created_at: string | Date | null }>(
      orgId,
      `select ${RULE_COLS} from reply_rules where org_id = $1 ${lookId ? 'and look_id = $2' : ''} order by created_at desc, id`,
      lookId ? [lookId] : [],
    )
  ).rows;
  return rows.map(ruleView);
}

export async function updateRule(
  orgId: string,
  actorId: string,
  id: string,
  input: { keywords?: string[]; public_reply?: string | null; enabled?: boolean },
): Promise<RuleView> {
  const rule = await getRule(orgId, id);
  if (!rule) throw new AppError('NOT_FOUND', 'Rule not found', 404);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const push = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length + 1}`);
  };
  if (input.keywords !== undefined) {
    const kw = normaliseKeywords(input.keywords);
    if (kw.problems.length) throw new AppError('VALIDATION_ERROR', kw.problems.join('; '), 400);
    push('keywords', kw.keywords);
  }
  if (input.public_reply !== undefined) {
    const p = publicReplyProblems(input.public_reply);
    if (p.length) throw new AppError('VALIDATION_ERROR', p.join('; '), 400);
    push('public_reply', input.public_reply?.trim() || null);
  }
  if (input.enabled !== undefined) {
    if (input.enabled) {
      if (rule.disabled_by_takedown_id) {
        const td = (await tenantQuery<{ status: string }>(orgId, `select status from takedowns where org_id = $1 and id = $2`, [rule.disabled_by_takedown_id])).rows[0];
        if (td?.status === 'active') throw new AppError('GONE', 'a takedown turned this rule off; it stays off until the takedown is restored', 410);
      }
      if (!(await lookSendable(orgId, rule.look_id))) throw new AppError('CONFLICT', 'a rule is turned on only while its look is public and carries products', 409);
      push('enabled', true);
      sets.push('disabled_by_takedown_id = null');
    } else {
      push('enabled', false);
    }
  }
  if (sets.length === 0) return rule;
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    await q(`update reply_rules set ${sets.join(', ')}, updated_at = now() where org_id = $1 and id = $2`, params);
    await audit(q, actorId, 'reply_rule.update', 'reply_rule', id);
  });
  return (await getRule(orgId, id)) as RuleView;
}

/**
 * The latest comment-reply events for the admin and the owner's `events`
 * step: time, rule, look, in-house page, keyword, status, attempts, error
 * code. Never the comment id, the commenter's hash, the media id or Meta's
 * message id (they identify a person's comment; the admin has no use for
 * them).
 */
export async function recentReplyEvents(orgId: string, q: { limit: number; rule_id?: string; status?: string }) {
  const filters = ['e.org_id = $1'];
  const params: unknown[] = [];
  if (q.rule_id) {
    params.push(q.rule_id);
    filters.push(`e.rule_id = $${params.length + 1}`);
  }
  if (q.status) {
    params.push(q.status);
    filters.push(`e.status = $${params.length + 1}`);
  }
  params.push(q.limit);
  const rows = (
    await tenantQuery<{
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
      received_at: string | Date;
      sent_at: string | Date | null;
    }>(
      orgId,
      `select e.id, e.rule_id, r.look_id, e.property_id, p.external_account_id as account, e.platform, e.matched_keyword,
              e.status, e.attempts, e.error_code, e.public_reply_status, e.received_at, e.sent_at
         from reply_events e
         join reply_rules r on r.id = e.rule_id and r.org_id = $1
         join properties p on p.id = e.property_id and p.org_id = $1
        where ${filters.join(' and ')}
        order by e.received_at desc, e.id
        limit $${params.length + 1}`,
      params,
    )
  ).rows;
  return rows.map((r) => ({ ...r, attempts: Number(r.attempts), received_at: toIso(r.received_at), sent_at: toIso(r.sent_at) }));
}

// ---------------------------------------------------------------------------
// Accounts (the workers' `accounts` sync fills these; an editor may map one by hand)
// ---------------------------------------------------------------------------

export async function listAccounts(orgId: string) {
  const rows = (
    await tenantQuery<{
      id: string;
      property_id: string;
      platform: string;
      meta_account_id: string;
      linked_page_id: string | null;
      messaging_status: string;
      last_error_code: string | null;
      paused_until: string | Date | null;
      checked_at: string | Date | null;
      account: string;
    }>(
      orgId,
      `select m.id, m.property_id, m.platform, m.meta_account_id, m.linked_page_id, m.messaging_status, m.last_error_code,
              m.paused_until, m.checked_at, p.external_account_id as account
         from meta_accounts m join properties p on p.id = m.property_id and p.org_id = $1
        where m.org_id = $1 order by m.platform, p.external_account_id`,
    )
  ).rows;
  return rows.map((r) => ({ ...r, paused_until: toIso(r.paused_until), checked_at: toIso(r.checked_at) }));
}

export async function mapAccount(orgId: string, actorId: string, input: { property_id: string; meta_account_id: string; linked_page_id?: string | null }) {
  const p = (await tenantQuery<{ platform: string; status: string }>(orgId, `select platform, status from properties where org_id = $1 and id = $2`, [input.property_id])).rows[0];
  if (!p) throw new AppError('NOT_FOUND', 'Property not found', 404);
  if (p.platform !== 'facebook' && p.platform !== 'instagram') throw new AppError('VALIDATION_ERROR', 'comment replies run on Facebook pages and Instagram accounts', 400);
  const metaId = input.meta_account_id.trim();
  if (!/^[0-9]{1,64}$/.test(metaId)) throw new AppError('VALIDATION_ERROR', 'meta_account_id is the numeric Meta id (entry.id of the webhook)', 400);
  const linked = input.linked_page_id?.trim() || null;
  if (linked && !/^[0-9]{1,64}$/.test(linked)) throw new AppError('VALIDATION_ERROR', 'linked_page_id is a numeric Page id', 400);
  // A Meta id belongs to one property anywhere (unique (platform, meta_account_id)).
  const taken = (await getPool().query<{ property_id: string }>(`select property_id from meta_accounts where platform = $1 and meta_account_id = $2`, [p.platform, metaId])).rows[0];
  if (taken && taken.property_id !== input.property_id) throw new AppError('CONFLICT', 'this Meta account is mapped to another property', 409);
  await withTransaction(async (client) => {
    const q = scoped(client, orgId);
    const cur = (await q<{ id: string }>(`select id from meta_accounts where org_id = $1 and property_id = $2`, [input.property_id])).rows[0];
    if (cur) {
      await q(`update meta_accounts set meta_account_id = $3, linked_page_id = $4, updated_at = now() where org_id = $1 and id = $2`, [cur.id, metaId, linked]);
    } else {
      await q(`insert into meta_accounts (org_id, property_id, platform, meta_account_id, linked_page_id) values ($1, $2, $3, $4, $5)`, [
        input.property_id,
        p.platform,
        metaId,
        linked,
      ]);
    }
    await audit(q, actorId, 'meta_account.map', 'property', input.property_id);
  });
  return (await listAccounts(orgId)).find((a) => a.property_id === input.property_id);
}
