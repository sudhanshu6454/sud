import { describe, expect, it } from 'vitest';
import { ApiError, type CreateLinkBody } from '../lib/api';
import { DEMO_CREATOR, DEMO_MY_LINKS, DEMO_OFFERS, demoLinkUrl } from '../lib/demo/afflino';
import {
  CATEGORY_SHORT,
  DEMO_GENERATOR_OFFER_ID,
  DEMO_LINK_HANDLE,
  DEMO_LINK_OFFERS,
  demoDraftDefaults,
  demoLinkOfferById,
} from '../lib/demo/links';
import { formatPayout } from '../lib/format';
import {
  composeDemoLink,
  estimatedPayoutMinor,
  FALLBACK_REDIRECT_BASE,
  filterLinks,
  filterOffers,
  hostAllowed,
  linkHref,
  validateUuid,
  demoLinkHref,
  DEMO_LINK_PAYLOAD_HOST,
  mintLiveLink,
  parsePayout,
  qrFileName,
  sortOffers,
  validateLandingPage,
} from '../lib/links';
import { validateSubId } from '../lib/validators';

const offer = (id: string) => {
  const o = demoLinkOfferById(id);
  if (!o) throw new Error(`no demo offer ${id}`);
  return o;
};

describe('demo link composition (the design’s readable format, never a minted link)', () => {
  it('composes afflino.com/r/{handle}/{offer}?s={sub-id} exactly like every 3c row', () => {
    for (const row of DEMO_MY_LINKS) {
      expect(composeDemoLink({ handle: DEMO_LINK_HANDLE, offerSlug: row.offerId, subId: row.subId })).toBe(row.url);
    }
    expect(composeDemoLink({ handle: 'demo-priya', offerSlug: 'demo-style', subId: 'short-diwali-02' })).toBe(
      'afflino.com/r/demo-priya/demo-style?s=short-diwali-02',
    );
  });

  it('drops ?s= without a sub-ID and agrees with demoLinkUrl()', () => {
    expect(composeDemoLink({ handle: DEMO_LINK_HANDLE, offerSlug: 'demo-payupi' })).toBe('afflino.com/r/demo-priya/demo-payupi');
    expect(composeDemoLink({ handle: DEMO_LINK_HANDLE, offerSlug: 'demo-payupi', subId: '' })).toBe(demoLinkUrl('demo-payupi'));
    expect(composeDemoLink({ handle: DEMO_LINK_HANDLE, offerSlug: 'demo-rail', subId: '  story-12  ' })).toBe(
      demoLinkUrl('demo-rail', 'story-12'),
    );
  });

  it('refuses a malformed handle, offer slug or sub-ID instead of building a broken URL', () => {
    expect(() => composeDemoLink({ handle: 'Demo Priya', offerSlug: 'demo-style' })).toThrow(/handle/);
    expect(() => composeDemoLink({ handle: 'demo-priya', offerSlug: '../x' })).toThrow(/offer slug/);
    expect(() => composeDemoLink({ handle: 'demo-priya', offerSlug: 'demo-style', subId: 'a&b=c' })).toThrow(/sub-ID|lowercase/);
    expect(() => composeDemoLink({ handle: 'demo-priya', offerSlug: 'demo-style', subId: 'x'.repeat(33) })).toThrow();
  });

  it('adds https:// for copy and QR only when the display drops the scheme', () => {
    expect(linkHref('afflino.com/r/demo-priya/demo-style')).toBe('https://afflino.com/r/demo-priya/demo-style');
    expect(linkHref('http://localhost:3001/r/9f2c1ab4e5d64f7a8b9c0d1e2f3a4b5c')).toBe(
      'http://localhost:3001/r/9f2c1ab4e5d64f7a8b9c0d1e2f3a4b5c',
    );
    expect(linkHref('https://redirect.demo.invalid/r/demo-abc')).toBe('https://redirect.demo.invalid/r/demo-abc');
  });

  it('a demo link keeps the drawn display but copies, encodes and shares a reserved host', () => {
    const display = composeDemoLink({ handle: 'demo-priya', offerSlug: 'demo-style', subId: 'short-diwali-02' });
    expect(display).toBe('afflino.com/r/demo-priya/demo-style?s=short-diwali-02');
    expect(DEMO_LINK_PAYLOAD_HOST.endsWith('.invalid')).toBe(true);
    expect(demoLinkHref(display)).toBe('https://afflino.demo.invalid/r/demo-priya/demo-style?s=short-diwali-02');
    expect(demoLinkHref('https://afflino.com/r/demo-priya/demo-style')).toBe('https://afflino.demo.invalid/r/demo-priya/demo-style');
    expect(() => demoLinkHref('https://example.com/r/x')).toThrow(/not a demo link/);
  });

  it('QR file names are slugs', () => {
    expect(qrFileName('demo-style', 'short-diwali-02')).toBe('afflino-qr-demo-style-short-diwali-02.png');
    expect(qrFileName('demo-style', '')).toBe('afflino-qr-demo-style.png');
    expect(qrFileName('live', '9F2C/../x')).toBe('afflino-qr-live-9f2c-x.png');
    expect(qrFileName()).toBe('afflino-qr.png');
  });
});

