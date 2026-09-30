/**
 * Comment replies, the sending side: one private reply per matched comment
 * (reply_events, written by the api's Meta webhook), then optionally the
 * rule's text-only public answer.
 *
 * processReplyEvent(pool, id, deps):
 *   - nothing while COMMENT_REPLIES_SENDING is off (the default); 'shadow'
 *     does everything but the send (status skipped_shadow);
 *   - an account whose token is invalid, whose messaging is off, or that is
 *     paused after throttling waits (the event is not claimed); so does an
 *     account at the hourly ceiling (PRIVATE_REPLY_HOURLY_CEILING, below
 *     Meta's 750);
 *   - the claim is a conditional update (queued / failed_transient →
 *     sending, attempts + 1): two workers never send the same event;
 *   - skipped: older than Meta's 7-day window, the commenter opted out, the
 *     rule is off, the look is no longer public (a takedown, a rights
 *     downgrade, unpublished: 'look_not_public'), or it carries no products
 *     (a name-only look, a review that turned products off, no approved
 *     product on a live offer: 'look_not_shoppable' — the message says the
 *     page has affiliate links);
 *   - the text is @paparazzi/shared buildReplyText: only the look page's
 *     afflino.com URL, plain text, ≤ 1000 bytes, checked again
 *     (replyTextRefusal) immediately before the send — a /r/ link or a
 *     merchant URL can never go out;
 *   - Meta's answer: sent (message id kept); throttled → failed_transient
 *     with backoff (and the account paused for Meta's regain time); invalid
 *     token (190) → the account is marked token_invalid and the event waits
 *     again (nothing was sent); a permanent refusal → failed_permanent; no
 *     answer or Meta's "unknown error" → 'unknown', NEVER resent (one message
 *     per comment, like the payout rule for unknown outcomes).
 *
 * The workers carry no tenantQuery: the event is read by its id (a uuid),
 * then every statement names its org_id.
 */
import type { Pool } from 'pg';
import {
  PRIVATE_REPLY_HOURLY_CEILING,
  PRIVATE_REPLY_WINDOW_DAYS,
  buildReplyText,
  classifyMetaError,
  effectiveCelebrityRights,
  replyTextRefusal,
  type ReplySendingMode,
} from '@paparazzi/shared';
import type { GraphError } from '../meta/graph';

export type SendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: GraphError | null; retryAfterSeconds: number | null };

export interface ReplyTarget {
  platform: 'facebook' | 'instagram';
  /** The Instagram account id or the Page id (entry.id). */
  accountId: string;
  linkedPageId: string | null;
  commentId: string;
  text: string;
}

export interface ReplySender {
  privateReply(t: ReplyTarget): Promise<SendResult>;
  publicReply(t: ReplyTarget): Promise<SendResult>;
}

/** Records every call; answers from `script` (default: sent). For tests and rehearsals. */
export class StubReplySender implements ReplySender {
  readonly calls: Array<{ kind: 'private' | 'public'; target: ReplyTarget }> = [];
  constructor(private readonly script: (kind: 'private' | 'public', t: ReplyTarget, n: number) => SendResult = () => ({ ok: true, messageId: 'stub-mid' })) {}
  async privateReply(t: ReplyTarget): Promise<SendResult> {
    this.calls.push({ kind: 'private', target: t });
    return this.script('private', t, this.calls.length);
  }
  async publicReply(t: ReplyTarget): Promise<SendResult> {
    this.calls.push({ kind: 'public', target: t });
    return this.script('public', t, this.calls.length);
  }
}

export interface ReplyDeps {
  sender: ReplySender;
  mode: ReplySendingMode;
  /** SITE_URL: the only origin a message may link to. */
  siteOrigin: string;
  now?: () => number;
  hourlyCeiling?: number;
  maxAttempts?: number;
  log?: (level: 'info' | 'warn' | 'error', message: string, fields?: Record<string, unknown>) => void;
}

