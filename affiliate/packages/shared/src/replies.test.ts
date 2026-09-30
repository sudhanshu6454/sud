import { describe, expect, it } from 'vitest';
import {
  buildReplyText,
  classifyMetaError,
  isOptOut,
  matchKeyword,
  normaliseKeyword,
  parseMetaWebhook,
  replyTextRefusal,
  samePost,
  splitUrl,
  utf8ByteLength,
} from './replies.js';

const SITE = 'https://afflino.com';
const LOOK = `${SITE}/looks/0f8fad5b-d9cb-469f-a165-70867728950e`;

describe('keywords', () => {
  it('matches whole words, case- and punctuation-insensitive; never an opt-out word as a keyword', () => {
    expect(matchKeyword('LINK please!!', ['link'])).toBe('link');
    expect(matchKeyword('linked', ['link'])).toBeNull();
    expect(matchKeyword('can you send link?', ['send link'])).toBe('send link');
    expect(matchKeyword('प्राइस बताओ', ['प्राइस'])).toBe('प्राइस');
    expect(normaliseKeyword('  Price, please ')).toBe('price please');
    expect(normaliseKeyword('STOP')).toBeNull();
    expect(normaliseKeyword('x'.repeat(31))).toBeNull();
    expect(isOptOut(' Stop ')).toBe(true);
    expect(isOptOut('stop it now')).toBe(false);
  });

  it('matches a Facebook post id with or without the page prefix', () => {
    expect(samePost('111_222', '222')).toBe(true);
    expect(samePost('111_222', '111_222')).toBe(true);
    expect(samePost('111_223', '222')).toBe(false);
    expect(samePost(null, '222')).toBe(false);
  });
});

describe('parseMetaWebhook', () => {
  it('reads Instagram comments in both shapes and both id fields', () => {
    const a = parseMetaWebhook({
      object: 'instagram',
      entry: [{ id: '178', time: 1790000000, changes: [{ field: 'comments', value: { id: 'c1', text: 'link', from: { id: 'u1' }, media: { id: 'm1' } } }] }],
    });
    expect(a.comments).toEqual([{ platform: 'instagram', accountId: '178', commentId: 'c1', postId: 'm1', parentId: null, fromId: 'u1', text: 'link', time: 1790000000 }]);
    const b = parseMetaWebhook({ object: 'instagram', entry: [{ id: '178', field: 'comments', value: { comment_id: 'c2', text: 'x', from: { id: 'u2' }, media: { id: 'm1' } } }] });
    expect(b.comments[0]).toMatchObject({ commentId: 'c2', fromId: 'u2' });
  });

  it('reads Facebook feed comments with verb=add only; ignores everything else', () => {
    const feed = (verb: string, item = 'comment') => ({
      object: 'page',
      entry: [{ id: 'p1', changes: [{ field: 'feed', value: { item, verb, comment_id: 'fc', post_id: 'p1_9', from: { id: 'u' }, message: 'link', created_time: 1790000001 } }] }],
    });
    expect(parseMetaWebhook(feed('add')).comments).toHaveLength(1);
    expect(parseMetaWebhook(feed('add')).comments[0]!.time).toBe(1790000001);
    expect(parseMetaWebhook(feed('edited')).comments).toHaveLength(0);
    expect(parseMetaWebhook(feed('add', 'reaction')).comments).toHaveLength(0);
    expect(parseMetaWebhook({ object: 'user', entry: [] }).ignored).toBe(1);
    expect(parseMetaWebhook('nonsense').comments).toEqual([]);
  });

  it('keeps messages only for the opt-out check (echoes ignored)', () => {
    const m = parseMetaWebhook({
      object: 'instagram',
      entry: [{ id: '178', messaging: [{ sender: { id: 's1' }, message: { text: 'STOP' } }, { sender: { id: '178' }, message: { text: 'hi', is_echo: true } }] }],
    });
    expect(m.messages).toEqual([{ platform: 'instagram', accountId: '178', senderId: 's1', text: 'STOP' }]);
  });
});

