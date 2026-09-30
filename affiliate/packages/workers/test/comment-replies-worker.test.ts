// Comment replies, the sending side (src/replies/sender.ts), on pg-mem with a
// stub sender: one private reply per event, only the look's afflino.com URL
// in plain text, the claim, the 7-day window, opt-outs, a rule turned off or
// a look no longer public, shadow and off modes, the hourly ceiling, and
// Meta's errors (transient → backoff, 190 → the account waits, permanent,
// unknown → never resent). TEST data only.

import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { REPLY_TEXT_MAX_BYTES, replyTextRefusal, utf8ByteLength } from '@paparazzi/shared';
import { createTestDb, type TestDatabase } from '../../api/test/pgmem.js';
import { StubReplySender, processReplyEvent, sweepReplyEvents, type ReplyDeps, type SendResult } from '../src/replies/sender.js';
import { replyConfigFromEnv } from '../src/replies/config.js';

type PgMemPool = TestDatabase['Pool'] extends new () => infer P ? P : never;
type AnyPool = Parameters<typeof processReplyEvent>[0];

const SITE = 'https://afflino.example.com';
const ORG = randomUUID();
const IG = '17841400000000077';
let pool: PgMemPool;
let lookId: string;
let ruleId: string;
let propertyId: string;
let celebId: string;
let offerId: string;

async function id(sql: string, params: unknown[]): Promise<string> {
  return String((await pool.query(sql, params)).rows[0]!.id);
}

let n = 0;
async function event(opts: { commentAt?: string; hash?: string; rule?: string } = {}): Promise<string> {
  n += 1;
  return id(
    `insert into reply_events (org_id, rule_id, property_id, platform, meta_account_id, comment_id, commenter_hash, matched_keyword, comment_at)
     values ($1, $2, $3, 'instagram', $4, $5, $6, 'link', $7::timestamptz) returning id`,
    [ORG, opts.rule ?? ruleId, propertyId, IG, `demo-comment-${n}`, opts.hash ?? String(n % 10).repeat(64), opts.commentAt ?? new Date().toISOString()],
  );
}

async function status(eventId: string) {
  return (await pool.query(`select status, attempts, error_code, message_id, next_attempt_at, public_reply_status from reply_events where id = $1`, [eventId])).rows[0]!;
}

function deps(sender: StubReplySender, over: Partial<ReplyDeps> = {}): ReplyDeps {
  return { sender, mode: 'on', siteOrigin: SITE, ...over };
}

beforeAll(async () => {
  const tdb = createTestDb();
  pool = new tdb.Pool();
  await pool.query(`insert into organisations (id, name, slug) values ($1, 'Demo org', $2)`, [ORG, `demo-${ORG.slice(0, 8)}`]);
  const user = await id(`insert into users (email) values ('reviewer@demo.example.com') returning id`, []);
  const publisher = await id(`insert into publishers (org_id, legal_name, country, status, onboarding_state) values ($1, 'Demo in-house', 'IN', 'approved', 'active') returning id`, [ORG]);
  propertyId = await id(
    `insert into properties (org_id, publisher_id, platform, external_account_id, status) values ($1, $2, 'instagram', 'demo.replies', 'approved') returning id`,
    [ORG, publisher],
  );
  celebId = await id(
    `insert into celebrities (org_id, name, name_key, slug, rights_status, max_display, shoppable, rights_evidence_ref, rights_reviewed_by, rights_reviewed_at)
     values ($1, 'Demo Star Nine', 'demo star nine', 'demo-star-nine', 'cleared', 'name_only', true, 'TEST-REF', $2, now()) returning id`,
    [ORG, user],
  );
  lookId = await id(
    `insert into looks (org_id, title, status, published_at, celebrity_id, property_id, platform_post_id) values ($1, 'Demo look', 'published', now(), $2, $3, 'demo-media-1') returning id`,
    [ORG, celebId, propertyId],
  );
  // The look carries a product on a live offer (a reply goes out only for a look that does).
  const merchant = await id(`insert into merchants (org_id, name) values ($1, 'Demo Merchant') returning id`, [ORG]);
  const programme = await id(
    `insert into programmes (org_id, merchant_id, connector, name, status, commission_basis) values ($1, $2, 'stub-network', 'Demo programme', 'active', 'sale') returning id`,
    [ORG, merchant],
  );
  const product = await id(`insert into products (org_id, brand, model, category) values ($1, 'Demo Brand', 'Demo shirt', 'Clothing') returning id`, [ORG]);
  const variant = await id(`insert into variants (org_id, product_id, merchant_sku) values ($1, $2, 'demo-sku-1') returning id`, [ORG, product]);
  offerId = await id(
    `insert into offers (org_id, variant_id, programme_id, merchant_id, price_minor, offer_url, fresh_until, status) values ($1, $2, $3, $4, 100, 'https://shop.example.com/p/1', now() + interval '1 day', 'active') returning id`,
    [ORG, variant, programme, merchant],
  );
  const piece = await id(`insert into look_pieces (org_id, look_id, label, garment_category, position) values ($1, $2, 'The shirt', 'shirt', 0) returning id`, [ORG, lookId]);
  await pool.query(
    `insert into look_items (org_id, look_id, variant_id, match_type, piece_id, review_state, tagged_by) values ($1, $2, $3, 'similar', $4, 'approved', $5)`,
    [ORG, lookId, variant, piece, user],
  );
  ruleId = await id(
    `insert into reply_rules (org_id, look_id, property_id, platform_post_id, keywords, public_reply, enabled) values ($1, $2, $3, 'demo-media-1', $4, 'We sent you a message with the link.', true) returning id`,
    [ORG, lookId, propertyId, ['link']],
  );
  await pool.query(`insert into meta_accounts (org_id, property_id, platform, meta_account_id, linked_page_id, messaging_status) values ($1, $2, 'instagram', $3, '100000000000077', 'ok')`, [
    ORG,
    propertyId,
    IG,
  ]);
});

