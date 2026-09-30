/**
 * TEST demo data for the celebrity-look admin screens, shown only when the
 * screen makes no live call (signed out) or the API could not answer, always
 * with <DemoBadge />. Fictional people ("Demo Star …"), "Demo …" brands and
 * pages, TEST references; no real celebrity, library or merchant data.
 */
import type {
  CelebrityDetail,
  CelebrityList,
  ClickAnalytics,
  EditorialLook,
  EditorialLookRow,
  MetaAccount,
  PropertyRow,
  ReplyAnalytics,
  ReplyEvent,
  ReplyRule,
  TakedownDetail,
  TakedownView,
} from '../celebrity-admin';
import { daysOf, lastDays } from '../celebrity-admin';

const DAY = 86_400_000;
/**
 * Fixed TEST times (not "now"): the screens render this data on the server
 * and again in the browser, and the two must print the same text.
 */
const ANCHOR = Date.parse('2026-09-30T06:30:00.000Z');
const iso = (daysAgo: number, hours = 0) => new Date(ANCHOR - daysAgo * DAY - hours * 3_600_000).toISOString();

const ONE = '11111111-0000-4000-8000-00000000c001';
const TWO = '11111111-0000-4000-8000-00000000c002';
const THREE = '11111111-0000-4000-8000-00000000c003';
export const DEMO_LOOK_ONE = '22222222-0000-4000-8000-00000000a001';
const LOOK_TWO = '22222222-0000-4000-8000-00000000a002';
const PAGE_IG = '33333333-0000-4000-8000-0000000000f1';
const PAGE_FB = '33333333-0000-4000-8000-0000000000f2';
const PAGE_WEB = '33333333-0000-4000-8000-0000000000f3';

const base = {
  aliases: [] as string[],
  is_minor: false,
  never_list: false,
  rights_note: null,
  rights_evidence_ref: null,
  rights_reviewed_by: null,
  rights_reviewed_at: null,
  takedown_id: null,
  created_at: iso(20),
  updated_at: iso(2),
};

export const DEMO_CELEBRITIES: CelebrityList = {
  items: [
    {
      ...base,
      id: ONE,
      name: 'Demo Star One',
      slug: 'demo-star-one',
      aliases: ['D. Star One'],
      rights_status: 'cleared',
      max_display: 'name_and_image',
      shoppable: true,
      rights_note: 'TEST: written licence from the agency',
      rights_evidence_ref: 'TEST-LICENCE-0001',
      rights_reviewed_by: 'rights reviewer (TEST)',
      rights_reviewed_at: iso(3),
      effective: { display: 'name_and_image', shoppable: true },
    },
    { ...base, id: TWO, name: 'Demo Star Two', slug: 'demo-star-two', rights_status: 'unreviewed', max_display: 'none', shoppable: false, effective: { display: 'none', shoppable: false } },
    {
      ...base,
      id: THREE,
      name: 'Demo Star Three',
      slug: 'demo-star-three',
      is_minor: true,
      rights_status: 'blocked',
      max_display: 'none',
      shoppable: false,
      rights_note: 'TEST: a minor, never published',
      rights_reviewed_by: 'editor (TEST)',
      rights_reviewed_at: iso(5),
      effective: { display: 'none', shoppable: false },
    },
  ],
  matrix: {
    unreviewed: { display: 'none', shoppable: false },
    blocked: { display: 'none', shoppable: false },
    editorial: { display: 'name_only', shoppable: false },
    cleared: { display: 'name_and_image', shoppable: true },
  },
};

export function demoCelebrityDetail(id: string): CelebrityDetail {
  const c = DEMO_CELEBRITIES.items.find((x) => x.id === id) ?? (DEMO_CELEBRITIES.items[0] as CelebrityDetail);
  return {
    ...c,
    reviews:
      c.rights_status === 'unreviewed'
        ? []
        : [
            {
              id: `${c.id.slice(0, -4)}r001`,
              kind: 'review',
              rights_status: c.rights_status,
              max_display: c.max_display,
              shoppable: c.shoppable,
              note: c.rights_note,
              evidence_ref: c.rights_evidence_ref,
              reviewed_by: 'TEST reviewer',
              reviewed_role: c.rights_status === 'blocked' ? 'editor' : 'rights_reviewer',
              reviewed_at: c.rights_reviewed_at,
            },
          ],
    looks: c.id === ONE ? [{ id: DEMO_LOOK_ONE, status: 'published', title: 'Demo Film Premiere 2026-09-12' }] : c.id === TWO ? [{ id: LOOK_TWO, status: 'draft', title: 'Demo Airport Arrival 2026-09-20' }] : [],
  };
}