export type ReplyOutcome =
  | 'sent'
  | 'unknown'
  | 'failed_permanent'
  | 'failed_transient'
  | 'skipped_expired'
  | 'skipped_suppressed'
  | 'skipped_disabled'
  | 'skipped_shadow'
  | 'sending_off'
  | 'account_paused'
  | 'auth_paused'
  | 'rate_ceiling'
  | 'not_claimed'
  | 'not_found';

interface EventRow {
  id: string;
  org_id: string;
  rule_id: string;
  platform: 'facebook' | 'instagram';
  meta_account_id: string;
  comment_id: string;
  commenter_hash: string;
  comment_at: string | Date | null;
  received_at: string | Date;
  status: string;
  attempts: number;
  next_attempt_at: string | Date | null;
}

/** Backoff after the n-th failed attempt: 1, 5, 25 minutes, 2 h, then 6 h. */
export function backoffSeconds(attempts: number): number {
  const table = [60, 300, 1500, 7200, 21_600];
  return table[Math.min(Math.max(attempts, 1), table.length) - 1] as number;
}

async function one<T>(pool: Pool, sql: string, params: unknown[]): Promise<T | null> {
  return ((await pool.query(sql, params)).rows[0] as T | undefined) ?? null;
}

/** Whether a reply may go out for the look now: 'ok', or why not (the read gate of the api, in the workers' SQL). */
export async function lookSendState(pool: Pool, orgId: string, lookId: string): Promise<'ok' | 'look_not_public' | 'look_not_shoppable'> {
  if (!(await lookIsPublic(pool, orgId, lookId))) return 'look_not_public';
  const r = await one<{ shoppable: boolean | null; rights_status: string | null; max_display: string | null; is_minor: boolean | null; never_list: boolean | null; c_takedown_id: string | null }>(
    pool,
    `select c.shoppable, c.rights_status, c.max_display, c.is_minor, c.never_list, c.takedown_id as c_takedown_id
       from looks l join celebrities c on c.id = l.celebrity_id and c.org_id = $1
      where l.org_id = $1 and l.id = $2`,
    [orgId, lookId],
  );
  const rights = r
    ? effectiveCelebrityRights({
        rights_status: r.rights_status ?? 'unreviewed',
        max_display: r.max_display ?? 'none',
        shoppable: r.shoppable === true,
        is_minor: r.is_minor === true,
        never_list: r.never_list === true,
        takedown_id: r.c_takedown_id,
      })
    : { display: 'none', shoppable: false };
  if (!rights.shoppable) return 'look_not_shoppable';
  const product = await one<{ id: string }>(
    pool,
    `select li.id
       from look_items li
       join offers o on o.variant_id = li.variant_id and o.org_id = $1
       join programmes pr on pr.id = o.programme_id and pr.org_id = $1
      where li.org_id = $1 and li.look_id = $2 and li.piece_id is not null and li.review_state = 'approved' and li.removed_at is null
        and o.status = 'active' and o.fresh_until > now() and pr.status = 'active'
      limit 1`,
    [orgId, lookId],
  );
  return product ? 'ok' : 'look_not_shoppable';
}

/** True when the look is public now (the read gate of the api, in the workers' SQL). */
export async function lookIsPublic(pool: Pool, orgId: string, lookId: string): Promise<boolean> {
  const r = await one<{ status: string; takedown_id: string | null; rights_status: string | null; max_display: string | null; shoppable: boolean | null; is_minor: boolean | null; never_list: boolean | null; c_takedown_id: string | null; celebrity_display: string }>(
    pool,
    `select l.status, l.takedown_id, l.celebrity_display, c.rights_status, c.max_display, c.shoppable, c.is_minor, c.never_list,
            c.takedown_id as c_takedown_id
       from looks l left join celebrities c on c.id = l.celebrity_id and c.org_id = $1
      where l.org_id = $1 and l.id = $2`,
    [orgId, lookId],
  );
  if (!r || r.status !== 'published' || r.takedown_id || r.rights_status === null) return false;
  const rights = effectiveCelebrityRights({
    rights_status: r.rights_status,
    max_display: r.max_display ?? 'none',
    shoppable: r.shoppable === true,
    is_minor: r.is_minor === true,
    never_list: r.never_list === true,
    takedown_id: r.c_takedown_id,
  });
  return rights.display !== 'none';
}

