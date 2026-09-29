import { describe, expect, it } from 'vitest';
import {
  AMAZON_ACCEPTED_PLATFORMS,
  AMAZON_PRICE_MAX_AGE_HOURS,
  amazonRouteParams,
  asinFromAmazonUrl,
  canonicalAmazonUrl,
  isAmazonAcceptedPlatform,
  isCanonicalAmazonOfferUrl,
  isLinkPreviewCrawler,
  isSpeculativeRequest,
  normaliseAsin,
  validateTrackingId,
} from './amazon.js';

const HOST = 'www.amazon.in';

describe('Amazon.in helpers (TEST values)', () => {
  it('ASINs and the canonical /dp/<ASIN> destination', () => {
    expect(normaliseAsin(' b0demo0001 ')).toBe('B0DEMO0001');
    expect(normaliseAsin('8129135728')).toBe('8129135728');
    expect(normaliseAsin('B0DEMO000')).toBeNull();
    expect(canonicalAmazonUrl(HOST, 'B0DEMO0001')).toBe('https://www.amazon.in/dp/B0DEMO0001');
    expect(isCanonicalAmazonOfferUrl('https://www.amazon.in/dp/B0DEMO0001', HOST)).toBe(true);
    for (const bad of [
      'https://www.amazon.in/dp/B0DEMO0001?tag=someone-21',
      'https://www.amazon.in/dp/B0DEMO0001/',
      'http://www.amazon.in/dp/B0DEMO0001',
      'https://amazon.in/dp/B0DEMO0001',
      'https://www.amazon.com/dp/B0DEMO0001',
      'https://www.amazon.in/dp/b0demo0001',
      'https://www.amazon.in/dp/B0DEMO0001#x',
    ]) {
      expect(isCanonicalAmazonOfferUrl(bad, HOST), bad).toBe(false);
    }
  });

  it('extracts the ASIN from amazon.in product URLs and refuses short links / other sites', () => {
    for (const url of [
      'https://www.amazon.in/dp/B0DEMO0001',
      'https://www.amazon.in/Demo-Kettle/dp/B0DEMO0001/ref=sr_1_1?tag=other-21',
      'https://amazon.in/gp/product/B0DEMO0001/?tag=other-21',
      'https://m.amazon.in/gp/aw/d/B0DEMO0001',
    ]) {
      expect(asinFromAmazonUrl(url, HOST), url).toEqual({ ok: true, asin: 'B0DEMO0001' });
    }
    expect(asinFromAmazonUrl('https://amzn.to/3demo', HOST).ok).toBe(false);
    expect(asinFromAmazonUrl('https://www.amazon.com/dp/B0DEMO0001', HOST).ok).toBe(false);
    expect(asinFromAmazonUrl('https://www.amazon.in/s?k=kettle', HOST).ok).toBe(false);
  });

  it('tracking IDs: lower-case, -21, no proprietary term (PR 12)', () => {
    expect(validateTrackingId(' Demo-IG-21 ')).toEqual({ ok: true, value: 'demo-ig-21' });
    expect(validateTrackingId('demo-20').ok).toBe(false);
    expect(validateTrackingId('demo_ig-21').ok).toBe(false);
    for (const term of [
      'amazondeals-21',
      'my-amzn-21',
      'kindlebooks-21',
      'am-az-on-21',
      // Amazon's (non-exhaustive) list of its marks, OA §7
      'alexa-picks-21',
      'primedeals-21',
      'echo-home-21',
      'audible-21',
      'prime-video-21',
      'fire-tv-21',
      'firestick-21',
      'imdb-top-21',
      'zappos-21',
      'whole-foods-21',
    ]) {
      const r = validateTrackingId(term);
      expect(r.ok, term).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/proprietary terms.*non-exhaustive/);
    }
    expect(validateTrackingId('demo-shop-21').ok).toBe(true);
  });

  it('route params: the placement tag, else the store ID; never a click id (LR: "Under no circumstances")', () => {
    expect(amazonRouteParams({ storeId: 'demo-21', placementTrackingId: 'demo-ig-21' })).toEqual({
      strip_params: ['tag', 'ascsubtag', 'subid'],
      set_params: { tag: 'demo-ig-21' },
      subid_field: null,
      crawler_guard: true,
      tag_source: 'placement',
    });
    const fallback = amazonRouteParams({ storeId: 'demo-21', placementTrackingId: null });
    expect(fallback.set_params).toEqual({ tag: 'demo-21' });
    expect(fallback.subid_field).toBeNull();
    expect(fallback.tag_source).toBe('store_default');
  });

  it('platforms: Facebook, Instagram and the own website only (never Snapchat or Telegram)', () => {
    expect([...AMAZON_ACCEPTED_PLATFORMS].sort()).toEqual(['facebook', 'instagram', 'web']);
    for (const p of ['facebook', 'instagram', 'web']) expect(isAmazonAcceptedPlatform(p), p).toBe(true);
    for (const p of ['snapchat', 'telegram', 'youtube', 'whatsapp', '', null, undefined]) expect(isAmazonAcceptedPlatform(p), String(p)).toBe(false);
  });

  it('a price may be shown for 1 hour (the Creators API table: "Offers | 1 hour")', () => {
    expect(AMAZON_PRICE_MAX_AGE_HOURS).toBe(1);
  });

  it('automated clients vs people (in-app browsers are people)', () => {
    for (const ua of [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'WhatsApp/2.23.20.0 A',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; Googlebot/2.1)',
      'curl/8.0',
      'curl/8.5.0',
      'python-requests/2.31',
      'Go-http-client/1.1',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 6.1; rv:6.0) Gecko/20110814 Firefox/6.0 Google-PageRenderer Google (+https://developers.google.com/+/web/snippet/)',
      'Mozilla/5.0 (compatible; SomeNewBot/1.0)',
      'Mozilla/5.0 (compatible; ExampleCrawler/2.0)',
      'Bytespider',
      'Wget/1.21',
      'okhttp/4.12.0',
      'Java/17.0.2',
      'Apache-HttpClient/4.5',
      'libwww-perl/6.72',
      '',
      '   ',
    ]) {
      expect(isLinkPreviewCrawler(ua), ua).toBe(true);
    }
    expect(isLinkPreviewCrawler(undefined)).toBe(true);
    for (const ua of [
      'Mozilla/5.0 (iPhone) Instagram 300.0',
      'Mozilla/5.0 (Linux; Android 14) [FBAN/FB4A;FBAV/450.0]',
      'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'afflino-check',
    ]) {
      expect(isLinkPreviewCrawler(ua), ua).toBe(false);
    }
  });

  it('prefetch / prerender / preview requests are not clicks', () => {
    expect(isSpeculativeRequest({ 'sec-purpose': 'prefetch' })).toBe(true);
    expect(isSpeculativeRequest({ 'sec-purpose': 'prefetch;prerender' })).toBe(true);
    expect(isSpeculativeRequest({ purpose: 'prefetch' })).toBe(true);
    expect(isSpeculativeRequest({ 'x-purpose': 'preview' })).toBe(true);
    expect(isSpeculativeRequest({ 'x-moz': 'prefetch' })).toBe(true);
    expect(isSpeculativeRequest({})).toBe(false);
    expect(isSpeculativeRequest({ 'sec-fetch-mode': 'navigate' })).toBe(false);
  });
});
