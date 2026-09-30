import { describe, expect, it } from 'vitest';
import {
  CELEBRITY_COPY,
  CELEBRITY_RIGHTS_MATRIX,
  assetImageRefusals,
  effectiveCelebrityRights,
  effectiveLookDisplay,
  endorsementFindings,
  itemWording,
  lookHeadline,
  lookTextFindings,
  mentionsName,
  namedCelebrities,
  PLACE_KINDS_WITHOUT_CONFIRMATION,
  productTextRefusals,
  publishableRightsStatuses,
  replyTextFindings,
  sensitivePlaceFinding,
  similarTextRefusals,
  slugify,
  territoryCovers,
  type AssetLicenceRow,
} from './celebrity.js';

const reviewed = (over: Partial<Parameters<typeof effectiveCelebrityRights>[0]> = {}) => ({
  rights_status: 'cleared',
  max_display: 'name_and_image',
  shoppable: true,
  is_minor: false,
  never_list: false,
  takedown_id: null,
  ...over,
});

const still = (over: Partial<AssetLicenceRow> = {}): AssetLicenceRow => ({
  kind: 'still',
  public_url: 'https://cdn.example.com/demo.jpg',
  license: 'TEST staff footage',
  commercial_reuse: 'yes',
  territory: 'IN',
  expires_at: null,
  screen_status: 'passed',
  minor_in_frame: false,
  bystanders: false,
  sensitive_location: false,
  live_performance: false,
  copyright_owner: 'Demo Media (TEST)',
  acquisition: 'staff',
  assignment_ref: null,
  ...over,
});

describe('the capability matrix (conservative defaults pending counsel)', () => {
  it('unreviewed and blocked allow nothing; editorial the name only; cleared at most name, image and products', () => {
    expect(CELEBRITY_RIGHTS_MATRIX).toEqual({
      unreviewed: { display: 'none', shoppable: false },
      blocked: { display: 'none', shoppable: false },
      editorial: { display: 'name_only', shoppable: false },
      cleared: { display: 'name_and_image', shoppable: true },
    });
    expect(publishableRightsStatuses()).toEqual(['editorial', 'cleared']);
  });

  it('the review narrows the ceiling and never widens it', () => {
    expect(effectiveCelebrityRights(reviewed())).toEqual({ display: 'name_and_image', shoppable: true });
    expect(effectiveCelebrityRights(reviewed({ max_display: 'name_only' }))).toEqual({ display: 'name_only', shoppable: true });
    expect(effectiveCelebrityRights(reviewed({ shoppable: false }))).toEqual({ display: 'name_and_image', shoppable: false });
    expect(effectiveCelebrityRights(reviewed({ rights_status: 'editorial' }))).toEqual({ display: 'name_only', shoppable: false });
    expect(effectiveCelebrityRights(reviewed({ rights_status: 'unreviewed' }))).toEqual({ display: 'none', shoppable: false });
    expect(effectiveCelebrityRights(reviewed({ rights_status: 'something-else' }))).toEqual({ display: 'none', shoppable: false });
  });

  it('a minor, a never-listed celebrity or one under takedown gets nothing whatever the status', () => {
    for (const over of [{ is_minor: true }, { never_list: true }, { takedown_id: 'td' }]) {
      expect(effectiveCelebrityRights(reviewed(over))).toEqual({ display: 'none', shoppable: false });
    }
  });
});