describe('sub-ID (a–z, 0–9, hyphen, at most 32)', () => {
  it.each([
    ['', true],
    ['reel-oct-01', true],
    ['short-diwali-02', true],
    ['a'.repeat(32), true],
    ['a'.repeat(33), false],
    ['Reel-Oct', false],
    ['reel_oct', false],
    ['reel oct', false],
    ['reel/oct', false],
    ['réel', false],
  ])('%j → ok %s', (input, ok) => {
    expect(validateSubId(input).ok).toBe(ok);
  });
});

describe('landing page must be on the offer’s allowed host', () => {
  const allowed = ['shop.example.com'];

  it.each([
    ['shop.example.com/diwali-sale', 'https://shop.example.com/diwali-sale'],
    ['https://shop.example.com/diwali-sale?utm=x', 'https://shop.example.com/diwali-sale?utm=x'],
    ['HTTPS://SHOP.EXAMPLE.COM/Festive', 'https://shop.example.com/Festive'],
    ['http://shop.example.com', 'http://shop.example.com/'],
    ['//shop.example.com/x', 'https://shop.example.com/x'],
    ['shop.example.com:8443/x', 'https://shop.example.com:8443/x'],
    ['  shop.example.com/x  ', 'https://shop.example.com/x'],
    ['shop.example.com./x', 'https://shop.example.com./x'],
  ])('accepts %j → %j', (input, normalised) => {
    const r = validateLandingPage(input, allowed);
    expect(r).toEqual({ ok: true, message: '', value: normalised });
  });

  it.each([
    ['', /Enter the landing page/],
    ['evil.test/diwali', /shop\.example\.com/],
    ['shop.example.com.evil.test/x', /shop\.example\.com/],
    ['evilshop.example.com/x', /shop\.example\.com/],
    ['www.shop.example.com/x', /shop\.example\.com/], // exact host, as the API's allowed_domains check
    ['https://evil.test/#shop.example.com', /shop\.example\.com/],
    ['https://evil.test/?u=shop.example.com', /shop\.example\.com/],
    ['https://shop.example.com@evil.test/', /user name or password/],
    ['https://user:pw@shop.example.com/', /user name or password/],
    ['javascript:alert(1)', /web page address/],
    ['mailto:a@shop.example.com', /web page address/],
    ['data:text/html,hi', /web page address/],
    ['ftp://shop.example.com/x', /web page address/],
    ['shop.example.com /x', /no spaces/],
    ['https://', /not a web address/],
  ])('rejects %j', (input, message) => {
    const r = validateLandingPage(input, allowed);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(message);
    expect(r.value).toBeUndefined();
  });

  it('names every allowed host in the error', () => {
    expect(validateLandingPage('evil.test', ['a.example.com', 'b.example.com', 'c.example.com']).message).toContain(
      'a.example.com, b.example.com or c.example.com',
    );
  });

  it('hostAllowed is exact and case-insensitive', () => {
    expect(hostAllowed('SHOP.example.com', allowed)).toBe(true);
    expect(hostAllowed('shop.example.com.', allowed)).toBe(true);
    expect(hostAllowed('m.shop.example.com', allowed)).toBe(false);
    expect(hostAllowed('', allowed)).toBe(false);
    expect(hostAllowed('shop.example.com', [])).toBe(false);
  });

  it('every demo offer’s default landing page passes for its own offer and fails for the others', () => {
    for (const o of DEMO_LINK_OFFERS) {
      expect(validateLandingPage(o.defaultLanding, o.allowedDomains).ok).toBe(true);
      for (const other of DEMO_LINK_OFFERS.filter((x) => x.id !== o.id)) {
        expect(validateLandingPage(o.defaultLanding, other.allowedDomains).ok).toBe(false);
      }
    }
  });
});