export const DEMO_EDITORIAL_LOOKS: { items: EditorialLookRow[] } = {
  items: [
    {
      id: DEMO_LOOK_ONE,
      title: 'Demo Film Premiere 2026-09-12',
      status: 'published',
      library_ref: 'demo-vid-0001',
      event: 'Demo Film Premiere',
      moment_date: '2026-09-12',
      published_at: iso(2),
      takedown_id: null,
      pending_exact: 0,
      celebrity: { id: ONE, name: 'Demo Star One', rights_status: 'cleared' },
    },
    {
      id: LOOK_TWO,
      title: 'Demo Airport Arrival 2026-09-20',
      status: 'draft',
      library_ref: 'demo-vid-0002',
      event: 'Demo Airport Arrival',
      moment_date: '2026-09-20',
      published_at: null,
      takedown_id: null,
      pending_exact: 1,
      celebrity: { id: TWO, name: 'Demo Star Two', rights_status: 'unreviewed' },
    },
  ],
};

function offer(price: number | null) {
  return { id: 'offer-demo', connector: null, merchant: { name: 'Demo Merchant One' }, price_minor: price, price_as_of: null, currency: 'INR', stock_status: 'in_stock', disclosure: null };
}

export const DEMO_EDITORIAL_LOOK: EditorialLook = {
  id: DEMO_LOOK_ONE,
  title: 'Demo Film Premiere 2026-09-12',
  status: 'ready',
  published_at: null,
  withdrawn_at: null,
  takedown_id: null,
  library_ref: 'demo-vid-0001',
  celebrity_display: 'name_and_image',
  celebrity: {
    id: ONE,
    name: 'Demo Star One',
    slug: 'demo-star-one',
    rights_status: 'cleared',
    max_display: 'name_and_image',
    shoppable: true,
    takedown_id: null,
    effective: { display: 'name_and_image', shoppable: true },
  },
  moment: { event: 'Demo Film Premiere', place: 'Demo City', place_kind: 'event', date: '2026-09-12' },
  property: { id: PAGE_IG, platform: 'instagram', external_account_id: 'demo.afflino', canonical_url: 'https://instagram.example.com/demo.afflino', status: 'approved', owner_operated: true },
  post: { platform_post_id: '17900000000000001', permalink: 'https://instagram.example.com/p/demo-0001' },
  storefront: null,
  still: {
    id: '44444444-0000-4000-8000-000000000001',
    storage_key: 'demo-stills/0001.jpg',
    public_url: null,
    licence: {
      license: 'TEST staff footage',
      commercial_reuse: 'yes',
      territory: 'IN',
      expires_at: '2027-12-31T00:00:00.000Z',
      source_ref: 'demo-batch-01/card-a/0001',
      copyright_owner: 'Demo Media (TEST)',
      author: 'Demo Shooter',
      acquisition: 'staff',
      assignment_ref: 'TEST-ASSIGN-001',
    },
    flags: { live_performance: false, minor_in_frame: false, bystanders: false, sensitive_location: false },
    screen_status: 'passed',
  },
  display: { name: true, image: false, shoppable: true },
  pieces: [
    {
      id: '55555555-0000-4000-8000-000000000001',
      label: 'The shirt',
      category: 'shirt',
      position: 0,
      hotspot: { x: 0.42, y: 0.35 },
      items: [
        {
          id: '66666666-0000-4000-8000-000000000001',
          match_type: 'exact',
          review_state: 'pending',
          position: 0,
          evidence: 'TEST: the brand tag and the pocket stitching are visible at 00:41 of the video',
          evidence_source: 'demo-batch-01/card-a/0001#00:41',
          evidence_captured_at: iso(3),
          tagged_by: 'editor (TEST)',
          match_reviewed_by: null,
          match_reviewed_at: null,
          product: { id: 'p-demo-1', brand: 'Demo Label', model: 'Linen Camp-Collar Shirt', category: 'Clothing' },
          variant: { id: 'v-demo-1', size_text: null, colour: null, merchant_sku: 'B0DEMO0901' },
          offer: offer(null),
          links: [],
        },
        {
          id: '66666666-0000-4000-8000-000000000002',
          match_type: 'similar',
          review_state: 'approved',
          position: 1,
          evidence: null,
          evidence_source: null,
          evidence_captured_at: null,
          tagged_by: 'editor (TEST)',
          match_reviewed_by: null,
          match_reviewed_at: null,
          product: { id: 'p-demo-2', brand: 'Demo Basics', model: 'Relaxed Linen-Blend Shirt', category: 'Clothing' },
          variant: { id: 'v-demo-2', size_text: null, colour: null, merchant_sku: 'B0DEMO0902' },
          offer: offer(129900),
          links: [],
        },
      ],
    },
    {
      id: '55555555-0000-4000-8000-000000000002',
      label: 'The trousers',
      category: 'trousers',
      position: 1,
      hotspot: { x: 0.45, y: 0.62 },
      items: [],
    },
  ],
  gate: {
    ok: false,
    checks: [
      { code: 'celebrity', ok: true },
      { code: 'no_takedown', ok: true },
      { code: 'not_withdrawn', ok: true },
      { code: 'not_minor_or_never_list', ok: true },
      { code: 'rights_status', ok: true, detail: "status 'cleared' (review: name_and_image, shoppable) allows name_and_image with products" },
      { code: 'display_mode', ok: true, detail: "the look shows name_and_image; the celebrity's rights allow name_and_image" },
      { code: 'image_licence', ok: false, detail: 'the still may not be shown: no_public_copy' },
      { code: 'moment_date', ok: true },
      { code: 'in_house_page', ok: true },
      { code: 'wording', ok: true },
      { code: 'pieces', ok: true },
      { code: 'every_piece_has_a_product', ok: false, detail: 'no product yet: The trousers' },
      { code: 'exact_reviewed', ok: false, detail: "1 EXACT tag(s) wait for a second person's review" },
    ],
  },
  look_url: `https://afflino.com/looks/${DEMO_LOOK_ONE}`,
};