describe('processReplyEvent', () => {
  it('sends one private reply with only the look’s afflino.com URL, then the public reply; a replay is a no-op', async () => {
    const sender = new StubReplySender();
    const e = await event();
    expect(await processReplyEvent(pool as unknown as AnyPool, e, deps(sender))).toBe('sent');
    expect(sender.calls.map((c) => c.kind)).toEqual(['private', 'public']);
    const text = sender.calls[0]!.target.text;
    expect(text).toContain(`${SITE}/looks/${lookId}`);
    expect(text.match(/https?:\/\/\S+/g)).toEqual([`${SITE}/looks/${lookId}`]);
    expect(text).not.toMatch(/\/r\/|amazon|amzn/i);
    expect(text).not.toContain('Demo Star Nine');
    expect(text.startsWith('Ad')).toBe(true);
    expect(text).toMatch(/automated message/i);
    expect(text).toMatch(/Reply STOP/);
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(REPLY_TEXT_MAX_BYTES);
    expect(sender.calls[0]!.target).toMatchObject({ platform: 'instagram', accountId: IG, linkedPageId: '100000000000077' });
    expect(sender.calls[1]!.target.text).toBe('We sent you a message with the link.');
    expect(await status(e)).toMatchObject({ status: 'sent', attempts: 1, message_id: 'stub-mid', public_reply_status: 'sent' });
    expect(await processReplyEvent(pool as unknown as AnyPool, e, deps(sender))).toBe('not_claimed');
    expect(sender.calls).toHaveLength(2);
  });

  it('never sends a /r/ link or a merchant URL: the text check refuses them before any send', async () => {
    expect(replyTextRefusal(`Ad: ${SITE}/r/0123456789abcdef0123456789abcdef`, SITE)).toBe('tracked_link');
    expect(replyTextRefusal('Ad: https://www.amazon.in/dp/B0DEMO0001', SITE)).toBe('merchant_url');
    expect(replyTextRefusal('Ad: amzn.to/abc', SITE)).toBe('merchant_url');
    expect(replyTextRefusal(`Ad: ${SITE}/looks/${lookId} and https://shop.example.com/x`, SITE)).toBe('several_urls');
    expect(replyTextRefusal(`Ad: ${SITE}/looks/${lookId}?utm=1`, SITE)).toBe('url_has_query');
    expect(replyTextRefusal(`Ad: https://evil.example.com/looks/${lookId}`, SITE)).toBe('url_not_on_site');
    expect(replyTextRefusal(`Ad: http://afflino.example.com/looks/${lookId}`, SITE)).toBe('url_not_https');
    expect(replyTextRefusal(`Ad: ${SITE}/shop`, SITE)).toBe('url_not_a_look_page');
    expect(replyTextRefusal(`${'x'.repeat(1001)} ${SITE}/looks/${lookId}`, SITE)).toBe('too_long');
    expect(replyTextRefusal(`Ad: ${SITE}/looks/${lookId}`, SITE)).toBeNull();
    // Even a misconfigured site origin cannot turn the message into a merchant link.
    const sender = new StubReplySender();
    const e = await event();
    expect(await processReplyEvent(pool as unknown as AnyPool, e, deps(sender, { siteOrigin: 'https://www.amazon.in' }))).toBe('failed_permanent');
    expect(sender.calls).toHaveLength(0);
    expect((await status(e)).error_code).toBe('text_refused');
  });

  it('skips: past the 7-day window, an opted-out commenter, a rule turned off, a look no longer public', async () => {
    const sender = new StubReplySender();
    const old = await event({ commentAt: new Date(Date.now() - 8 * 86_400_000).toISOString() });
    expect(await processReplyEvent(pool as unknown as AnyPool, old, deps(sender))).toBe('skipped_expired');
    await pool.query(`insert into reply_suppressions (org_id, platform, commenter_hash) values ($1, 'instagram', $2)`, [ORG, 'f'.repeat(64)]);
    const opted = await event({ hash: 'f'.repeat(64) });
    expect(await processReplyEvent(pool as unknown as AnyPool, opted, deps(sender))).toBe('skipped_suppressed');
    await pool.query(`update reply_rules set enabled = false where id = $1`, [ruleId]);
    const off = await event();
    expect(await processReplyEvent(pool as unknown as AnyPool, off, deps(sender))).toBe('skipped_disabled');
    await pool.query(`update reply_rules set enabled = true where id = $1`, [ruleId]);
    await pool.query(`update celebrities set rights_status = 'blocked', max_display = 'none', shoppable = false where id = $1`, [celebId]);
    const hidden = await event();
    expect(await processReplyEvent(pool as unknown as AnyPool, hidden, deps(sender))).toBe('skipped_disabled');
    expect((await status(hidden)).error_code).toBe('look_not_public');
    await pool.query(`update celebrities set rights_status = 'cleared', max_display = 'name_only', shoppable = true where id = $1`, [celebId]);
    expect(sender.calls).toHaveLength(0);
  });

  it('skips a look that carries no products: a review that turned products off, or no product on a live offer', async () => {
    const sender = new StubReplySender();
    // Name only, no products (the message says the page has affiliate links): no message.
    await pool.query(`update celebrities set shoppable = false where id = $1`, [celebId]);
    const nameOnly = await event();
    expect(await processReplyEvent(pool as unknown as AnyPool, nameOnly, deps(sender))).toBe('skipped_disabled');
    expect((await status(nameOnly)).error_code).toBe('look_not_shoppable');
    await pool.query(`update celebrities set shoppable = true where id = $1`, [celebId]);
    await pool.query(`update offers set status = 'stale' where id = $1`, [offerId]);
    const stale = await event();
    expect(await processReplyEvent(pool as unknown as AnyPool, stale, deps(sender))).toBe('skipped_disabled');
    expect((await status(stale)).error_code).toBe('look_not_shoppable');
    await pool.query(`update offers set status = 'active' where id = $1`, [offerId]);
    expect(sender.calls).toHaveLength(0);
  });

  it('off: nothing happens; shadow: everything but the send', async () => {
    const sender = new StubReplySender();
    const e = await event();
    expect(await processReplyEvent(pool as unknown as AnyPool, e, deps(sender, { mode: 'off' }))).toBe('sending_off');
    expect((await status(e)).status).toBe('queued');
    expect(await processReplyEvent(pool as unknown as AnyPool, e, deps(sender, { mode: 'shadow' }))).toBe('skipped_shadow');
    expect(sender.calls).toHaveLength(0);
  });

  it('holds at the hourly ceiling without claiming', async () => {
    const sender = new StubReplySender();
    const e = await event();
    expect(await processReplyEvent(pool as unknown as AnyPool, e, deps(sender, { hourlyCeiling: 1 }))).toBe('rate_ceiling');
    const s = await status(e);
    expect(s).toMatchObject({ status: 'queued', attempts: 0 });
    expect(new Date(s.next_attempt_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(sender.calls).toHaveLength(0);
  });

  it('Meta errors: throttled → retried later with backoff; 190 → the account waits, the event stays; permanent; unknown is never resent', async () => {
    const answer = (r: SendResult) => new StubReplySender(() => r);
    const throttled = await event();
    const t = answer({ ok: false, error: { code: 613, subcode: null, message: 'rate', httpStatus: 400 }, retryAfterSeconds: null });
    expect(await processReplyEvent(pool as unknown as AnyPool, throttled, deps(t))).toBe('failed_transient');
    const ts = await status(throttled);
    expect(ts).toMatchObject({ status: 'failed_transient', attempts: 1, error_code: '613/' });
    expect(new Date(ts.next_attempt_at as string).getTime()).toBeGreaterThan(Date.now() + 50_000);
    // Not due yet: not claimed again.
    expect(await processReplyEvent(pool as unknown as AnyPool, throttled, deps(t))).toBe('not_claimed');

    const auth = await event();
    const a = answer({ ok: false, error: { code: 190, subcode: 460, message: 'token', httpStatus: 400 }, retryAfterSeconds: null });
    expect(await processReplyEvent(pool as unknown as AnyPool, auth, deps(a))).toBe('auth_paused');
    expect(await status(auth)).toMatchObject({ status: 'queued', attempts: 0 });
    const acc = await pool.query(`select messaging_status from meta_accounts where org_id = $1`, [ORG]);
    expect(acc.rows[0]!.messaging_status).toBe('token_invalid');
    // While the token is invalid, nothing is claimed and the sweep lists nothing.
    expect(await processReplyEvent(pool as unknown as AnyPool, auth, deps(new StubReplySender()))).toBe('account_paused');
    expect((await sweepReplyEvents(pool as unknown as AnyPool)).ready).toEqual([]);
    await pool.query(`update meta_accounts set messaging_status = 'ok' where org_id = $1`, [ORG]);

    const perm = await event();
    const p = answer({ ok: false, error: { code: 10, subcode: 2534022, message: 'outside window', httpStatus: 400 }, retryAfterSeconds: null });
    expect(await processReplyEvent(pool as unknown as AnyPool, perm, deps(p))).toBe('failed_permanent');
    expect((await status(perm)).error_code).toBe('10/2534022');

    const unknown = await event();
    const u = answer({ ok: false, error: null, retryAfterSeconds: null });
    expect(await processReplyEvent(pool as unknown as AnyPool, unknown, deps(u))).toBe('unknown');
    expect(await processReplyEvent(pool as unknown as AnyPool, unknown, deps(new StubReplySender()))).toBe('not_claimed');
    expect(await status(unknown)).toMatchObject({ status: 'unknown', attempts: 1 });
  });

  it('two workers on one event: exactly one send', async () => {
    const sender = new StubReplySender();
    const e = await event();
    const outcomes = await Promise.all([
      processReplyEvent(pool as unknown as AnyPool, e, deps(sender)),
      processReplyEvent(pool as unknown as AnyPool, e, deps(sender)),
    ]);
    expect(outcomes.filter((o) => o === 'sent')).toHaveLength(1);
    expect(sender.calls.filter((c) => c.kind === 'private')).toHaveLength(1);
  });
});

describe('sweep and settings', () => {
  it('expires what is past the window whatever the mode, and lists ready events', async () => {
    const old = await event({ commentAt: new Date(Date.now() - 10 * 86_400_000).toISOString() });
    const fresh = await event();
    const out = await sweepReplyEvents(pool as unknown as AnyPool);
    expect(out.expired).toBeGreaterThanOrEqual(1);
    expect((await status(old)).status).toBe('skipped_expired');
    expect(out.ready.map((r) => r.id)).toContain(fresh);
  });

  it('COMMENT_REPLIES_SENDING: off by default; on without both Meta secrets falls back to off', () => {
    expect(replyConfigFromEnv({}).mode).toBe('off');
    expect(replyConfigFromEnv({ COMMENT_REPLIES_SENDING: 'shadow' }).mode).toBe('shadow');
    const on = replyConfigFromEnv({ COMMENT_REPLIES_SENDING: 'on', META_APP_SECRET: 'x' });
    expect(on.mode).toBe('off');
    expect(on.reason).toMatch(/nothing is sent/);
    expect(replyConfigFromEnv({ COMMENT_REPLIES_SENDING: 'on', META_APP_SECRET: 'x', META_SYSTEM_USER_TOKEN: 'y', SITE_URL: 'https://afflino.com/' })).toMatchObject({
      mode: 'on',
      siteOrigin: 'https://afflino.com',
    });
  });
});
