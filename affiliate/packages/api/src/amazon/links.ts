/**
 * Amazon.in Associates — the operator's link sheet (src/cli/amazon.ts
 * `template`, `links`, `status`).
 *
 * template  a starting properties file: every approved property of the
 *           organisation with a live owner_operated verification ON A
 *           PLATFORM AMAZON LINKS MAY GO ON (Facebook, Instagram, the
 *           owner's website: AMAZON_ACCEPTED_PLATFORMS; never Snapchat or
 *           Telegram), one row each (platform, account, tracking_id, url),
 *           tracking IDs already mapped filled in. The operator keeps only the
 *           rows of the pages listed on the Associates website list and
 *           writes one tracking ID per row (Amazon: at most 100 per account).
 * links     one tracked link per (declared placement WITH its own tracking
 *           ID) × (live Amazon offer), minted through POST /v1/links itself
 *           (`inject`: the route's guards, the idempotency store, the Redis
 *           warm and the outbox all apply). Placements that carry the store
 *           ID are skipped: their sales cannot be attributed (the store ID is
 *           never an attribution basis) and would land in suspense. An
 *           existing active link is reused, so a re-run mints nothing. Every
 *           row carries `post_label` (AMAZON_POST_LABEL, a draft pending
 *           counsel), the link-level disclosure a post starts from.
 * status    counts for the check step: placements, tracking IDs, offers,
 *           links, clicks, conversions by attribution and suspense reason,
 *           and one sample link.
 *
 * Every query names the org_id ($1); nothing here reads another tenant.
 */
import type { PoolClient } from 'pg';
import { AMAZON_POST_LABEL, AMAZON_PRICE_MAX_AGE_HOURS, isAmazonAcceptedPlatform } from '@paparazzi/shared';
import { getPool } from '../db.js';

type Db = { query: PoolClient['query'] };

async function rows<T extends Record<string, unknown>>(db: Db, sql: string, params: unknown[]): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

