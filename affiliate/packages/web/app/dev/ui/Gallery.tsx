'use client';

import { useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import {
  Banner,
  BarChart,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  Eyebrow,
  Field,
  Input,
  KpiCell,
  KpiStrip,
  Lockup,
  Mark,
  PageHeader,
  ProgressBar,
  Segmented,
  Select,
  SelectableCardGroup,
  Skeleton,
  StatusTag,
  Tag,
  TagButton,
  Textarea,
  Wordmark,
} from '@/components/ui';
import {
  DEMO_CREATOR,
  DEMO_CREATOR_SUMMARY,
  DEMO_DAILY_EARNINGS_AXIS,
  DEMO_DAILY_EARNINGS_CURRENT,
  DEMO_DAILY_EARNINGS_PCT,
  DEMO_EARNINGS_BY_PLATFORM,
  DEMO_OFFERS,
  DEMO_TOP_LINKS,
  PLATFORM_NAME,
  type DemoTopLink,
} from '@/lib/demo/afflino';
import {
  formatCount,
  formatCountCompact,
  formatDayMonth,
  formatINRCompactFromMinor,
  formatINRFromMinor,
  formatINRWhole,
  formatPayout,
  formatPct,
  formatRate,
} from '@/lib/format';
import { CREATOR_DISCLOSURE_LINE, MIN_WITHDRAWAL_RUPEES, TDS } from '@/lib/site-copy';
import { validatePan, validateSubId, validateUpi } from '@/lib/validators';
import styles from './gallery.module.css';

const COLORS = [
  'bg',
  'surface',
  'text',
  'accent',
  'accent-100',
  'accent-200',
  'accent-300',
  'accent-400',
  'accent-500',
  'accent-600',
  'accent-700',
  'accent-800',
  'accent-900',
  'neutral-100',
  'neutral-200',
  'neutral-300',
  'neutral-400',
  'neutral-500',
  'neutral-600',
  'neutral-700',
  'neutral-800',
  'neutral-900',
  'divider',
];

type Range = '7d' | '30d' | '90d';
type Role = 'creator' | 'publisher' | 'brand' | 'agency';

export function Gallery() {
  const [range, setRange] = useState<Range>('30d');
  const [platform, setPlatform] = useState<'meta' | 'youtube' | 'snap'>('meta');
  const [method, setMethod] = useState<'upi' | 'bank'>('upi');
  const [role, setRole] = useState<Role | null>('creator');
  const [filter, setFilter] = useState('All');
  const [pan, setPan] = useState('ABCPN1234K');
  const [upi, setUpi] = useState<string>(DEMO_CREATOR.upiId);
  const [subId, setSubId] = useState('Reel Oct 01');
  const [agree, setAgree] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [withdrawn, setWithdrawn] = useState(false);

  const panResult = validatePan(pan);
  const upiResult = validateUpi(upi);
  const subIdResult = validateSubId(subId);

  const grossMinor = DEMO_CREATOR_SUMMARY.availableMinor;
  const tdsMinor = Math.round((grossMinor * TDS.ratePct) / 100);

  return (
    <div className={styles.page}>
      <div className={styles.intro}>
        <Eyebrow tone="accent" tracking="wide">
          Dev only · /dev/ui
        </Eyebrow>
        <h1 style={{ fontSize: 36, letterSpacing: '-0.03em', margin: '8px 0 0' }}>Afflino UI primitives</h1>
        <p>
          Every primitive in components/ui and its states, on TEST demo data (lib/demo/afflino.ts). This page
          returns 404 in production builds.
        </p>
        <div style={{ marginTop: 12 }}>
          <DemoBadge variant="mock" />
        </div>
      </div>

      <section className={styles.section}>
        <h2>Tokens</h2>
        <div className={styles.swatches}>
          {COLORS.map((c) => (
            <div key={c}>
              <div className={styles.swatch} style={{ background: `var(--color-${c})` }} />
              <div className={styles.swatchLabel}>--color-{c}</div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2>Logo</h2>
        <div className={styles.row}>
          <Mark size={72} title="Afflino" />
          <Mark size={40} variant="ink" title="Afflino (ink)" />
          <Mark size={24} />
          <div className={styles.poster}>
            <Mark size={56} variant="glyph" title="Afflino (glyph)" />
            <Lockup markSize={28} variant="glyph" />
          </div>
        </div>
        <div className={styles.stack}>
          <Lockup markSize={72} />
          <Lockup markSize={40} variant="ink" />
          <Lockup markSize={28} />
          <Lockup markSize={24} />
          <Wordmark size={18} />
        </div>
      </section>

      <section className={styles.section}>
        <h2>Buttons</h2>
        <div className={styles.row}>
          <Button variant="primary" arrow>
            Get a link
          </Button>
          <Button variant="secondary" arrow>
            Become a creator
          </Button>
          <Button variant="ghost">Log in</Button>
          <Button variant="ghost" arrow="left">
            Back
          </Button>
          <Button variant="primary" href="/app/offers" arrow>
            Link: browse offers
          </Button>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>sm / xs</span>
          <Button variant="primary" size="sm">
            Connect
          </Button>
          <Button variant="ghost" size="sm">
            Disconnect
          </Button>
          <Button variant="secondary" size="xs">
            Review
          </Button>
          <Button variant="primary" size="xs">
            Approve
          </Button>
          <Button variant="ghost" size="xs">
            Decline
          </Button>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>disabled</span>
          <Button variant="primary" disabled arrow>
            Withdraw to UPI
          </Button>
          <Button variant="secondary" disabled>
            Export CSV
          </Button>
          <Button variant="ghost" disabled>
            Save draft
          </Button>
          <Button variant="primary" href="/app" disabled>
            Disabled link
          </Button>
        </div>
        <div className={styles.row}>
          <div className={styles.poster} style={{ width: 420 }}>
            <Button variant="inverse" block flush arrow>
              Create a free account
            </Button>
          </div>
        </div>
        <div style={{ maxWidth: 320 }}>
          <Button variant="secondary" block arrow>
            Get link
          </Button>
          <Button variant="primary" block touch arrow>
            Copy link
          </Button>
          <Button variant="secondary" block touch arrow>
            Share to Instagram
          </Button>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Tags</h2>
        <div className={styles.row}>
          <Tag variant="accent">Active</Tag>
          <Tag variant="neutral">Paused</Tag>
          <Tag variant="outline">Review</Tag>
          <Tag variant="ink">Selected</Tag>
          <Tag variant="accent">CPA · Fintech</Tag>
        </div>
        <div className={styles.row}>
          <span className={styles.label}>statusTag()</span>
          {['Active', 'Paid', 'Connected', 'Paused', 'Offer', 'Review', 'Scheduled', 'KYC', 'Fraud'].map((s) => (
            <StatusTag key={s} status={s} />
          ))}
        </div>
        <div className={styles.row}>
          <span className={styles.label}>TagButton</span>
          {['All', 'Fintech', 'D2C fashion', 'Edtech'].map((f) => (
            <TagButton key={f} selected={filter === f} onClick={() => setFilter(f)}>
              {f}
            </TagButton>
          ))}
        </div>
        <div className={styles.row}>
          <DemoBadge />
          <DemoBadge variant="mock" />
        </div>
      </section>

      <section className={styles.section} style={{ padding: 0 }}>
        <PageHeader
          eyebrow="Overview"
          title="Last 30 days"
          actions={
            <>
              <Segmented
                aria-label="Date range"
                value={range}
                onChange={setRange}
                options={[
                  { value: '7d', label: '7d' },
                  { value: '30d', label: '30d' },
                  { value: '90d', label: '90d' },
                ]}
              />
              <Button variant="primary" arrow href="/app/links">
                Get a link
              </Button>
            </>
          }
        />
        <KpiStrip>
          <KpiCell
            label="Earnings"
            value={formatINRFromMinor(DEMO_CREATOR_SUMMARY.earnings30dMinor)}
            meta={`${formatPct(DEMO_CREATOR_SUMMARY.earningsDeltaPct, { signed: true })} vs prior`}
            positive
          />
          <KpiCell
            label="Clicks"
            value={formatCount(DEMO_CREATOR_SUMMARY.clicks30d)}
            meta="Meta 61% · YT 29% · Snap 10%"
          />
          <KpiCell
            label="Conversions"
            value={formatCount(DEMO_CREATOR_SUMMARY.conversions30d)}
            meta={`${formatRate(DEMO_CREATOR_SUMMARY.conversions30d, DEMO_CREATOR_SUMMARY.clicks30d)} CR`}
          />
          <KpiCell label="Next payout" value="—" meta="Loading" loading />
        </KpiStrip>
        <KpiStrip>
          <KpiCell label="GMV · Sep" size={32} value={formatINRCompactFromMinor(4_800_000_000)} />
          <KpiCell label="Network fee" size={32} value={formatINRCompactFromMinor(526_000_000)} />
          <KpiCell label="Live offers" size={32} value="128" />
          <KpiCell label="Creators" size={32} value={formatCount(18_406)} />
          <KpiCell label="Flagged conversions" size={32} value={formatCount(1_284)} highlight />
        </KpiStrip>
        <KpiStrip columns={3}>
          <KpiCell label="Available to withdraw" size={48} value={formatINRFromMinor(grossMinor)} extraSpacing="loose">
            <Button variant="primary" arrow onClick={() => setDialogOpen(true)}>
              Withdraw to UPI
            </Button>
          </KpiCell>
          <KpiCell
            label="Pending approval"
            size={48}
            value={formatINRFromMinor(DEMO_CREATOR_SUMMARY.pendingMinor)}
            meta="Clears after the brand's 7-day validation window"
          />
          <KpiCell label="Impressions" size={32} value={formatCountCompact(9_800_000)}>
            <ProgressBar value={100} label="Impressions" />
          </KpiCell>
        </KpiStrip>
      </section>

      <section className={styles.section}>
        <h2>Charts and bars</h2>
        <div className={styles.grid2}>
          <div className={styles.chartCell}>
            <Eyebrow>Daily earnings</Eyebrow>
            <div style={{ height: 16 }} />
            <BarChart
              data={DEMO_DAILY_EARNINGS_PCT}
              max={100}
              highlightLast={DEMO_DAILY_EARNINGS_CURRENT}
              axisLabels={DEMO_DAILY_EARNINGS_AXIS}
              label="Daily earnings, 1–30 Sep; the last three days are the current period"
            />
          </div>
          <div>
            <Eyebrow>By platform</Eyebrow>
            <div style={{ height: 16 }} />
            <div className={styles.stack} style={{ gap: 14 }}>
              {DEMO_EARNINGS_BY_PLATFORM.map((p) => (
                <div key={p.platform}>
                  <div className={styles.platformRow}>
                    <span>{PLATFORM_NAME[p.platform]}</span>
                    <span>{formatINRFromMinor(p.earnedMinor)}</span>
                  </div>
                  <ProgressBar value={p.sharePct} tone={p.tone} label={`${PLATFORM_NAME[p.platform]} share`} />
                </div>
              ))}
              <ProgressBar value={72} height={10} label="Budget used" />
              <ProgressBar value={50} height={12} tone="ink" label="Hyderabad" />
            </div>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Data table</h2>
        <DataTable<DemoTopLink>
          caption="Top links"
          rows={DEMO_TOP_LINKS}
          rowKey={(r) => r.offerId}
          columns={[
            { key: 'offer', header: 'Offer', tone: 'strong', cell: (r) => r.offer },
            { key: 'url', header: 'Link', tone: 'muted', cell: (r) => r.url },
            { key: 'clicks', header: 'Clicks', cell: (r) => formatCount(r.clicks) },
            { key: 'conversions', header: 'Conv.', cell: (r) => formatCount(r.conversions) },
            { key: 'earned', header: 'Earned', cell: (r) => formatINRFromMinor(r.earnedMinor) },
            { key: 'status', header: 'Status', cell: (r) => <StatusTag status={r.status} /> },
          ]}
        />
        <div style={{ height: 24 }} />
        <DataTable<DemoTopLink>
          caption="Empty table"
          rows={[]}
          rowKey={(r) => r.offerId}
          columns={[
            { key: 'offer', header: 'Link' },
            { key: 'clicks', header: 'Clicks', align: 'right' },
          ]}
          empty={<EmptyState title="No links yet." action={{ label: 'Browse offers', href: '/app/offers' }} />}
        />
      </section>

      <section className={styles.section}>
        <h2>Forms</h2>
        <div className={styles.grid2}>
          <Field label="Full name">
            <Input defaultValue={DEMO_CREATOR.name} />
          </Field>
          <Field label="Mobile (OTP)" hint="We send a 6-digit code by SMS.">
            <Input type="tel" inputMode="tel" defaultValue={DEMO_CREATOR.mobileDisplay} />
          </Field>
          <Field
            label="PAN"
            hint={panResult.ok ? `Verified · ${DEMO_CREATOR.panName}` : undefined}
            hintTone="accent"
            error={panResult.ok ? undefined : panResult.message}
          >
            <Input value={pan} onChange={(e) => setPan(e.target.value)} autoCapitalize="characters" />
          </Field>
          <Field label="UPI ID" error={upiResult.ok ? undefined : upiResult.message}>
            <Input value={upi} onChange={(e) => setUpi(e.target.value)} />
          </Field>
          <Field label="Sub-ID" labelSuffix="(optional)" error={subIdResult.ok ? undefined : subIdResult.message}>
            <Input mono value={subId} onChange={(e) => setSubId(e.target.value)} />
          </Field>
          <Field label="GSTIN" labelSuffix="(optional)">
            <Input placeholder="Only if registered" />
          </Field>
          <Field label="Offer">
            <Select
              defaultValue="demo-style"
              options={DEMO_OFFERS.map((o) => ({ value: o.id, label: `${o.name} · ${formatPayout(o.payout)}` }))}
            />
          </Field>
          <Field label="Search" hint="compact input">
            <Input compact placeholder="Search brands, categories" />
          </Field>
          <Field label="Payout method">
            <Segmented
              block
              value={method}
              onChange={setMethod}
              options={[
                { value: 'upi', label: 'UPI' },
                { value: 'bank', label: 'Bank transfer' },
              ]}
            />
          </Field>
          <Field label="Platform">
            <Segmented
              block
              value={platform}
              onChange={setPlatform}
              options={[
                { value: 'meta', label: 'Meta' },
                { value: 'youtube', label: 'YouTube' },
                { value: 'snap', label: 'Snap', disabled: true },
              ]}
            />
          </Field>
          <Field label="Disabled input">
            <Input disabled defaultValue="Read only" />
          </Field>
          <div />
          <Field label="Brief for creators">
            <Textarea defaultValue={'Show the ₹50 cashback on first UPI payment. Mention "new users only".'} />
          </Field>
          <div className={styles.stack}>
            <Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)}>
              I agree to the Creator Terms and ASCI influencer disclosure guidelines.
            </Checkbox>
            <Checkbox defaultChecked={false}>Unchecked</Checkbox>
            <Checkbox disabled>Disabled</Checkbox>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Selectable cards</h2>
        <div style={{ maxWidth: 640 }}>
          <SelectableCardGroup<Role>
            label="Account type"
            value={role}
            onChange={setRole}
            options={[
              { value: 'creator', title: 'Creator / influencer', description: 'Promote offers on your Instagram, YouTube or Snapchat.' },
              { value: 'publisher', title: 'Publisher', description: 'Websites, apps, Telegram channels and deal pages.' },
              { value: 'brand', title: 'Brand / advertiser', description: 'List offers and pay only on conversion.' },
              { value: 'agency', title: 'Agency', description: 'Manage several brands or a roster of creators.' },
            ]}
          />
        </div>
      </section>

      <section className={styles.section}>
        <h2>Dialog, banner, skeleton, empty state</h2>
        <div className={styles.row}>
          <Button variant="primary" arrow onClick={() => setDialogOpen(true)}>
            Open withdraw dialog
          </Button>
          <span className={styles.note} style={{ margin: 0 }}>
            Minimum withdrawal {formatINRWhole(MIN_WITHDRAWAL_RUPEES)} · disclosure line: “{CREATOR_DISCLOSURE_LINE}”
          </span>
        </div>
        <Banner title="Could not load payouts.">The API is unreachable; showing TEST demo data.</Banner>
        <div style={{ height: 12 }} />
        <Banner tone="info">Informational banner.</Banner>
        <div style={{ height: 16 }} />
        <div className={styles.grid3}>
          <div className={styles.stack} style={{ gap: 8 }}>
            <Skeleton height={12} width="40%" />
            <Skeleton height={36} width="70%" />
            <Skeleton height={13} width="50%" />
          </div>
          <EmptyState title="No links yet." action={{ label: 'Browse offers', href: '/app/offers' }}>
            Pick an offer and generate your first tracked link.
          </EmptyState>
          <div className={`${styles.formats}`}>
            <div>{formatINRWhole(184320)} · {formatINRWhole(2500000)}</div>
            <div>{formatINRFromMinor(610, { paise: true })} · {formatINRCompactFromMinor(184_000_000)} · {formatINRCompactFromMinor(62_000_000)}</div>
            <div>{formatCount(312880)} · {formatCountCompact(312880)} · {formatCountCompact(1_200_000)}</div>
            <div>{formatPct(1.9, { decimals: 1 })} · {formatPct(22, { signed: true })}</div>
            <div>{formatDayMonth('2026-09-05', { pad: true })} · {formatDayMonth(DEMO_CREATOR_SUMMARY.nextPayoutDate, { weekday: true })}</div>
          </div>
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setWithdrawn(false);
        }}
        title={withdrawn ? 'Withdrawal requested' : 'Withdraw to UPI'}
        actions={
          withdrawn ? (
            <Button variant="primary" onClick={() => { setDialogOpen(false); setWithdrawn(false); }}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" arrow onClick={() => setWithdrawn(true)}>
                Confirm
              </Button>
            </>
          )
        }
      >
        {withdrawn ? (
          <p>Demo only — nothing was sent. {formatINRFromMinor(grossMinor - tdsMinor)} would go to {DEMO_CREATOR.upiId}.</p>
        ) : (
          <p>
            Amount {formatINRFromMinor(grossMinor)} · TDS {TDS.ratePct}% ({TDS.section}) {formatINRFromMinor(tdsMinor)} · Net{' '}
            {formatINRFromMinor(grossMinor - tdsMinor)}
          </p>
        )}
      </Dialog>
    </div>
  );
}