describe('images', () => {
  it('shown only with a public copy, commercial reuse in India, an unexpired licence and a passed screen; never with an exclusion flag', () => {
    const now = Date.parse('2026-09-30T00:00:00Z');
    expect(assetImageRefusals(still(), now)).toEqual([]);
    expect(assetImageRefusals(still({ commercial_reuse: 'unknown' }), now)).toEqual(['commercial_reuse_not_allowed']);
    expect(assetImageRefusals(still({ territory: 'AE' }), now)).toEqual(['territory_excludes_india']);
    expect(assetImageRefusals(still({ territory: 'WW' }), now)).toEqual([]);
    expect(assetImageRefusals(still({ expires_at: '2026-09-29T23:59:59Z' }), now)).toEqual(['licence_expired']);
    expect(assetImageRefusals(still({ screen_status: 'unscreened' }), now)).toEqual(['frame_not_screened']);
    expect(assetImageRefusals(still({ minor_in_frame: true, bystanders: true, sensitive_location: true, live_performance: true }), now)).toEqual([
      'minor_in_frame',
      'bystanders_in_frame',
      'sensitive_location',
      'live_performance',
    ]);
    expect(assetImageRefusals(null, now)).toEqual(['no_image']);
    // Chain of title: the copyright owner and the acquisition, and for anything but staff work the written assignment.
    expect(assetImageRefusals(still({ copyright_owner: null }), now)).toEqual(['no_chain_of_title']);
    expect(assetImageRefusals(still({ acquisition: null }), now)).toEqual(['no_chain_of_title']);
    expect(assetImageRefusals(still({ acquisition: 'freelance', assignment_ref: null }), now)).toEqual(['no_chain_of_title']);
    expect(assetImageRefusals(still({ acquisition: 'agency', assignment_ref: 'TEST-ASSIGN-9' }), now)).toEqual([]);
    expect(assetImageRefusals({ ...still(), copyright_owner: undefined, acquisition: undefined }, now)).toEqual(['no_chain_of_title']);
    expect(territoryCovers('IN, AE')).toBe(true);
    expect(territoryCovers(null)).toBe(false);
  });

  it('what a look shows: its mode capped by the rights, the image also by the asset', () => {
    const rights = effectiveCelebrityRights(reviewed());
    expect(effectiveLookDisplay(rights, 'name_and_image', still())).toEqual({ name: true, image: true, shoppable: true });
    expect(effectiveLookDisplay(rights, 'name_only', still())).toEqual({ name: true, image: false, shoppable: true });
    expect(effectiveLookDisplay(rights, 'name_and_image', still({ commercial_reuse: 'no' }))).toEqual({ name: true, image: false, shoppable: true });
    expect(effectiveLookDisplay({ display: 'none', shoppable: false }, 'name_and_image', still())).toEqual({ name: false, image: false, shoppable: false });
  });
});

describe('wording', () => {
  it('EXACT may say "the same item"; SIMILAR always says the celebrity did not wear or endorse it', () => {
    expect(itemWording('exact', 'Demo Star One').label).toBe('The same item');
    expect(itemWording('similar', 'Demo Star One').detail).toBe('Similar style. Demo Star One did not wear or endorse this product.');
    expect(CELEBRITY_COPY.nonEndorsement('Demo Star One')).toBe('Demo Star One is not affiliated with Afflino and has not endorsed any product on this page.');
    // The headline never names the celebrity: the name appears only in the credit line, beside the non-endorsement line at the same size.
    expect(lookHeadline({ event: 'Demo Premiere', place: 'Demo City' })).toBe('Spotted at Demo Premiere');
    expect(lookHeadline({ event: null, place: 'Demo City' })).toBe('Spotted in Demo City');
    expect(lookHeadline({ event: '  ', place: null })).toBe('Spotted');
  });

  it('refuses endorsement phrases in SIMILAR product text, and the celebrity’s name', () => {
    for (const bad of [
      'As worn by the star',
      'She wears it daily',
      'Her pick for summer',
      "Demo's picks",
      'Celebrity favourite',
      'Kurta dupe',
      'The look for less',
      'Inspired by the premiere',
      'Gucci-style loafers',
      'Save 40% vs the original',
      'Same as the one in the photo',
      "I'm wearing this",
      'She loves it',
      'Recommended by the star',
    ]) {
      expect(endorsementFindings(bad).length, bad).toBeGreaterThan(0);
    }
    for (const fine of ['Pleated trousers', 'Party wear kurta', 'Footwear', 'Round sunglasses', 'Cotton shirt, slim fit']) {
      expect(endorsementFindings(fine), fine).toEqual([]);
    }
    expect(similarTextRefusals(['Demo Brand', 'Demo Star One trousers'], ['Demo Star One'])).toEqual(['names_the_celebrity']);
    expect(similarTextRefusals(['Demo Brand', 'D. Star One style'], ['Demo Star One', 'D. Star One'])).toEqual(expect.arrayContaining(['names_the_celebrity']));
    expect(mentionsName('demo-star-one’s bag', ['Demo Star One'])).toBe(true);
    expect(mentionsName('Demo Star Oneplus', ['Demo Star One'])).toBe(false);
  });

  it('refuses Amazon in the look’s own text and sensitive places', () => {
    expect(lookTextFindings("Her picks on Amazon")).toEqual(expect.arrayContaining(['pick', 'amazon']));
    expect(lookTextFindings('The shirt')).toEqual([]);
    for (const place of ['Demo City Hospital', 'outside her home', 'Demo School annual day', 'Demo Temple', 'residence gate']) {
      expect(sensitivePlaceFinding(place), place).toBe(true);
    }
    expect(sensitivePlaceFinding('Demo City Airport')).toBe(false);
    expect(sensitivePlaceFinding('Housefull 5 premiere')).toBe(false);
  });

  it('slugs', () => {
    expect(slugify('Demo Star One')).toBe('demo-star-one');
    expect(slugify('Démo  Stár — Two!')).toBe('demo-star-two');
  });
});

