/**
 * The public read side of celebrity looks (routes/public.ts): the Spotted
 * feed, a celebrity's hub, a storefront per in-house page and the sitemap
 * lists. No token: the organisation is named by its public slug, and every
 * query after that lookup is tenant-scoped ($1 = its id).
 *
 * The READ GATE, in SQL for every list (the same conditions publicVisibility
 * applies to one look): the look is published and not under takedown; its
 * celebrity is not under takedown, not a minor, not never-listed, has a
 * rights status whose capability allows the name (publishableRightsStatuses)
 * and a review that allows at least the name. The image of each card is then
 * decided per look (licence, territory, expiry, screen: assetImageRefusals).
 */
import {
  effectiveCelebrityRights,
  effectiveLookDisplay,
  lookHeadline,
  publishableRightsStatuses,
  CELEBRITY_COPY,
} from '@paparazzi/shared';
import { getPool, tenantQuery } from '../db.js';
import { stillPath, storefrontNamesAnyone } from './bundle.js';
import { celebrityNames, namesIn, type CelebrityName } from './names.js';
import { isoDate, istToday, toIso } from './sql.js';

/** Public answers may be cached this long (downstream; the API's own cache is routes/public.ts's, cleared by every invalidation). */
export const PUBLIC_CACHE_SECONDS = 30;

/**
 * The organisation behind a public slug. The one query of the public side
 * that is not tenant-scoped: the slug IS the tenant's public name (the same
 * kind of documented exception as the redirect's lookup by token).
 */
export async function orgBySlug(slug: string): Promise<string | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 63) return null;
  const r = (await getPool().query<{ id: string }>(`select id from organisations where slug = $1`, [slug])).rows[0];
  return r?.id ?? null;
}

const STATUS_LIST = () =>
  publishableRightsStatuses()
    .map((s) => `'${s}'`)
    .join(', ');

/** The read gate as SQL (aliases l = looks, c = celebrities). */
export function readGateSql(): string {
  return `l.status = 'published' and l.takedown_id is null and l.celebrity_id is not null
     and c.takedown_id is null and c.is_minor = false and c.never_list = false
     and c.rights_status in (${STATUS_LIST()}) and c.max_display <> 'none'`;
}

/** The owner-operated verification of a property, as SQL (alias p = properties). */
const OWNER_OPERATED_SQL = `p.id in (select v.property_id from verifications v
    where v.org_id = $1 and v.method = 'owner_operated' and v.verified_at is not null
      and (v.expires_at is null or v.expires_at > now()))`;

interface CardRow {
  id: string;
  event_name: string | null;
  place: string | null;
  moment_date: string | Date | null;
  published_at: string | Date | null;
  updated_at: string | Date | null;
  celebrity_display: string;
  property_id: string | null;
  c_name: string;
  c_slug: string;
  rights_status: string;
  max_display: string;
  shoppable: boolean;
  is_minor: boolean;
  never_list: boolean;
  c_takedown_id: string | null;
  kind: string | null;
  public_url: string | null;
  license: string | null;
  commercial_reuse: string | null;
  territory: string | null;
  expires_at: string | Date | null;
  screen_status: string | null;
  minor_in_frame: boolean | null;
  bystanders: boolean | null;
  sensitive_location: boolean | null;
  live_performance: boolean | null;
  copyright_owner: string | null;
  acquisition: string | null;
  assignment_ref: string | null;
  platform: string | null;
  storefront_slug: string | null;
  storefront_name: string | null;
  storefront_bio: string | null;
  storefront_status: string | null;
}

const CARD_SELECT = `select l.id, l.event_name, l.place, l.moment_date, l.published_at, l.updated_at, l.celebrity_display, l.property_id,
       c.name as c_name, c.slug as c_slug, c.rights_status, c.max_display, c.shoppable, c.is_minor, c.never_list,
       c.takedown_id as c_takedown_id,
       a.kind, a.public_url, a.license, a.commercial_reuse, a.territory, a.expires_at, a.screen_status,
       a.minor_in_frame, a.bystanders, a.sensitive_location, a.live_performance,
       a.copyright_owner, a.acquisition, a.assignment_ref,
       p.platform, s.slug as storefront_slug, s.display_name as storefront_name, s.bio as storefront_bio, s.status as storefront_status
  from looks l
  join celebrities c on c.id = l.celebrity_id and c.org_id = $1
  left join assets a on a.id = l.still_asset_id and a.org_id = $1
  left join properties p on p.id = l.property_id and p.org_id = $1
  left join storefronts s on s.property_id = l.property_id and s.org_id = $1`;