describe('payout parsing and "Sort: Highest payout"', () => {
  it('parses every payout the design prints back to the structured value', () => {
    for (const o of DEMO_OFFERS) expect(parsePayout(formatPayout(o.payout))).toEqual(o.payout);
    expect(parsePayout('₹180 / sign-up')).toEqual({ type: 'flat', amountMinor: 18_000, per: 'sign-up' });
    expect(parsePayout('12% / sale')).toEqual({ type: 'percent', percent: 12, per: 'sale' });
  });

  it('reads Indian and western grouping, paise, decimals and "per" without floating point', () => {
    expect(parsePayout('₹1,250 / lead')).toEqual({ type: 'flat', amountMinor: 125_000, per: 'lead' });
    expect(parsePayout('₹1,84,320 / order')).toEqual({ type: 'flat', amountMinor: 18_432_000, per: 'order' });
    expect(parsePayout('₹6.50 / click')).toEqual({ type: 'flat', amountMinor: 650, per: 'click' });
    expect(parsePayout('₹6.5 / click')).toEqual({ type: 'flat', amountMinor: 650, per: 'click' });
    expect(parsePayout('₹0.07 / view')).toEqual({ type: 'flat', amountMinor: 7, per: 'view' });
    expect(parsePayout('4.5% / booking')).toEqual({ type: 'percent', percent: 4.5, per: 'booking' });
    expect(parsePayout('₹180 per verified sign-up')).toEqual({ type: 'flat', amountMinor: 18_000, per: 'verified sign-up' });
    expect(parsePayout(' ₹ 40 /Purchase ')).toEqual({ type: 'flat', amountMinor: 4_000, per: 'purchase' });
  });

  it.each(['', '180', '₹180', '₹ / sale', '12%', '120% / sale', '0% / sale', '₹1,8,0 / x', '₹180.123 / x', 'free / sale'])(
    'rejects %j',
    (text) => {
      expect(parsePayout(text)).toBeNull();
    },
  );

  it('estimates rupees per conversion: flat as is, percent × the reference order value', () => {
    expect(estimatedPayoutMinor({ type: 'flat', amountMinor: 18_000, per: 'sign-up' })).toBe(18_000);
    expect(estimatedPayoutMinor({ type: 'percent', percent: 12, per: 'sale' }, 140_000)).toBe(16_800);
    expect(estimatedPayoutMinor({ type: 'percent', percent: 4, per: 'booking' }, 50_000)).toBe(2_000);
    expect(estimatedPayoutMinor({ type: 'percent', percent: 4.5, per: 'booking' }, 33_333)).toBe(1_500);
    expect(estimatedPayoutMinor({ type: 'percent', percent: 12, per: 'sale' })).toBeNull();
    expect(estimatedPayoutMinor({ type: 'percent', percent: 12, per: 'sale' }, 0)).toBeNull();
  });

  it('"Highest payout" reproduces the order 1d draws under that sort', () => {
    expect(sortOffers(DEMO_LINK_OFFERS, 'payout-desc').map((o) => o.id)).toEqual(DEMO_OFFERS.map((o) => o.id));
    expect(sortOffers(DEMO_LINK_OFFERS, 'payout-desc').map((o) => formatPayout(o.payout))).toEqual([
      '₹180 / sign-up',
      '12% / sale',
      '₹150 / lead',
      '₹40 / purchase',
      '₹22 / install',
      '4% / booking',
    ]);
  });

  it('"Lowest payout" and "Brand A–Z"', () => {
    expect(sortOffers(DEMO_LINK_OFFERS, 'payout-asc').map((o) => o.id)).toEqual([
      'demo-rail',
      'demo-ludo',
      'demo-eats',
      'demo-learn',
      'demo-style',
      'demo-payupi',
    ]);
    expect(sortOffers(DEMO_LINK_OFFERS, 'name').map((o) => o.name)).toEqual([
      'Demo Eats Gold',
      'Demo Learn Plus',
      'Demo Ludo Arena',
      'Demo PayUPI',
      'Demo Rail Trips',
      'Demo Style Festive',
    ]);
  });

  it('percentage offers with no rupee estimate rank after the rest, by percent; ties keep their order; input untouched', () => {
    const list = [
      { name: 'A', payout: { type: 'percent' as const, percent: 4, per: 'sale' } },
      { name: 'B', payout: { type: 'flat' as const, amountMinor: 100, per: 'lead' } },
      { name: 'C', payout: { type: 'percent' as const, percent: 12, per: 'sale' } },
      { name: 'D', payout: { type: 'flat' as const, amountMinor: 100, per: 'lead' } },
      { name: 'E', payout: { type: 'flat' as const, amountMinor: 5_000, per: 'lead' } },
    ];
    const before = list.map((o) => o.name);
    expect(sortOffers(list, 'payout-desc').map((o) => o.name)).toEqual(['E', 'B', 'D', 'C', 'A']);
    expect(sortOffers(list, 'payout-asc').map((o) => o.name)).toEqual(['B', 'D', 'E', 'A', 'C']);
    expect(list.map((o) => o.name)).toEqual(before);
  });
});