describe('the wording lint, widened (every phrase a check found missing)', () => {
  it('refuses brand-style, inspired, copies, look-alikes, "seen on", possessives and budget versions in product text', () => {
    for (const bad of [
      'Gucci style loafers',
      'Gucci-inspired bag',
      'Zara inspired blazer',
      'first copy Prada bag',
      'Prada replica',
      'lookalike of the Dior bag',
      'seen on the star',
      'spotted wearing',
      'She rocked this',
      'exactly like hers',
      'same one she has',
      'budget version of her bag',
      'Star style kurta',
      'as seen at the premiere',
      'Get the look',
      'her go-to bag',
      '7A quality tote',
    ]) {
      expect(endorsementFindings(bad).length, bad).toBeGreaterThan(0);
    }
    for (const fine of ['Pleated trousers', 'Party wear kurta', 'Footwear', 'Round sunglasses', 'Cotton shirt, slim fit', 'Demo Brand', 'Tote bag, canvas', 'Clothing']) {
      expect(endorsementFindings(fine), fine).toEqual([]);
    }
  });

  it('matches a name glued, numbered or inside a handle; not a longer word that only starts with it', () => {
    const names = ['Demo Star One', 'D. Star One'];
    for (const t of ['Demo Star 1 jacket', 'DemoStarOne jacket', 'Demo StarOne kurta', 'demostarone_fans', 'daily demostaronefans', 'D Star One bag']) {
      expect(mentionsName(t, names), t).toBe(true);
    }
    for (const t of ['Demo Star Oneplus', 'Demo Starry One', 'Star One', 'Demo Brand']) {
      expect(mentionsName(t, names), t).toBe(false);
    }
    const celebs = [
      { id: 'a', name: 'Demo Star One', aliases: ['D. Star One'] },
      { id: 'b', name: 'Demo Star Two', aliases: [] },
    ];
    expect(namedCelebrities('Demo Star Two birthday party', celebs).map((c) => c.id)).toEqual(['b']);
    expect(namedCelebrities('Demo Star Two Fans', celebs).map((c) => c.id)).toEqual(['b']);
    expect(namedCelebrities('demo-star-two-fans', celebs).map((c) => c.id)).toEqual(['b']);
    expect(namedCelebrities('Daily sightings', celebs)).toEqual([]);
    // EXACT or SIMILAR: product text never names any celebrity, and never uses an endorsement phrase.
    expect(productTextRefusals(['Demo Brand', 'Demo Star Two jacket', 'Clothing'], celebs)).toEqual(['names_a_celebrity']);
    expect(productTextRefusals(['Demo Brand', 'Gucci style shirt', 'Clothing'], celebs)).toEqual(['word_style']);
    expect(productTextRefusals(['Demo Brand', 'Demo shirt 1', 'Clothing'], celebs)).toEqual([]);
  });

  it('public replies: every endorsement phrase and Amazon; look text keeps ordinary labels and event names', () => {
    expect(replyTextFindings('Demo Star One wore this! She loves it. Check your DMs')).toEqual(expect.arrayContaining(['worn_by', 'loves']));
    expect(replyTextFindings('Sent you a message with the link.')).toEqual([]);
    expect(lookTextFindings('Her bag')).toEqual([]);
    expect(lookTextFindings('Demo Style Awards')).toEqual([]);
    expect(lookTextFindings('Demo-inspired gala')).toEqual(['inspired_by']);
  });

  it('refuses residence and medical wording, and classes, in a place', () => {
    for (const place of ['outside her building', 'at the dermatologist', 'playschool', 'dance class', 'Demo Towers', 'Demo Housing Society', 'diagnostic centre']) {
      expect(sensitivePlaceFinding(place), place).toBe(true);
    }
    for (const place of ['Demo City Airport', 'Demo Film City', 'Demo Stadium', 'First class lounge, Demo Airport']) {
      expect(sensitivePlaceFinding(place), place).toBe(false);
    }
    expect(PLACE_KINDS_WITHOUT_CONFIRMATION).toEqual(['event', 'venue', 'airport', 'studio']);
  });
});