describe('the one message', () => {
  it('carries only the look page URL, plain text, within 1000 bytes, the label first, the opt-out line', () => {
    const text = buildReplyText({ lookUrl: LOOK, siteOrigin: SITE });
    expect(text.startsWith('Ad')).toBe(true);
    expect(text).toContain(LOOK);
    expect(text).toMatch(/Reply STOP/);
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(1000);
    expect(replyTextRefusal(text, SITE)).toBeNull();
  });

  it('refuses every other link: /r/, merchants, other hosts, queries, two URLs, http, credentials', () => {
    const cases: Array<[string, string]> = [
      [`${SITE}/r/0123456789abcdef0123456789abcdef`, 'tracked_link'],
      ['https://www.amazon.in/dp/B0DEMO0001', 'merchant_url'],
      ['see amzn.in/d/abc', 'merchant_url'],
      [`${LOOK} ${LOOK}`, 'several_urls'],
      [`${LOOK}?utm_source=dm`, 'url_has_query'],
      [`${LOOK}#x`, 'url_has_query'],
      ['http://afflino.com/looks/0f8fad5b-d9cb-469f-a165-70867728950e', 'url_not_https'],
      ['https://user@afflino.com/looks/0f8fad5b-d9cb-469f-a165-70867728950e', 'url_has_credentials'],
      ['https://afflino.com.evil.example.com/looks/0f8fad5b-d9cb-469f-a165-70867728950e', 'url_not_on_site'],
      ['https://afflino.com/shop', 'url_not_a_look_page'],
      ['shop.example.com/deal', 'url_invalid'],
      ['no link at all', 'no_url'],
    ];
    for (const [t, why] of cases) expect(replyTextRefusal(`Ad ${t}`, SITE), t).toBe(why);
    expect(() => buildReplyText({ lookUrl: `${SITE}/r/0123456789abcdef0123456789abcdef`, siteOrigin: SITE })).toThrow(/tracked_link/);
    expect(() => buildReplyText({ lookUrl: 'https://www.amazon.in/dp/B0DEMO0001', siteOrigin: 'https://www.amazon.in' })).toThrow(/merchant_url/);
    expect(replyTextRefusal(`Ad ${SITE}/s/demo-page`, SITE)).toBeNull();
    expect(replyTextRefusal(`Ad ${LOOK}`, 'http://afflino.com')).toBe('site_origin_not_https');
    expect(splitUrl('https://Afflino.com/x?y#z')).toEqual({ scheme: 'https', authority: 'afflino.com', host: 'afflino.com', path: '/x', query: '?y', fragment: '#z' });
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('प')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });
});

describe('Meta errors', () => {
  it('classifies: auth, transient, permanent, unknown (never resent)', () => {
    expect(classifyMetaError({ code: 190, subcode: 460 })).toBe('auth');
    for (const c of [4, 17, 32, 613]) expect(classifyMetaError({ code: c })).toBe('transient');
    expect(classifyMetaError({ code: 10, subcode: 1893063 })).toBe('transient');
    for (const [c, sc] of [
      [551, 1545041],
      [100, 2534025],
      [10, 2534022],
      [10, 2018278],
      [10, 2018108],
      [200, 2534041],
      [100, 2534029],
      [100, 2534013],
      [200, 2018028],
    ] as const) {
      expect(classifyMetaError({ code: c, subcode: sc })).toBe('permanent');
    }
    expect(classifyMetaError({ code: 2 })).toBe('unknown');
    expect(classifyMetaError(null)).toBe('unknown');
    expect(classifyMetaError({ code: 100 })).toBe('permanent');
  });
});

describe('public reply templates (fixed texts only, never free text under a post)', () => {
  it('every template passes the reply wording lint, names nobody and links nowhere', async () => {
    const { PUBLIC_REPLY_TEMPLATES, isPublicReplyTemplate, urlsIn } = await import('./replies.js');
    const { replyTextFindings, mentionsName } = await import('./celebrity.js');
    expect(PUBLIC_REPLY_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of PUBLIC_REPLY_TEMPLATES) {
      expect(replyTextFindings(t), t).toEqual([]);
      expect(urlsIn(t), t).toEqual([]);
      expect(/http|www\./i.test(t), t).toBe(false);
      expect(t.length).toBeLessThanOrEqual(300);
      expect(mentionsName(t, ['Demo Star One'])).toBe(false);
      expect(isPublicReplyTemplate(t)).toBe(true);
    }
    expect(isPublicReplyTemplate('Demo Star One wore this! She loves it. Check your DMs')).toBe(false);
    // The admin's demo copy of the list (packages/web/lib/celebrity-admin.ts) is the same texts.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const web = readFileSync(join(__dirname, '..', '..', 'web', 'lib', 'celebrity-admin.ts'), 'utf8');
    for (const t of PUBLIC_REPLY_TEMPLATES) expect(web.includes(`'${t}'`), t).toBe(true);
  });
});