describe('offer search / category filter and the "My links" filter', () => {
  it('searches brand, category and model; every word must match', () => {
    const ids = (q: string, category: string | null = null) => filterOffers(DEMO_LINK_OFFERS, { query: q, category }).map((o) => o.id);
    expect(ids('')).toHaveLength(DEMO_LINK_OFFERS.length);
    expect(ids('fintech')).toEqual(['demo-payupi']);
    expect(ids('PAYUPI')).toEqual(['demo-payupi']);
    expect(ids('cps')).toEqual(['demo-style', 'demo-rail']);
    expect(ids('demo  cps travel')).toEqual(['demo-rail']);
    expect(ids('food')).toEqual(['demo-eats']);
    expect(ids('zzz')).toEqual([]);
    expect(ids('', 'Gaming')).toEqual(['demo-ludo']);
    expect(ids('ludo', 'Fintech')).toEqual([]);
  });

  it('filters links by offer, URL, sub-ID, platform and status', () => {
    const rows = DEMO_MY_LINKS.map((l) => ({ ...l, platformName: l.platform === 'snapchat' ? 'Snapchat' : l.platform }));
    const offers = (q: string) => filterLinks(rows, q).map((r) => r.offer);
    expect(offers('')).toHaveLength(DEMO_MY_LINKS.length);
    expect(offers('review')).toEqual(['Demo Eats Gold']);
    expect(offers('snapchat')).toEqual(['Demo Eats Gold']);
    expect(offers('yt-long')).toEqual(['Demo Learn Plus']);
    expect(offers('active meta')).toEqual(['Demo PayUPI', 'Demo Rail Trips']);
    expect(offers('nothing-here')).toEqual([]);
  });
});