export async function processReplyEvent(pool: Pool, eventId: string, deps: ReplyDeps): Promise<ReplyOutcome> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  if (deps.mode === 'off') return 'sending_off';
  const ev = await one<EventRow>(
    pool,
    `select id, org_id, rule_id, platform, meta_account_id, comment_id, commenter_hash, comment_at, received_at, status, attempts, next_attempt_at
       from reply_events where id = $1`,
    [eventId],
  );
  if (!ev) return 'not_found';
  if (ev.status !== 'queued' && ev.status !== 'failed_transient') return 'not_claimed';
  const orgId = ev.org_id;
  const acc = await one<{ id: string; linked_page_id: string | null; messaging_status: string; paused_until: string | Date | null }>(
    pool,
    `select id, linked_page_id, messaging_status, paused_until from meta_accounts where org_id = $1 and platform = $2 and meta_account_id = $3`,
    [orgId, ev.platform, ev.meta_account_id],
  );
  if (!acc || ['token_invalid', 'disabled', 'not_linked'].includes(acc.messaging_status)) return 'account_paused';
  if (acc.paused_until && new Date(acc.paused_until).getTime() > now()) return 'account_paused';
  const hourAgo = new Date(now() - 3_600_000).toISOString();
  const sentLastHour = Number(
    (
      await one<{ n: string | number }>(
        pool,
        `select count(*) as n from reply_events where org_id = $1 and platform = $2 and meta_account_id = $3 and status in ('sent', 'unknown') and sent_at > $4::timestamptz`,
        [orgId, ev.platform, ev.meta_account_id, hourAgo],
      )
    )?.n ?? 0,
  );
  if (sentLastHour >= (deps.hourlyCeiling ?? PRIVATE_REPLY_HOURLY_CEILING)) {
    await pool.query(`update reply_events set next_attempt_at = $3::timestamptz, updated_at = now() where org_id = $1 and id = $2`, [
      orgId,
      ev.id,
      new Date(now() + 300_000).toISOString(),
    ]);
    return 'rate_ceiling';
  }

  // The claim: exactly one worker moves the event to 'sending'.
  const claimed = await one<{ attempts: number }>(
    pool,
    `update reply_events set status = 'sending', attempts = attempts + 1, updated_at = now()
      where org_id = $1 and id = $2 and status in ('queued', 'failed_transient')
        and (next_attempt_at is null or next_attempt_at <= $3::timestamptz)
      returning attempts`,
    [orgId, ev.id, new Date(now()).toISOString()],
  );
  if (!claimed) return 'not_claimed';
  const finish = async (status: string, extra: { error_code?: string | null; message_id?: string | null; next?: number | null } = {}) => {
    await pool.query(
      `update reply_events
          set status = $3, error_code = $4, message_id = coalesce($5, message_id),
              sent_at = case when $3 in ('sent', 'unknown') then now() else sent_at end,
              next_attempt_at = $6::timestamptz, updated_at = now()
        where org_id = $1 and id = $2`,
      [orgId, ev.id, status, extra.error_code ?? null, extra.message_id ?? null, extra.next ? new Date(extra.next).toISOString() : null],
    );
  };

  const commentAt = new Date(ev.comment_at ?? ev.received_at).getTime();
  if (now() - commentAt > PRIVATE_REPLY_WINDOW_DAYS * 86_400_000) {
    await finish('skipped_expired');
    return 'skipped_expired';
  }
  const suppressed = await one<{ platform: string }>(
    pool,
    `select platform from reply_suppressions where org_id = $1 and platform = $2 and commenter_hash = $3`,
    [orgId, ev.platform, ev.commenter_hash],
  );
  if (suppressed) {
    await finish('skipped_suppressed');
    return 'skipped_suppressed';
  }
  const rule = await one<{ enabled: boolean; look_id: string; public_reply: string | null }>(
    pool,
    `select enabled, look_id, public_reply from reply_rules where org_id = $1 and id = $2`,
    [orgId, ev.rule_id],
  );
  if (!rule || !rule.enabled) {
    await finish('skipped_disabled', { error_code: 'rule_off' });
    return 'skipped_disabled';
  }
  const state = await lookSendState(pool, orgId, rule.look_id);
  if (state !== 'ok') {
    await finish('skipped_disabled', { error_code: state });
    return 'skipped_disabled';
  }
  if (deps.mode === 'shadow') {
    await finish('skipped_shadow');
    return 'skipped_shadow';
  }

  const origin = deps.siteOrigin.replace(/\/$/, '');
  let text: string;
  try {
    text = buildReplyText({ lookUrl: `${origin}/looks/${rule.look_id}`, siteOrigin: origin });
  } catch (err) {
    await finish('failed_permanent', { error_code: 'text_refused' });
    log('error', 'reply text refused; nothing sent', { event_id: ev.id, error: err instanceof Error ? err.message : String(err) });
    return 'failed_permanent';
  }
  const target: ReplyTarget = { platform: ev.platform, accountId: ev.meta_account_id, linkedPageId: acc.linked_page_id, commentId: ev.comment_id, text };
  // The last check before anything leaves: only the look page's URL, plain text, within the byte limit.
  const refusal = replyTextRefusal(target.text, origin);
  if (refusal) {
    await finish('failed_permanent', { error_code: `text_${refusal}` });
    return 'failed_permanent';
  }

  let res: SendResult;
  try {
    res = await deps.sender.privateReply(target);
  } catch {
    res = { ok: false, error: null, retryAfterSeconds: null };
  }
  if (res.ok) {
    await finish('sent', { message_id: res.messageId });
    if (rule.public_reply) {
      let pub: SendResult;
      try {
        pub = await deps.sender.publicReply({ ...target, text: rule.public_reply });
      } catch {
        pub = { ok: false, error: null, retryAfterSeconds: null };
      }
      await pool.query(`update reply_events set public_reply_status = $3, updated_at = now() where org_id = $1 and id = $2`, [
        orgId,
        ev.id,
        pub.ok ? 'sent' : 'failed',
      ]);
    }
    return 'sent';
  }
  const cls = classifyMetaError(res.error);
  const code = res.error ? `${res.error.code ?? ''}/${res.error.subcode ?? ''}` : 'no_answer';
  if (cls === 'auth') {
    await pool.query(
      `update meta_accounts set messaging_status = 'token_invalid', last_error_code = $3, checked_at = now(), updated_at = now() where org_id = $1 and id = $2`,
      [orgId, acc.id, code],
    );
    // Nothing was sent: the event waits for the account (attempt not counted).
    await pool.query(`update reply_events set status = 'queued', attempts = attempts - 1, error_code = $3, updated_at = now() where org_id = $1 and id = $2`, [orgId, ev.id, code]);
    log('warn', 'meta token invalid; the account is paused until the accounts check passes', { account: ev.meta_account_id });
    return 'auth_paused';
  }
  if (cls === 'transient') {
    const attempts = Number(claimed.attempts);
    if (attempts >= (deps.maxAttempts ?? 8)) {
      await finish('failed_permanent', { error_code: `${code} (after ${attempts} attempts)` });
      return 'failed_permanent';
    }
    const wait = Math.max(backoffSeconds(attempts), res.retryAfterSeconds ?? 0);
    await finish('failed_transient', { error_code: code, next: now() + wait * 1000 });
    if (res.retryAfterSeconds) {
      await pool.query(
        `update meta_accounts set messaging_status = 'rate_limited', paused_until = $3::timestamptz, last_error_code = $4, updated_at = now() where org_id = $1 and id = $2`,
        [orgId, acc.id, new Date(now() + res.retryAfterSeconds * 1000).toISOString(), code],
      );
    }
    return 'failed_transient';
  }
  if (cls === 'unknown') {
    await finish('unknown', { error_code: code });
    log('warn', 'private reply outcome unknown; never resent', { event_id: ev.id });
    return 'unknown';
  }
  await finish('failed_permanent', { error_code: code });
  return 'failed_permanent';
}