/** One CSV field (RFC 4180): quoted when it holds a comma, quote, CR or LF. */
export function csvField(value: string | number | null | undefined): string {
  const v = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvLine(values: Array<string | number | null | undefined>): string {
  return values.map(csvField).join(',');
}

interface OrgAccount {
  orgId: string;
  accountId: string;
  programmeId: string;
  storeId: string;
  programmeStatus: string;
  accountStatus: string;
}

async function orgAccount(db: Db, orgSlug: string): Promise<OrgAccount> {
  const org = (await rows<{ id: string }>(db, `select id from organisations where slug = $1`, [orgSlug]))[0];
  if (!org) throw new Error(`no organisation '${orgSlug}'`);
  const accounts = await rows<{ id: string; programme_id: string; store_id: string; status: string; programme_status: string }>(
    db,
    `select a.id, a.programme_id, a.store_id, a.status, p.status as programme_status
       from amazon_associates_accounts a
       join programmes p on p.id = a.programme_id and p.org_id = $1
      where a.org_id = $1
      order by a.created_at, a.id`,
    [org.id],
  );
  if (accounts.length !== 1 || !accounts[0]) {
    throw new Error(
      accounts.length === 0
        ? `no Amazon Associates account in '${orgSlug}' (run the setup first)`
        : `several Amazon Associates accounts in '${orgSlug}'; this build expects one`,
    );
  }
  const a = accounts[0];
  return {
    orgId: org.id,
    accountId: a.id,
    programmeId: a.programme_id,
    storeId: a.store_id,
    programmeStatus: a.programme_status,
    accountStatus: a.status,
  };
}

const PLATFORM_ORDER = ['web', 'instagram', 'facebook'];
const platformRank = (p: string) => {
  const i = PLATFORM_ORDER.indexOf(p);
  return i < 0 ? PLATFORM_ORDER.length : i;
};

/** The properties-file template as CSV text (header + one row per eligible property). */
export async function propertiesTemplate(
  opts: { orgSlug: string },
): Promise<{ csv: string; rows: number; mapped: number; left_out_platforms: Record<string, number> }> {
  const db = getPool();
  const org = (await rows<{ id: string }>(db, `select id from organisations where slug = $1`, [opts.orgSlug]))[0];
  if (!org) throw new Error(`no organisation '${opts.orgSlug}' (run db/seed-network.ts first)`);
  // The owner_operated rule of routes/links.ts (two plain queries: pg-mem has no correlated EXISTS).
  const owner = new Set(
    (
      await rows<{ property_id: string }>(
        db,
        `select distinct property_id from verifications
          where org_id = $1 and method = 'owner_operated' and verified_at is not null
            and (expires_at is null or expires_at > now())`,
        [org.id],
      )
    ).map((r) => r.property_id),
  );
  const props = (
    await rows<{ id: string; platform: string; external_account_id: string; canonical_url: string | null }>(
      db,
      `select id, platform, external_account_id, canonical_url from properties where org_id = $1 and status = 'approved'`,
      [org.id],
    )
  ).filter((p) => owner.has(p.id));
  // Only the platforms Amazon links may go on; the rest are counted, not listed.
  const leftOut: Record<string, number> = {};
  for (const p of props) if (!isAmazonAcceptedPlatform(p.platform)) leftOut[p.platform] = (leftOut[p.platform] ?? 0) + 1;
  const eligible = props.filter((p) => isAmazonAcceptedPlatform(p.platform));
  const mapped = await rows<{ property_id: string; tracking_id: string }>(
    db,
    `select pl.property_id, t.tracking_id
       from amazon_tracking_ids t
       join placements pl on pl.id = t.placement_id and pl.org_id = $1
      where t.org_id = $1`,
    [org.id],
  );
  const tagOf = new Map(mapped.map((m) => [m.property_id, m.tracking_id]));
  eligible.sort(
    (a, b) =>
      platformRank(a.platform) - platformRank(b.platform) ||
      a.platform.localeCompare(b.platform) ||
      a.external_account_id.localeCompare(b.external_account_id),
  );
  const lines = [csvLine(['platform', 'account', 'tracking_id', 'url'])];
  for (const p of eligible) lines.push(csvLine([p.platform, p.external_account_id, tagOf.get(p.id) ?? '', p.canonical_url ?? '']));
  return {
    csv: `${lines.join('\n')}\n`,
    rows: eligible.length,
    mapped: eligible.filter((p) => tagOf.has(p.id)).length,
    left_out_platforms: leftOut,
  };
}

export interface InjectResponse {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
}

/** POST /v1/links through the API itself (Fastify's inject in the CLI, app.inject in tests). */
export type PostLink = (body: Record<string, string>, idempotencyKey: string) => Promise<InjectResponse>;

export interface LinkSheetRow {
  platform: string;
  account: string;
  tracking_id: string;
  asin: string;
  brand: string;
  model: string;
  look: string | null;
  link_url: string;
  /** The link-level disclosure a post starts from (AMAZON_POST_LABEL; draft pending counsel). */
  post_label: string;
  token: string;
  minted: boolean;
}

export interface MintLinksResult {
  org_id: string;
  programme_id: string;
  placements: number;
  placements_skipped_store_default: Array<{ platform: string; account: string }>;
  offers: number;
  minted: number;
  existing: number;
  failed: Array<{ platform: string; account: string; asin: string; status: number; code: string; message: string }>;
  links: LinkSheetRow[];
}

function parseBody(res: InjectResponse): { data?: { token?: string; url?: string }; error?: { code?: string; message?: string } } {
  try {
    return JSON.parse(res.body) as { data?: { token?: string; url?: string }; error?: { code?: string; message?: string } };
  } catch {
    return {};
  }
}

/**
 * Mint the link sheet. `post` must be the API (see PostLink); `redirectUrl`
 * composes an existing link's URL exactly as the API does
 * (src/redirect-url.ts).
 */
export async function mintAmazonLinks(opts: {
  orgSlug: string;
  post: PostLink;
  redirectUrl: (token: string) => string;
  now?: () => number;
}): Promise<MintLinksResult> {
  const db = getPool();
  const acct = await orgAccount(db, opts.orgSlug);
  const { orgId, programmeId, accountId } = acct;
  if (acct.programmeStatus !== 'active') throw new Error(`the Amazon programme is '${acct.programmeStatus}', not active: no links are minted`);
  if (acct.accountStatus !== 'active') throw new Error(`the Amazon Associates account is '${acct.accountStatus}': no links are minted`);

  const placements = await rows<{ id: string; property_id: string; platform: string; account: string; tracking_id: string | null }>(
    db,
    `select pl.id, pl.property_id, p.platform, p.external_account_id as account, t.tracking_id
       from placements pl
       join campaigns ca on ca.id = pl.campaign_id and ca.org_id = $1
       join properties p on p.id = pl.property_id and p.org_id = $1
       left join amazon_tracking_ids t on t.placement_id = pl.id and t.org_id = $1 and t.account_id = $3
      where pl.org_id = $1 and ca.programme_id = $2`,
    [orgId, programmeId, accountId],
  );
  placements.sort(
    (a, b) => platformRank(a.platform) - platformRank(b.platform) || a.platform.localeCompare(b.platform) || a.account.localeCompare(b.account),
  );
  const offers = await rows<{ id: string; asin: string; brand: string; model: string }>(
    db,
    `select o.id, o.merchant_item_ref as asin, pr.brand, pr.model
       from offers o
       join variants v on v.id = o.variant_id and v.org_id = $1
       join products pr on pr.id = v.product_id and pr.org_id = $1
      where o.org_id = $1 and o.programme_id = $2 and o.status = 'active' and o.fresh_until > now()
        and o.merchant_item_ref is not null
      order by o.merchant_item_ref, o.id`,
    [orgId, programmeId],
  );
  const lookOf = new Map<string, string>();
  for (const r of await rows<{ offer_id: string; title: string }>(
    db,
    `select o.id as offer_id, l.title
       from offers o
       join look_items li on li.variant_id = o.variant_id and li.org_id = $1
       join looks l on l.id = li.look_id and l.org_id = $1
      where o.org_id = $1 and o.programme_id = $2
      order by l.created_at, l.id`,
    [orgId, programmeId],
  )) {
    if (!lookOf.has(r.offer_id)) lookOf.set(r.offer_id, r.title);
  }
  const existing = new Map<string, string>();
  for (const l of await rows<{ token: string; placement_id: string; offer_id: string }>(
    db,
    `select l.token, l.placement_id, l.offer_id
       from links l
       join offers o on o.id = l.offer_id and o.org_id = $1
      where l.org_id = $1 and o.programme_id = $2 and l.status = 'active'
      order by l.created_at desc, l.id`,
    [orgId, programmeId],
  )) {
    const key = `${l.placement_id}:${l.offer_id}`;
    if (!existing.has(key)) existing.set(key, l.token);
  }

  const result: MintLinksResult = {
    org_id: orgId,
    programme_id: programmeId,
    placements: 0,
    placements_skipped_store_default: [],
    offers: offers.length,
    minted: 0,
    existing: 0,
    failed: [],
    links: [],
  };
  const now = opts.now ?? Date.now;
  for (const pl of placements) {
    if (!pl.tracking_id) {
      result.placements_skipped_store_default.push({ platform: pl.platform, account: pl.account });
      continue;
    }
    result.placements += 1;
    for (const o of offers) {
      const row = {
        platform: pl.platform,
        account: pl.account,
        tracking_id: pl.tracking_id,
        asin: o.asin,
        brand: o.brand,
        model: o.model,
        look: lookOf.get(o.id) ?? null,
        post_label: AMAZON_POST_LABEL,
      };
      const have = existing.get(`${pl.id}:${o.id}`);
      if (have) {
        result.existing += 1;
        result.links.push({ ...row, token: have, link_url: opts.redirectUrl(have), minted: false });
        continue;
      }
      const body = { property_id: pl.property_id, programme_id: programmeId, offer_id: o.id, placement_id: pl.id };
      // No active link exists, so a replay under the fixed key is stale (a
      // refusal since fixed, or a link paused since): one retry, fresh key.
      const baseKey = `amazon-links:${pl.id}:${o.id}`;
      let res = await opts.post(body, baseKey);
      if (res.headers['x-idempotent-replay'] === 'true') res = await opts.post(body, `${baseKey}:${now().toString(36)}`);
      const parsed = parseBody(res);
      if (res.statusCode === 201 && parsed.data?.token && parsed.data.url) {
        result.minted += 1;
        result.links.push({ ...row, token: parsed.data.token, link_url: parsed.data.url, minted: true });
      } else {
        result.failed.push({
          platform: pl.platform,
          account: pl.account,
          asin: o.asin,
          status: res.statusCode,
          code: parsed.error?.code ?? 'INTERNAL',
          message: parsed.error?.message ?? `HTTP ${res.statusCode}`,
        });
      }
    }
  }
  return result;
}

/** The link sheet as CSV (what the operator posts from: each post starts with its post_label). */
export function linkSheetCsv(links: LinkSheetRow[]): string {
  const lines = [csvLine(['platform', 'account', 'tracking_id', 'asin', 'brand', 'model', 'look', 'post_label', 'link_url'])];
  for (const l of links) {
    lines.push(csvLine([l.platform, l.account, l.tracking_id, l.asin, l.brand, l.model, l.look, l.post_label, l.link_url]));
  }
  return `${lines.join('\n')}\n`;
}

export interface AmazonStatus {
  org_id: string;
  store_id: string;
  account_status: string;
  programme_id: string;
  programme_status: string;
  placements: number;
  placements_with_tracking_id: number;
  tracking_ids: number;
  offers: { active: number; stale: number; revoked: number; priced_now: number };
  looks_with_amazon_items: number;
  links_active: number;
  clicks: number;
  conversions: {
    total: number;
    by_status: Record<string, number>;
    attributed_by_click: number;
    attributed_by_tracking_id: number;
    suspense: number;
    suspense_by_reason: Record<string, number>;
  };
  sample_link: { token: string; platform: string; account: string; asin: string } | null;
}

export async function amazonStatus(opts: { orgSlug: string; preferPlatform?: string }): Promise<AmazonStatus> {
  const db = getPool();
  const acct = await orgAccount(db, opts.orgSlug);
  const { orgId, programmeId, accountId } = acct;
  const count = async (sql: string, params: unknown[] = []) =>
    Number((await rows<{ n: string | number }>(db, sql, [orgId, ...params]))[0]?.n ?? 0);

  const placements = await count(
    `select count(*) as n from placements pl join campaigns ca on ca.id = pl.campaign_id and ca.org_id = $1
      where pl.org_id = $1 and ca.programme_id = $2`,
    [programmeId],
  );
  const withTag = await count(
    `select count(*) as n from amazon_tracking_ids t join placements pl on pl.id = t.placement_id and pl.org_id = $1
      where t.org_id = $1 and t.account_id = $2`,
    [accountId],
  );
  const offerStatus = await rows<{ status: string; n: string | number }>(
    db,
    `select status, count(*) as n from offers where org_id = $1 and programme_id = $2 group by status`,
    [orgId, programmeId],
  );
  const statusCount = (s: string) => Number(offerStatus.find((r) => r.status === s)?.n ?? 0);
  const pricedNow = await count(
    `select count(*) as n from offers where org_id = $1 and programme_id = $2 and status = 'active'
        and price_minor is not null and price_as_of is not null and price_as_of > $3::timestamptz`,
    [programmeId, new Date(Date.now() - AMAZON_PRICE_MAX_AGE_HOURS * 3_600_000).toISOString()],
  );
  const looks = await count(
    `select count(distinct l.id) as n
       from looks l
       join look_items li on li.look_id = l.id and li.org_id = $1
       join offers o on o.variant_id = li.variant_id and o.org_id = $1
      where l.org_id = $1 and o.programme_id = $2`,
    [programmeId],
  );
  const linksActive = await count(
    `select count(*) as n from links l join offers o on o.id = l.offer_id and o.org_id = $1
      where l.org_id = $1 and o.programme_id = $2 and l.status = 'active'`,
    [programmeId],
  );
  const clicks = await count(
    `select count(*) as n from clicks c
       join links l on l.id = c.link_id and l.org_id = $1
       join offers o on o.id = l.offer_id and o.org_id = $1
      where c.org_id = $1 and o.programme_id = $2`,
    [programmeId],
  );
  const conversions: AmazonStatus['conversions'] = {
    total: 0,
    by_status: {},
    attributed_by_click: await count(
      `select count(*) as n from conversions where org_id = $1 and programme_id = $2 and click_id is not null`,
      [programmeId],
    ),
    attributed_by_tracking_id: await count(
      `select count(*) as n from conversions where org_id = $1 and programme_id = $2 and placement_id is not null`,
      [programmeId],
    ),
    suspense: 0,
    suspense_by_reason: {},
  };
  for (const r of await rows<{ status: string; n: string | number }>(
    db,
    `select status, count(*) as n from conversions where org_id = $1 and programme_id = $2 group by status`,
    [orgId, programmeId],
  )) {
    conversions.by_status[r.status] = Number(r.n);
    conversions.total += Number(r.n);
  }
  // The suspense predicate and reason codes of routes/suspense.ts (a row
  // without a stored reason: CLICK_REF_UNMATCHED with a ref, else NO_CLICK_REF).
  const SUSPENSE = `org_id = $1 and programme_id = $2 and click_id is null and placement_id is null and status <> 'declined'`;
  for (const r of await rows<{ suspense_reason: string; n: string | number }>(
    db,
    `select suspense_reason, count(*) as n from conversions where ${SUSPENSE} and suspense_reason is not null group by suspense_reason`,
    [orgId, programmeId],
  )) {
    conversions.suspense_by_reason[r.suspense_reason] = Number(r.n);
  }
  const unmatched = await count(
    `select count(*) as n from conversions where ${SUSPENSE} and suspense_reason is null and returned_click_ref is not null`,
    [programmeId],
  );
  const noRef = await count(
    `select count(*) as n from conversions where ${SUSPENSE} and suspense_reason is null and returned_click_ref is null`,
    [programmeId],
  );
  if (unmatched > 0) conversions.suspense_by_reason.CLICK_REF_UNMATCHED = unmatched;
  if (noRef > 0) conversions.suspense_by_reason.NO_CLICK_REF = noRef;
  conversions.suspense = Object.values(conversions.suspense_by_reason).reduce((a, b) => a + b, 0);
  const samples = await rows<{ token: string; platform: string; account: string; asin: string }>(
    db,
    `select l.token, p.platform, p.external_account_id as account, o.merchant_item_ref as asin
       from links l
       join offers o on o.id = l.offer_id and o.org_id = $1
       join placements pl on pl.id = l.placement_id and pl.org_id = $1
       join properties p on p.id = pl.property_id and p.org_id = $1
      where l.org_id = $1 and o.programme_id = $2 and l.status = 'active' and o.status = 'active'
      order by l.created_at, l.id`,
    [orgId, programmeId],
  );
  const prefer = opts.preferPlatform ?? 'web';
  const sample = samples.find((s) => s.platform === prefer) ?? samples[0] ?? null;
  return {
    org_id: orgId,
    store_id: acct.storeId,
    account_status: acct.accountStatus,
    programme_id: programmeId,
    programme_status: acct.programmeStatus,
    placements,
    placements_with_tracking_id: withTag,
    tracking_ids: withTag,
    offers: { active: statusCount('active'), stale: statusCount('stale'), revoked: statusCount('revoked'), priced_now: pricedNow },
    looks_with_amazon_items: looks,
    links_active: linksActive,
    clicks,
    conversions,
    sample_link: sample,
  };
}

/**
 * The kill switch for the Amazon programme (the CLI's `pause` / `resume`):
 * POST /v1/programmes/:id/pause|resume through the API itself, as the
 * organisation's first network_admin (the audit row's actor must be a users
 * row). The route pauses every link at once (the redirect serves its paused
 * page), refuses new links, and clears the cached routes after its commit.
 */
export async function amazonKillSwitch(opts: {
  orgSlug: string;
  action: 'pause' | 'resume';
  /** A bearer token for (sub, org_id) with the network_admin role. */
  sign: (sub: string, orgId: string) => string;
  post: (url: string, bearer: string) => Promise<InjectResponse>;
}): Promise<{ programme_id: string; status: string; invalidated_routes: number; redis_available: boolean | null }> {
  const db = getPool();
  const acct = await orgAccount(db, opts.orgSlug);
  const admin = (
    await rows<{ user_id: string }>(
      db,
      `select user_id from memberships where org_id = $1 and role = 'network_admin' order by created_at, user_id limit 1`,
      [acct.orgId],
    )
  )[0];
  if (!admin) throw new Error(`no network_admin member in '${opts.orgSlug}' (the audit row needs a real user; db/seed-network.ts seeds one)`);
  const res = await opts.post(`/v1/programmes/${acct.programmeId}/${opts.action}`, opts.sign(admin.user_id, acct.orgId));
  let body: { data?: { status?: string; invalidated_routes?: number; redis_available?: boolean }; error?: { code?: string; message?: string } } = {};
  try {
    body = JSON.parse(res.body) as typeof body;
  } catch {
    // reported below
  }
  if (res.statusCode !== 200 || !body.data) {
    throw new Error(`${opts.action} refused: HTTP ${res.statusCode} ${body.error?.code ?? 'INTERNAL'}: ${body.error?.message ?? ''}`.trim());
  }
  return {
    programme_id: acct.programmeId,
    status: body.data.status ?? 'unknown',
    invalidated_routes: typeof body.data.invalidated_routes === 'number' ? body.data.invalidated_routes : 0,
    redis_available: typeof body.data.redis_available === 'boolean' ? body.data.redis_available : null,
  };
}
