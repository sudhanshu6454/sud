'use client';

/*
 * Click analytics (admin, no artboard): human clicks on the tracked links of
 * celebrity looks (the redirect records no click for automated clients,
 * prefetches or HEAD) per IST day, from the workers' hourly rollup
 * (click_daily), grouped by day, celebrity, look, piece, page, link or
 * surface (via), over 7, 30 or 90 days; comment replies per day. CSV
 * export. Live: GET /v1/analytics/clicks, GET /v1/analytics/replies. Money
 * is never read here (earnings stay in the ledger).
 */

import { useMemo, useState } from 'react';
import { AdminSection } from '@/components/admin/AdminSection';
import { PageNote } from '@/components/shell/PageBody';
import { BarChart, Button, KpiCell, KpiStrip, Segmented, Select } from '@/components/ui';
import { CLICK_GROUPS, clicksCsv, daysOf, lastDays, type ClickAnalytics, type ClickGroup, type ReplyAnalytics } from '@/lib/celebrity-admin';
import { demoClicks, demoReplyAnalytics } from '@/lib/demo/celebrity';
import { downloadCsv } from '@/lib/download';
import { formatCount } from '@/lib/format';
import { LiveBadge, LiveBanner } from './LiveStatus';
import { useLiveData } from './useLiveData';
import styles from './admin.module.css';

const RANGES = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
] as const;

export function AnalyticsScreen() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [group, setGroup] = useState<ClickGroup>('day');
  const range = useMemo(() => lastDays(Number(days)), [days]);
  const clicks = useLiveData<ClickAnalytics>(`/v1/analytics/clicks?from=${range.from}&to=${range.to}&group_by=${group}`, demoClicks(group, Number(days)), 'the click analytics');
  const byDay = useLiveData<ClickAnalytics>(`/v1/analytics/clicks?from=${range.from}&to=${range.to}&group_by=day`, demoClicks('day', Number(days)), 'the click analytics');
  const replies = useLiveData<ReplyAnalytics>(`/v1/analytics/replies?from=${range.from}&to=${range.to}`, demoReplyAnalytics(Number(days)), 'the reply analytics');
  const series = useMemo(() => {
    const m = new Map(byDay.value.groups.map((g) => [g.key, g.clicks]));
    const all = daysOf(range.from, range.to);
    return { values: all.map((d) => m.get(d) ?? 0), labels: [all[0] ?? '', all[Math.floor(all.length / 2)] ?? '', all[all.length - 1] ?? ''] };
  }, [byDay.value.groups, range]);
  const totals = replies.value.days.reduce((a, d) => ({ received: a.received + d.received, sent: a.sent + d.sent, skipped: a.skipped + d.skipped, failed: a.failed + d.failed }), { received: 0, sent: 0, skipped: 0, failed: 0 });
  const groupLabel = CLICK_GROUPS.find((g) => g.value === group)?.label ?? group;

  return (
    <>
      <h1 className="sr-only">Admin: click analytics</h1>
      <AdminSection
        title="Analytics"
        titleId="analytics-title"
        badge={<LiveBadge demo={clicks.demo} cause={clicks.cause} />}
        aside={<Segmented aria-label="Range" options={RANGES.map((r) => ({ value: r.value, label: r.label }))} value={days} onChange={(v) => setDays(v)} />}
      >
        <LiveBanner notice={clicks.notice} />
        <PageNote>
          Human clicks on the tracked links of celebrity looks, per India day, from the hourly rollup ({range.from} to {range.to}). Surface is where the
          click came from on afflino.com (a storefront, a comment reply), never who.
        </PageNote>
        <KpiStrip columns={4}>
          <KpiCell label="Clicks" value={formatCount(byDay.value.total_clicks)} size={32} meta={`${days} days`} />
          <KpiCell label="Replies received" value={formatCount(totals.received)} size={32} />
          <KpiCell label="Replies sent" value={formatCount(totals.sent)} size={32} />
          <KpiCell label="Skipped / failed" value={`${formatCount(totals.skipped)} / ${formatCount(totals.failed)}`} size={32} />
        </KpiStrip>
        <div className={styles.chart}>
          <BarChart data={series.values} axisLabels={series.labels} label={`Clicks per day, ${range.from} to ${range.to}`} highlightLast={1} barLabel={(v, i) => `${daysOf(range.from, range.to)[i] ?? ''} · ${v} clicks`} height={160} />
        </div>
      </AdminSection>
      <AdminSection
        title={`Clicks by ${groupLabel.toLowerCase()}`}
        titleId="clicks-by-title"
        aside={
          <span className={styles.actions}>
            <Select compact aria-label="Group by" className={styles.inline} value={group} onChange={(e) => setGroup(e.target.value as ClickGroup)} options={CLICK_GROUPS.map((g) => ({ value: g.value, label: `By ${g.label.toLowerCase()}` }))} />
            <Button size="sm" onClick={() => downloadCsv(`afflino-clicks-${group}-${range.from}-${range.to}.csv`, clicksCsv(clicks.value, groupLabel))}>
              Export CSV
            </Button>
          </span>
        }
      >
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th>{groupLabel}</th>
              <th>Clicks</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {clicks.value.groups.map((g) => (
              <tr key={g.key || '(none)'}>
                <td>
                  {g.label}
                  {group !== 'day' && g.key && g.key !== g.label ? <div className={styles.mono}>{g.key}</div> : null}
                </td>
                <td>{formatCount(g.clicks)}</td>
                <td>{clicks.value.total_clicks ? `${Math.round((g.clicks / clicks.value.total_clicks) * 100)}%` : '—'}</td>
              </tr>
            ))}
            {clicks.value.groups.length === 0 ? (
              <tr>
                <td colSpan={3} className={styles.muted}>
                  No clicks in this range yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </AdminSection>
    </>
  );
}