export const DEMO_TAKEDOWNS: { items: TakedownView[] } = {
  items: [
    {
      id: '77777777-0000-4000-8000-000000000001',
      scope: 'look',
      celebrity_id: null,
      look_id: LOOK_TWO,
      reason_code: 'rights_holder_request',
      reason_note: 'TEST: the agency asked for this look to come down',
      requester_ref: 'TEST-NOTICE-0001',
      requested_at: iso(1, 2),
      actioned_at: iso(1, 1.5),
      completed_at: iso(1, 1.49),
      actioned_by: 'editor (TEST)',
      status: 'active',
      restored_at: null,
      restored_by: null,
      restore_note: null,
      looks_withdrawn: 1,
      links_paused: 3,
      rules_disabled: 1,
      minutes_to_action: 30,
      sla: 'ok',
    },
  ],
};

export function demoTakedownDetail(id: string): TakedownDetail {
  const t = DEMO_TAKEDOWNS.items.find((x) => x.id === id) ?? (DEMO_TAKEDOWNS.items[0] as TakedownView);
  return {
    ...t,
    looks: [
      {
        look_id: LOOK_TWO,
        previous_status: 'published',
        post_removed_at: null,
        platform: 'facebook',
        account: 'demo.afflino',
        post_permalink: 'https://facebook.example.com/demo.afflino/posts/0002',
        platform_post_id: '1000000000000_2000000000000',
      },
    ],
  };
}

export const DEMO_PROPERTIES: { items: PropertyRow[] } = {
  items: [
    { id: PAGE_FB, platform: 'facebook', account: 'demo.afflino', url: 'https://facebook.example.com/demo.afflino', status: 'approved', owner_operated: true, amazon_tracking_id: 'demo-fb-21', storefront: null },
    { id: PAGE_IG, platform: 'instagram', account: 'demo.afflino', url: 'https://instagram.example.com/demo.afflino', status: 'approved', owner_operated: true, amazon_tracking_id: 'demo-ig-21', storefront: { id: 's-demo', slug: 'demo-afflino-instagram', status: 'live' } },
    { id: PAGE_WEB, platform: 'web', account: 'afflino.example.com', url: 'https://afflino.example.com', status: 'approved', owner_operated: true, amazon_tracking_id: 'demo-web-21', storefront: null },
  ],
};