/** A storefront row may be shown: live, and its text names nobody. */
function storefrontShown(slug: string | null, name: string | null, bio: string | null, status: string | null, names: readonly CelebrityName[]): boolean {
  return status === 'live' && !!slug && !storefrontNamesAnyone({ slug, display_name: name, bio }, names);
}

interface PieceInfo {
  count: number;
  labels: string[];
}

/** A card's look may be listed: none of its own text (event, place, piece labels) names anyone. */
function cardShown(r: CardRow, info: PieceInfo | undefined, names: readonly CelebrityName[]): boolean {
  return namesIn([r.event_name, r.place, ...(info?.labels ?? [])], names).length === 0;
}

function card(r: CardRow, pieces: number, now: number, names: readonly CelebrityName[]) {
  const rights = effectiveCelebrityRights({ ...r, takedown_id: r.c_takedown_id });
  const d = effectiveLookDisplay(rights, r.celebrity_display, r, now);
  return {
    id: r.id,
    headline: lookHeadline({ event: r.event_name, place: r.place }),
    celebrity: { name: r.c_name, slug: r.c_slug },
    non_endorsement: CELEBRITY_COPY.nonEndorsement(r.c_name),
    moment: { event: r.event_name, place: r.place, date: isoDate(r.moment_date) },
    image: d.image ? { url: stillPath(r.id, r.public_url) } : null,
    source: {
      platform: r.platform,
      storefront: storefrontShown(r.storefront_slug, r.storefront_name, r.storefront_bio, r.storefront_status, names)
        ? { slug: r.storefront_slug as string, name: r.storefront_name }
        : null,
    },
    pieces,
    shoppable: d.shoppable,
    published_at: toIso(r.published_at),
  };
}

export interface FeedQuery {
  page: number;
  page_size: number;
  celebrity?: string;
  storefront?: string;
}

/** The commercial label of a list page: only when at least one listed look carries products. */
function listLabel(items: Array<{ shoppable: boolean }>): string | null {
  return items.some((i) => i.shoppable) ? CELEBRITY_COPY.commercialLabel : null;
}

export async function spottedFeed(orgId: string, q: FeedQuery, now: number = Date.now(), names?: CelebrityName[]) {
  const all = names ?? (await celebrityNames(orgId));
  const filters = [`l.org_id = $1`, readGateSql()];
  const params: unknown[] = [];
  if (q.celebrity) {
    params.push(q.celebrity);
    filters.push(`c.slug = $${params.length + 1}`);
  }
  if (q.storefront) {
    params.push(q.storefront);
    filters.push(`s.slug = $${params.length + 1} and s.status = 'live'`);
  }
  const where = `where ${filters.join(' and ')}`;
  const total = await tenantQuery<{ n: string | number }>(
    orgId,
    `select count(*) as n
       from looks l
       join celebrities c on c.id = l.celebrity_id and c.org_id = $1
       left join storefronts s on s.property_id = l.property_id and s.org_id = $1
      ${where}`,
    params,
  );
  params.push(q.page_size, (q.page - 1) * q.page_size);
  const rows = (
    await tenantQuery<CardRow>(orgId, `${CARD_SELECT} ${where} order by l.published_at desc nulls last, l.id limit $${params.length} offset $${params.length + 1}`, params)
  ).rows;
  const info = await pieceInfo(orgId, rows.map((r) => r.id));
  // A look whose own text names anyone (a celebrity or alias added after it was published) is not listed.
  const shown = rows.filter((r) => cardShown(r, info.get(r.id), all));
  const items = shown.map((r) => card(r, info.get(r.id)?.count ?? 0, now, all));
  return {
    items,
    page: q.page,
    page_size: q.page_size,
    total: Math.max(0, Number(total.rows[0]?.n ?? 0) - (rows.length - shown.length)),
    commercial_label: listLabel(items),
  };
}

async function pieceInfo(orgId: string, lookIds: string[]): Promise<Map<string, PieceInfo>> {
  const m = new Map<string, PieceInfo>();
  if (lookIds.length === 0) return m;
  const rows = (
    await tenantQuery<{ look_id: string; label: string }>(
      orgId,
      `select look_id, label from look_pieces where org_id = $1 and removed_at is null and look_id = any($2)`,
      [lookIds],
    )
  ).rows;
  for (const r of rows) {
    const cur = m.get(r.look_id) ?? { count: 0, labels: [] };
    cur.count += 1;
    cur.labels.push(r.label);
    m.set(r.look_id, cur);
  }
  return m;
}

/**
 * The feed's filters: the celebrities and the in-house pages (live
 * storefronts whose text names nobody) that have public looks right now,
 * each with its count. The same read gate as the feed, so a name appears
 * here only while it may be shown on a page.
 */