/**
 * The sweep (every few seconds on the comment-replies queue): expire events
 * past Meta's window whatever the mode, then list the events ready to send
 * (queued or due for a retry, on accounts that may send). Cross-organisation
 * by design, like the retention purge; each event is processed with its own
 * org_id.
 */
export async function sweepReplyEvents(pool: Pool, opts: { now?: () => number; limit?: number } = {}): Promise<{ expired: number; ready: Array<{ id: string; attempts: number }> }> {
  const now = opts.now ?? Date.now;
  const cutoff = new Date(now() - PRIVATE_REPLY_WINDOW_DAYS * 86_400_000).toISOString();
  const expired = await pool.query(
    `update reply_events set status = 'skipped_expired', updated_at = now()
      where status in ('queued', 'failed_transient') and coalesce(comment_at, received_at) < $1::timestamptz
      returning id`,
    [cutoff],
  );
  const ready = await pool.query<{ id: string; attempts: number }>(
    `select e.id, e.attempts
       from reply_events e
       join meta_accounts m on m.platform = e.platform and m.meta_account_id = e.meta_account_id and m.org_id = e.org_id
      where e.status in ('queued', 'failed_transient')
        and (e.next_attempt_at is null or e.next_attempt_at <= $1::timestamptz)
        and m.messaging_status in ('unknown', 'ok', 'rate_limited')
        and (m.paused_until is null or m.paused_until <= $1::timestamptz)
      order by e.received_at, e.id
      limit $2`,
    [new Date(now()).toISOString(), opts.limit ?? 200],
  );
  return { expired: expired.rows.length, ready: ready.rows.map((r) => ({ id: r.id, attempts: Number(r.attempts) })) };
}

