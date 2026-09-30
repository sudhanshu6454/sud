/**
 * Analytics from the daily rollups (the workers' analytics job fills
 * click_daily and reply_daily; packages/workers/src/analytics/rollup.ts).
 * Read-only; money is never read here (earnings stay GET
 * /v1/publisher/earnings, from the ledger).
 *
 * Clicks are human clicks on tracked links (the redirect records no click for
 * automated clients, prefetches or HEAD) per IST day, grouped by day, look,
 * celebrity, piece, in-house page (property), link or surface (via).
 */
import { AppError } from '@paparazzi/shared';
import { tenantQuery } from '../db.js';
import { isoDate } from './sql.js';

export const CLICK_GROUPS = ['day', 'look', 'celebrity', 'piece', 'property', 'link', 'via'] as const;
export type ClickGroup = (typeof CLICK_GROUPS)[number];

function checkRange(from: string, to: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || isoDate(from) !== from || isoDate(to) !== to) {
    throw new AppError('VALIDATION_ERROR', 'from and to are YYYY-MM-DD', 400);
  }
  if (from > to) throw new AppError('VALIDATION_ERROR', 'from is after to', 400);
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86_400_000) throw new AppError('VALIDATION_ERROR', 'at most 366 days', 400);
}

/** The SQL group key of each grouping (a fixed map: never interpolated from the request). */
const GROUP_KEY: Record<ClickGroup, string> = {
  day: 'cd.day',
  look: 'li.look_id',
  celebrity: 'lk.celebrity_id',
  piece: 'li.piece_id',
  property: 'pl.property_id',
  link: 'cd.link_id',
  via: 'cd.via',
};

/**
 * Clicks per group over [from, to], summed in SQL (one row per group: the
 * number of rows sent to the api does not grow with links × days × surfaces).
 */
export async function clickAnalytics(orgId: string, q: { from: string; to: string; group_by: ClickGroup }) {
  checkRange(q.from, q.to);
  const key = GROUP_KEY[q.group_by];
  const rows = (
    await tenantQuery<{ k: string | Date | null; n: number | string }>(
      orgId,
      `select ${key} as k, sum(cd.clicks) as n
         from click_daily cd
         join links l on l.id = cd.link_id and l.org_id = $1
         join placements pl on pl.id = l.placement_id and pl.org_id = $1
         left join look_items li on li.id = l.look_item_id and li.org_id = $1
         left join looks lk on lk.id = li.look_id and lk.org_id = $1
        where cd.org_id = $1 and cd.day >= $2::date and cd.day <= $3::date
        group by ${key}`,
      [q.from, q.to],
    )
  ).rows;
  const sums = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const k = (q.group_by === 'day' ? isoDate(r.k as string | Date | null) : (r.k as string | null)) ?? '(none)';
    const n = Number(r.n);
    sums.set(k, (sums.get(k) ?? 0) + n);
    total += n;
  }
  const labels = await labelsFor(orgId, q.group_by, [...sums.keys()].filter((k) => k !== '(none)'));
  const groups = [...sums.entries()]
    .map(([k, clicks]) => ({ key: k, label: labels.get(k) ?? (k === '(none)' ? 'not a look link' : k), clicks }))
    .sort((a, b) => (q.group_by === 'day' ? a.key.localeCompare(b.key) : b.clicks - a.clicks || a.key.localeCompare(b.key)));
  return { from: q.from, to: q.to, group_by: q.group_by, total_clicks: total, groups };
}

async function labelsFor(orgId: string, group: ClickGroup, keys: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (keys.length === 0) return m;
  const load = async (sql: string) => {
    for (const r of (await tenantQuery<{ id: string; label: string }>(orgId, sql, [keys])).rows) m.set(r.id, r.label);
  };
  if (group === 'look') await load(`select id, title as label from looks where org_id = $1 and id = any($2)`);
  if (group === 'celebrity') await load(`select id, name as label from celebrities where org_id = $1 and id = any($2)`);
  if (group === 'piece') await load(`select id, label from look_pieces where org_id = $1 and id = any($2)`);
  if (group === 'property') {
    for (const r of (await tenantQuery<{ id: string; platform: string; account: string }>(orgId, `select id, platform, external_account_id as account from properties where org_id = $1 and id = any($2)`, [keys])).rows) {
      m.set(r.id, `${r.platform}:${r.account}`);
    }
  }
  return m;
}

export async function replyAnalytics(orgId: string, q: { from: string; to: string }) {
  checkRange(q.from, q.to);
  const rows = (
    await tenantQuery<{ day: string | Date; rule_id: string; received: number; sent: number; skipped: number; failed: number; look_id: string }>(
      orgId,
      `select rd.day, rd.rule_id, rd.received, rd.sent, rd.skipped, rd.failed, rr.look_id
         from reply_daily rd join reply_rules rr on rr.id = rd.rule_id and rr.org_id = $1
        where rd.org_id = $1 and rd.day >= $2::date and rd.day <= $3::date
        order by rd.day, rd.rule_id`,
      [q.from, q.to],
    )
  ).rows;
  const days = new Map<string, { received: number; sent: number; skipped: number; failed: number }>();
  const byRule = new Map<string, { look_id: string; received: number; sent: number; skipped: number; failed: number }>();
  for (const r of rows) {
    const d = isoDate(r.day) as string;
    const a = days.get(d) ?? { received: 0, sent: 0, skipped: 0, failed: 0 };
    const b = byRule.get(r.rule_id) ?? { look_id: r.look_id, received: 0, sent: 0, skipped: 0, failed: 0 };
    for (const k of ['received', 'sent', 'skipped', 'failed'] as const) {
      a[k] += Number(r[k]);
      b[k] += Number(r[k]);
    }
    days.set(d, a);
    byRule.set(r.rule_id, b);
  }
  return {
    from: q.from,
    to: q.to,
    days: [...days.entries()].map(([day, v]) => ({ day, ...v })),
    rules: [...byRule.entries()].map(([rule_id, v]) => ({ rule_id, ...v })),
  };
}