export async function spottedFacets(orgId: string, names?: CelebrityName[]) {
  const all = names ?? (await celebrityNames(orgId));
  const rows = (
    await tenantQuery<{ id: string; event_name: string | null; place: string | null; c_slug: string; c_name: string; s_slug: string | null; s_name: string | null; s_bio: string | null; s_status: string | null }>(
      orgId,
      `select l.id, l.event_name, l.place, c.slug as c_slug, c.name as c_name, s.slug as s_slug, s.display_name as s_name, s.bio as s_bio, s.status as s_status
         from looks l
         join celebrities c on c.id = l.celebrity_id and c.org_id = $1
         left join storefronts s on s.property_id = l.property_id and s.org_id = $1
        where l.org_id = $1 and ${readGateSql()}`,
    )
  ).rows;
  const info = await pieceInfo(orgId, rows.map((r) => r.id));
  const celebs = new Map<string, { slug: string; name: string; looks: number }>();
  const pages = new Map<string, { slug: string; name: string; looks: number }>();
  for (const r of rows) {
    if (namesIn([r.event_name, r.place, ...(info.get(r.id)?.labels ?? [])], all).length > 0) continue;
    const c = celebs.get(r.c_slug) ?? { slug: r.c_slug, name: r.c_name, looks: 0 };
    c.looks += 1;
    celebs.set(r.c_slug, c);
    if (storefrontShown(r.s_slug, r.s_name, r.s_bio, r.s_status, all)) {
      const slug = r.s_slug as string;
      const p = pages.get(slug) ?? { slug, name: r.s_name ?? slug, looks: 0 };
      p.looks += 1;
      pages.set(slug, p);
    }
  }
  const byName = (a: { name: string; slug: string }, b: { name: string; slug: string }) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug);
  return { celebrities: [...celebs.values()].sort(byName), storefronts: [...pages.values()].sort(byName) };
}

/** How far back the trending row looks, and how many looks it holds at most. */
export const TRENDING_DEFAULT_DAYS = 7;
export const TRENDING_MAX = 12;

/** The IST day `n` days before today (YYYY-MM-DD). */
function istDaysAgo(n: number, now: number): string {
  return istToday(now - n * 86_400_000);
}

/**
 * The trending row: public looks ranked by human clicks on their products'
 * tracked links over the last `days` IST days (the workers' hourly rollup,
 * click_daily; the redirect records no click for automated clients,
 * prefetches or HEAD). Only looks that pass the read gate; ties by
 * publication time. The counts themselves are not returned (a rank, not a
 * figure for the public). Empty until the rollup has clicks.
 */
export async function trendingLooks(orgId: string, q: { days: number; limit: number }, now: number = Date.now()) {
  const names = await celebrityNames(orgId);
  const from = istDaysAgo(Math.max(q.days - 1, 0), now);
  const to = istToday(now);
  const clicks = (
    await tenantQuery<{ look_id: string; clicks: number | string }>(
      orgId,
      `select li.look_id, cd.clicks
         from click_daily cd
         join links k on k.id = cd.link_id and k.org_id = $1
         join look_items li on li.id = k.look_item_id and li.org_id = $1
        where cd.org_id = $1 and cd.day >= $2::date and cd.day <= $3::date and li.look_id is not null`,
      [from, to],
    )
  ).rows;
  const sums = new Map<string, number>();
  for (const r of clicks) sums.set(r.look_id, (sums.get(r.look_id) ?? 0) + Number(r.clicks));
  const ranked = [...sums.entries()].filter(([, n]) => n > 0);
  if (ranked.length === 0) return { items: [], days: q.days, from, to };
  const rows = (
    await tenantQuery<CardRow>(orgId, `${CARD_SELECT} where l.org_id = $1 and ${readGateSql()} and l.id = any($2)`, [ranked.map(([id]) => id)])
  ).rows;
  const published = (r: CardRow) => (r.published_at ? new Date(r.published_at).getTime() : 0);
  const info = await pieceInfo(orgId, rows.map((r) => r.id));
  const shown = rows.filter((r) => cardShown(r, info.get(r.id), names));
  shown.sort((a, b) => (sums.get(b.id) ?? 0) - (sums.get(a.id) ?? 0) || published(b) - published(a) || a.id.localeCompare(b.id));
  const top = shown.slice(0, q.limit);
  return { items: top.map((r) => card(r, info.get(r.id)?.count ?? 0, now, names)), days: q.days, from, to };
}

export type HubOutcome = { kind: 'ok'; body: Record<string, unknown> } | { kind: 'gone' } | { kind: 'not_found' };

/**
 * A celebrity's hub: only while the rights allow the name. Under a takedown
 * it answers 410 only when the celebrity had a public look once (a hub that
 * never existed stays a 404: a 410 would tell anyone probing /c/<name> that
 * the library holds that person and a notice arrived).
 */