/** The Graph API sender (private reply, optional public reply). */
export class GraphReplySender implements ReplySender {
  constructor(
    private readonly graph: import('../meta/graph').GraphClient,
    private readonly tokens: import('../meta/graph').PageTokenStore,
  ) {}

  private async token(t: ReplyTarget): Promise<string | null> {
    return (await this.tokens.tokenFor(t.accountId)) ?? (t.linkedPageId ? await this.tokens.tokenFor(t.linkedPageId) : null);
  }

  async privateReply(t: ReplyTarget): Promise<SendResult> {
    const token = await this.token(t);
    if (!token) return { ok: false, error: { code: 190, subcode: null, message: 'no Page token for this account', httpStatus: null }, retryAfterSeconds: null };
    const res = await this.graph.call<{ message_id?: string }>('POST', `/${encodeURIComponent(t.accountId)}/messages`, token, {
      recipient: { comment_id: t.commentId },
      message: { text: t.text },
    });
    if (res.ok) return { ok: true, messageId: res.body.message_id ?? null };
    if (res.error?.code === 190) this.tokens.invalidate();
    return { ok: false, error: res.error, retryAfterSeconds: res.retryAfterSeconds };
  }

  async publicReply(t: ReplyTarget): Promise<SendResult> {
    const token = await this.token(t);
    if (!token) return { ok: false, error: { code: 190, subcode: null, message: 'no Page token for this account', httpStatus: null }, retryAfterSeconds: null };
    const path = t.platform === 'instagram' ? `/${encodeURIComponent(t.commentId)}/replies` : `/${encodeURIComponent(t.commentId)}/comments`;
    const res = await this.graph.call<{ id?: string }>('POST', path, token, { message: t.text });
    return res.ok ? { ok: true, messageId: res.body.id ?? null } : { ok: false, error: res.error, retryAfterSeconds: res.retryAfterSeconds };
  }
}