const DM = `Ad · The look you asked for, on Afflino: https://afflino.com/looks/${DEMO_LOOK_ONE}\nAfflino may earn a commission from purchases made through the links on that page.\nThis is an automated message. Reply STOP and we will not message you again.`;

export const DEMO_RULES: { items: ReplyRule[] } = {
  items: [
    {
      id: '88888888-0000-4000-8000-000000000001',
      look_id: DEMO_LOOK_ONE,
      property_id: PAGE_IG,
      platform_post_id: '17900000000000001',
      keywords: ['link', 'price', 'shop'],
      public_reply: 'We sent you a message with the link.',
      enabled: false,
      disabled_by_takedown_id: null,
      created_at: iso(2),
      look_url: `https://afflino.com/looks/${DEMO_LOOK_ONE}`,
      dm_preview: DM,
      dm_bytes: new TextEncoder().encode(DM).length,
      dm_refusal: null,
    },
  ],
};

export const DEMO_ACCOUNTS: { items: MetaAccount[] } = {
  items: [
    { id: 'm-demo-1', property_id: PAGE_IG, platform: 'instagram', meta_account_id: '17800000000000001', linked_page_id: '1000000000000', messaging_status: 'unknown', last_error_code: null, paused_until: null, checked_at: null, account: 'demo.afflino' },
  ],
};

export const DEMO_EVENTS: { items: ReplyEvent[] } = {
  items: [
    { id: 'e-demo-1', rule_id: DEMO_RULES.items[0]!.id, look_id: DEMO_LOOK_ONE, property_id: PAGE_IG, account: 'demo.afflino', platform: 'instagram', matched_keyword: 'link', status: 'skipped_shadow', attempts: 1, error_code: null, public_reply_status: null, received_at: iso(0, 1), sent_at: null },
    { id: 'e-demo-2', rule_id: DEMO_RULES.items[0]!.id, look_id: DEMO_LOOK_ONE, property_id: PAGE_IG, account: 'demo.afflino', platform: 'instagram', matched_keyword: 'price', status: 'skipped_suppressed', attempts: 0, error_code: null, public_reply_status: null, received_at: iso(0, 3), sent_at: null },
  ],
};

export function demoClicks(group: string, days: number): ClickAnalytics {
  const { from, to } = lastDays(days);
  if (group === 'day') {
    const series = daysOf(from, to).map((d, i) => ({ key: d, label: d, clicks: [4, 7, 3, 9, 12, 6, 10, 8][i % 8] as number }));
    return { from, to, group_by: 'day', total_clicks: series.reduce((n, g) => n + g.clicks, 0), groups: series };
  }
  const rows: Record<string, Array<{ key: string; label: string; clicks: number }>> = {
    celebrity: [{ key: ONE, label: 'Demo Star One', clicks: 59 }],
    look: [{ key: DEMO_LOOK_ONE, label: 'Demo Film Premiere 2026-09-12', clicks: 59 }],
    piece: [
      { key: 'piece-shirt', label: 'The shirt', clicks: 31 },
      { key: 'piece-trousers', label: 'The trousers', clicks: 19 },
      { key: 'piece-eyewear', label: 'The sunglasses', clicks: 9 },
    ],
    property: [
      { key: PAGE_IG, label: 'instagram:demo.afflino', clicks: 41 },
      { key: PAGE_WEB, label: 'web:afflino.example.com', clicks: 18 },
    ],
    link: [
      { key: 'link-demo-1', label: 'link-demo-1', clicks: 31 },
      { key: 'link-demo-2', label: 'link-demo-2', clicks: 28 },
    ],
    via: [
      { key: '', label: '(none)', clicks: 44 },
      { key: 's-demo-afflino-instagram', label: 's-demo-afflino-instagram', clicks: 15 },
    ],
  };
  const groups = rows[group] ?? [];
  return { from, to, group_by: group, total_clicks: groups.reduce((n, g) => n + g.clicks, 0), groups };
}

export function demoReplyAnalytics(days: number): ReplyAnalytics {
  const { from, to } = lastDays(days);
  return { from, to, days: [{ day: to, received: 2, sent: 0, skipped: 2, failed: 0 }], rules: [{ rule_id: DEMO_RULES.items[0]!.id, look_id: DEMO_LOOK_ONE, received: 2, sent: 0, skipped: 2, failed: 0 }] };
}