export async function celebrityHub(orgId: string, slug: string, q: { page: number; page_size: number }, now: number = Date.now()): Promise<HubOutcome> {
  const c = (
    await tenantQuery<{ id: string; name: string; slug: string; rights_status: string; max_display: string; shoppable: boolean; is_minor: boolean; never_list: boolean; takedown_id: string | null }>(
      orgId,
      `select id, name, slug, rights_status, max_display, shoppable, is_minor, never_list, takedown_id from celebrities where org_id = $1 and slug = $2`,
      [slug],
    )
  ).rows[0];
  if (!c) return { kind: 'not_found' };
  if (c.takedown_id) {
    const once = (await tenantQuery<{ id: string }>(orgId, `select id from looks where org_id = $1 and celebrity_id = $2 and published_at is not null limit 1`, [c.id])).rows[0];
    return once ? { kind: 'gone' } : { kind: 'not_found' };
  }
  const rights = effectiveCelebrityRights(c);
  if (rights.display === 'none') return { kind: 'not_found' };
  const feed = await spottedFeed(orgId, { ...q, celebrity: slug }, now);
  if (feed.total === 0) return { kind: 'not_found' };
  return {
    kind: 'ok',
    body: {
      celebrity: { name: c.name, slug: c.slug },
      commercial_label: feed.commercial_label,
      non_endorsement: CELEBRITY_COPY.nonEndorsement(c.name),
      looks: feed,
    },
  };
}

/**
 * A live storefront of an approved, owner-operated in-house page, with its
 * public looks. Never one whose slug, name or bio names a celebrity (404:
 * the storefront is the page's own, not a celebrity page; a name reaches a
 * page only in the credit line of that person's own look).
 */
export async function storefrontPage(orgId: string, slug: string, q: { page: number; page_size: number }, now: number = Date.now()) {
  const s = (
    await tenantQuery<{ id: string; slug: string; display_name: string; bio: string | null; status: string; property_id: string; platform: string; status_p: string; canonical_url: string | null }>(
      orgId,
      `select s.id, s.slug, s.display_name, s.bio, s.status, s.property_id, p.platform, p.status as status_p, p.canonical_url
         from storefronts s join properties p on p.id = s.property_id and p.org_id = $1
        where s.org_id = $1 and s.slug = $2`,
      [slug],
    )
  ).rows[0];
  if (!s || s.status !== 'live' || s.status_p !== 'approved') return null;
  const owner = (
    await tenantQuery<{ id: string }>(
      orgId,
      `select id from verifications where org_id = $1 and property_id = $2 and method = 'owner_operated'
          and verified_at is not null and (expires_at is null or expires_at > now()) limit 1`,
      [s.property_id],
    )
  ).rows[0];
  if (!owner) return null;
  const names = await celebrityNames(orgId);
  if (storefrontNamesAnyone(s, names)) return null;
  const feed = await spottedFeed(orgId, { ...q, storefront: slug }, now, names);
  return {
    storefront: { slug: s.slug, name: s.display_name, bio: s.bio, platform: s.platform, page_url: s.canonical_url },
    commercial_label: feed.commercial_label,
    looks: feed,
  };
}

/** What a sitemap may list: public looks, the hubs that have one, live storefronts of owner-operated pages whose text names nobody. */
export async function sitemapLists(orgId: string, now: number = Date.now()) {
  const names = await celebrityNames(orgId);
  const all = (await tenantQuery<CardRow>(orgId, `${CARD_SELECT} where l.org_id = $1 and ${readGateSql()} order by l.published_at desc nulls last, l.id limit 5000`)).rows;
  const info = await pieceInfo(orgId, all.map((r) => r.id));
  const rows = all.filter((r) => cardShown(r, info.get(r.id), names));
  const looks = rows.map((r) => ({ id: r.id, updated_at: toIso(r.updated_at ?? r.published_at), celebrity_slug: r.c_slug, image: card(r, 0, now, names).image !== null }));
  const celebrities = [...new Set(rows.map((r) => r.c_slug))].sort();
  const storefronts = (
    await tenantQuery<{ slug: string; display_name: string; bio: string | null }>(
      orgId,
      `select s.slug, s.display_name, s.bio from storefronts s join properties p on p.id = s.property_id and p.org_id = $1
        where s.org_id = $1 and s.status = 'live' and p.status = 'approved' and ${OWNER_OPERATED_SQL} order by s.slug`,
    )
  ).rows
    .filter((r) => !storefrontNamesAnyone(r, names))
    .map((r) => r.slug);
  return { looks, celebrities, storefronts };
}