describe('live minting — POST /v1/links (the restored LinkBuilder path)', () => {
  const body: CreateLinkBody = {
    property_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    programme_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    offer_id: '11111111-2222-4333-8444-555555555555',
    placement_id: '22222222-3333-4444-8555-666666666666',
  };

  it('posts the four ids and shows exactly the URL the API composed', async () => {
    const calls: Array<{ path: string; options: unknown }> = [];
    const result = await mintLiveLink(body, {
      fetcher: (async (path: string, options: unknown) => {
        calls.push({ path, options });
        return { token: '9f2c1ab4e5d64f7a8b9c0d1e2f3a4b5c', url: 'http://localhost:3001/r/9f2c1ab4e5d64f7a8b9c0d1e2f3a4b5c' };
      }) as never,
    });
    expect(calls).toEqual([{ path: '/v1/links', options: { method: 'POST', body } }]);
    expect(result).toEqual({
      kind: 'live',
      token: '9f2c1ab4e5d64f7a8b9c0d1e2f3a4b5c',
      url: 'http://localhost:3001/r/9f2c1ab4e5d64f7a8b9c0d1e2f3a4b5c',
    });
  });

  it('sends the Idempotency-Key it is given, so a retry cannot mint a second link', async () => {
    const calls: Array<{ path: string; options: unknown }> = [];
    await mintLiveLink(body, {
      idempotencyKey: 'link-abc',
      fetcher: (async (path: string, options: unknown) => {
        calls.push({ path, options });
        return { token: 't', url: 'http://localhost:3001/r/t' };
      }) as never,
    });
    expect(calls).toEqual([{ path: '/v1/links', options: { method: 'POST', body, headers: { 'Idempotency-Key': 'link-abc' } } }]);
  });

  it('checks each pasted id as a uuid (no listing endpoint exists)', () => {
    expect(validateUuid(' AAAAAAAA-aaaa-4aaa-8aaa-aaaaaaaaaaaa ', 'property id')).toEqual({
      ok: true,
      message: '',
      value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(validateUuid('', 'property id').message).toBe('Enter the property id.');
    expect(validateUuid('demo-org', 'offer id').message).toBe(
      'That is not a uuid: the offer id has 32 hex digits in groups of 8-4-4-4-12.',
    );
  });

  it.each(['NETWORK_UNREACHABLE', 'UPSTREAM_UNAVAILABLE'])(
    'an unreachable API (%s) gives a labelled, untracked .invalid link',
    async (code) => {
      const result = await mintLiveLink(body, {
        fetcher: (async () => {
          throw new ApiError(code, 'down', code === 'NETWORK_UNREACHABLE' ? 0 : 502);
        }) as never,
        demoToken: () => 'demo-abc12345',
      });
      expect(result).toEqual({ kind: 'fallback', token: 'demo-abc12345', url: 'https://redirect.demo.invalid/r/demo-abc12345' });
      expect(FALLBACK_REDIRECT_BASE).toMatch(/^https:\/\/[a-z.]+\.invalid\/r\/$/);
    },
  );

  it('the default offline token is random and still on the .invalid host', async () => {
    const result = await mintLiveLink(body, {
      fetcher: (async () => {
        throw new ApiError('NETWORK_UNREACHABLE', 'down', 0);
      }) as never,
    });
    expect(result.kind).toBe('fallback');
    if (result.kind === 'fallback') expect(result.url).toMatch(/^https:\/\/redirect\.demo\.invalid\/r\/demo-[a-z0-9]{8}$/);
  });

  it.each([
    ['PROGRAMME_NOT_APPROVED', 'programme not active'],
    ['OFFER_STALE', 'offer expired'],
    ['PROPERTY_FORBIDDEN', 'property not found or not approved for your organisation'],
    ['PUBLISHER_NOT_ACTIVE', 'publisher onboarding incomplete — account must be active'],
    ['UNAUTHORIZED', 'not signed in — add your token first'],
    ['SOMETHING_NEW', 'link creation failed (SOMETHING_NEW)'],
  ])('guard error %s → "%s" (never a demo link)', async (code, message) => {
    const result = await mintLiveLink(body, {
      fetcher: (async () => {
        throw new ApiError(code, 'refused', 403);
      }) as never,
    });
    expect(result).toEqual({ kind: 'error', code, message });
  });

  it('an unexpected failure or a response without a URL is an error, not a link', async () => {
    expect(
      await mintLiveLink(body, {
        fetcher: (async () => {
          throw new TypeError('boom');
        }) as never,
      }),
    ).toEqual({ kind: 'error', code: 'INTERNAL', message: 'Link creation failed — unexpected error.' });
    expect((await mintLiveLink(body, { fetcher: (async () => ({ token: 't' })) as never })).kind).toBe('error');
  });
});

describe('demo link terms are TEST-labelled and make no cookie claim', () => {
  it('one entry per 1d offer, in the drawn order, Demo-named, numbers unchanged', () => {
    expect(DEMO_LINK_OFFERS.map((o) => o.id)).toEqual(DEMO_OFFERS.map((o) => o.id));
    for (const [i, o] of DEMO_LINK_OFFERS.entries()) {
      expect(o.name).toMatch(/^Demo /);
      expect(o.payout).toEqual(DEMO_OFFERS[i]!.payout);
      expect(o.platforms).toEqual(DEMO_OFFERS[i]!.platforms);
    }
  });

  it('landing hosts are example.com, promo codes DEMO…, copy never says cookie', () => {
    for (const o of DEMO_LINK_OFFERS) {
      for (const d of o.allowedDomains) expect(d).toMatch(/(^|\.)example\.com$/);
      expect(o.promoCode).toMatch(/^DEMO\d+$/);
      expect(`${o.description} ${o.terms}`.toLowerCase()).not.toContain('cookie');
      expect(o.terms).toContain(`Attribution ${o.attributionDays} days`);
    }
    expect(offer('demo-style').promoCode).toBe('DEMO12');
    expect(offer('demo-payupi').promoCode).toBe('DEMO180');
    expect(offer('demo-payupi').terms).toBe('₹180 per verified sign-up. Allowed: Meta, YouTube, Snapchat. Attribution 30 days.');
  });

  it('exactly the offers marked for approval show "Apply" (Demo Ludo Arena)', () => {
    expect(DEMO_LINK_OFFERS.filter((o) => o.requiresApproval).map((o) => o.id)).toEqual(['demo-ludo']);
  });

  it('the generator starts where 3c and 1e are drawn', () => {
    expect(DEMO_GENERATOR_OFFER_ID).toBe('demo-style');
    expect(demoDraftDefaults(offer('demo-style'))).toEqual({
      landing: 'shop.example.com/diwali-sale',
      platform: 'youtube',
      subId: 'short-diwali-02',
    });
    expect(demoDraftDefaults(offer('demo-payupi'))).toEqual({
      landing: 'pay.example.com/upi-signup',
      platform: 'meta',
      subId: 'reel-oct-01',
    });
    // No existing link: first allowed platform, no sub-ID.
    expect(demoDraftDefaults(offer('demo-ludo'))).toEqual({ landing: 'play.example.com/ludo', platform: 'meta', subId: '' });
    expect(DEMO_LINK_HANDLE).toBe(DEMO_CREATOR.handle);
    expect(CATEGORY_SHORT['D2C fashion']).toBe('Fashion');
  });
});
