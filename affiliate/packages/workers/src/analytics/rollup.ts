/**
 * Daily rollups for the analytics endpoints (api src/looks/analytics.ts).
 *
 * click_daily   human clicks per (organisation, IST day, link, via): the
 *               redirect writes one clicks row per human click (none for
 *               automated clients, prefetches or HEAD). Recomputed from
 *               clicks for the last `days` IST days (default 2: today and
 *               yesterday) and upserted — idempotent, and incremental in the
 *               sense that older days are never read again. `via` is
 *               clicks.context.via ('' when none); it is read long before the
 *               retention purge nulls clicks.context (365 days).
 * reply_daily   per (organisation, IST day of receipt, rule): received, sent,
 *               skipped (skipped_*), failed (failed_permanent, unknown).
 *               Recomputed for the last 8 days (an event can still change
 *               status within Meta's 7-day window), and kept after the events
 *               themselves are purged.
 *
 * Never over a purged day: a day is recomputed only while it is wholly
 * inside the retention windows (`replyRetentionDays`:
 * RETENTION_REPLY_EVENTS_DAYS, whose purge deletes reply_events;
 * `clickContextDays`: RETENTION_CLICK_CONTEXT_DAYS, whose purge nulls
 * clicks.context and with it `via`). Recomputing a day the purge has
 * reached would overwrite its stored counts with smaller ones (or move its
 * clicks to via ''), so such a day keeps the counts it was given.
 *
 * Read-only with respect to money: nothing here names a ledger, conversion
 * or payout table. Day bounds are computed here (IST = UTC+05:30, no DST),
 * not in SQL (pg-mem has no AT TIME ZONE / date_trunc); counts use
 * sum(case …) rather than count(*) filter (pg-mem miscounts filter).
 */
import type { Pool } from 'pg';

export function istDay(ms: number): string {
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
}

export function istBounds(day: string): { start: string; end: string } {
  const start = new Date(`${day}T00:00:00+05:30`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
}

export function lastIstDays(n: number, now: number = Date.now()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(istDay(now - i * 86_400_000));
  return out;
}

export interface RollupSummary {
  orgs: number;
  click_days: string[];
  click_rows: number;
  reply_days: string[];
  reply_rows: number;
}

/** The days (of `days`) that start inside the last `windowDays` days; all of them without a window. */
export function daysWithinWindow(days: string[], windowDays: number | undefined, now: number): string[] {
  if (windowDays === undefined) return days;
  const cutoff = now - windowDays * 86_400_000;
  return days.filter((d) => new Date(istBounds(d).start).getTime() >= cutoff);
}

export async function runRollups(
  pool: Pool,
  opts: { now?: number; clickDays?: number; replyDays?: number; replyRetentionDays?: number; clickContextDays?: number } = {},
): Promise<RollupSummary> {
  const now = opts.now ?? Date.now();
  const clickDays = daysWithinWindow(lastIstDays(opts.clickDays ?? 2, now), opts.clickContextDays, now);
  const replyDays = daysWithinWindow(lastIstDays(opts.replyDays ?? 8, now), opts.replyRetentionDays, now);
  const orgs = (await pool.query<{ id: string }>(`select id from organisations order by id`)).rows;
  let clickRows = 0;
  let replyRows = 0;
  for (const org of orgs) {
    for (const day of clickDays) {
      const b = istBounds(day);
      const res = await pool.query(
        `insert into click_daily (org_id, day, link_id, via, clicks, updated_at)
         select org_id, $2::date, link_id, coalesce(context->>'via', ''), count(*), now()
           from clicks
          where org_id = $1 and occurred_at >= $3::timestamptz and occurred_at < $4::timestamptz
          group by org_id, link_id, coalesce(context->>'via', '')
         on conflict (org_id, day, link_id, via) do update set clicks = excluded.clicks, updated_at = excluded.updated_at`,
        [org.id, day, b.start, b.end],
      );
      clickRows += res.rowCount ?? 0;
    }
    for (const day of replyDays) {
      const b = istBounds(day);
      const res = await pool.query(
        `insert into reply_daily (org_id, day, rule_id, received, sent, skipped, failed, updated_at)
         select org_id, $2::date, rule_id, count(*),
                sum(case when status = 'sent' then 1 else 0 end),
                sum(case when status in ('skipped_suppressed', 'skipped_expired', 'skipped_disabled', 'skipped_shadow') then 1 else 0 end),
                sum(case when status in ('failed_permanent', 'unknown') then 1 else 0 end),
                now()
           from reply_events
          where org_id = $1 and received_at >= $3::timestamptz and received_at < $4::timestamptz
          group by org_id, rule_id
         on conflict (org_id, day, rule_id) do update
           set received = excluded.received, sent = excluded.sent, skipped = excluded.skipped, failed = excluded.failed,
               updated_at = excluded.updated_at`,
        [org.id, day, b.start, b.end],
      );
      replyRows += res.rowCount ?? 0;
    }
  }
  return { orgs: orgs.length, click_days: clickDays, click_rows: clickRows, reply_days: replyDays, reply_rows: replyRows };
}
