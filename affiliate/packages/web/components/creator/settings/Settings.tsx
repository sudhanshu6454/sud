'use client';

/*
 * Creator Settings & profile — 2d. A 200px sub-nav (Profile, Connected
 * platforms, Payout & tax, Notifications, Security) beside one form whose
 * sections the sub-nav jumps to; the active item follows the scroll. 2d
 * draws Profile and Connected platforms; the other three sections use the
 * same field and row styles (Payout & tax follows 3a's step 3). Phones: the
 * sub-nav is a sticky horizontal scroller and the fields stack.
 *
 * No v1 endpoint stores any of this, so it is TEST demo data
 * (<DemoBadge variant="mock" />): "Save changes" keeps the form in this
 * browser (localStorage) and says so; platform connect / disconnect are demo
 * toggles; nothing verifies a PAN, UPI ID or GSTIN.
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DemoPanHint } from '@/components/DemoPanHint';
import DemoBadge from '@/components/DemoBadge';
import { Banner, Button, Checkbox, Eyebrow, Field, Input, Segmented, cx } from '@/components/ui';
import { DEMO_CREATOR, PLATFORM_NAME } from '@/lib/demo/afflino';
import { DEMO_NOTIFICATION_PREFS } from '@/lib/demo/payouts';
import { formatINRFromMinor } from '@/lib/format';
import { MIN_WITHDRAWAL_RUPEES, TDS } from '@/lib/site-copy';
import {
  SETTINGS_FIELD_ORDER,
  SETTINGS_PLATFORMS,
  defaultSettings,
  loadSettings,
  payoutMethodSummary,
  platformDetail,
  saveSettings,
  settingsEqual,
  validateSettings,
  type CreatorSettings,
  type PayoutMethod,
  type SettingsField,
  type SettingsPlatform,
} from './model';
import styles from './Settings.module.css';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'platforms', label: 'Connected platforms' },
  { id: 'payout', label: 'Payout & tax' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'security', label: 'Security' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

const METHOD_OPTIONS: ReadonlyArray<{ value: PayoutMethod; label: string }> = [
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
];

/** How far below the viewport top a section counts as "current" (the phone scroller sits there). */
const SPY_OFFSET = 96;

const fieldId = (field: SettingsField) => `settings-${field}`;

function isSectionId(value: string): value is SectionId {
  return SECTIONS.some((s) => s.id === value);
}

export function Settings() {
  const [saved, setSaved] = useState<CreatorSettings>(defaultSettings);
  const [draft, setDraft] = useState<CreatorSettings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<SettingsField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [active, setActive] = useState<SectionId>('profile');
  const [stuck, setStuck] = useState(false);
  const footerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement>(null);
  const jumpedAt = useRef(0);

  // Load what this browser saved (the demo defaults otherwise).
  useEffect(() => {
    const stored = loadSettings();
    setSaved(stored);
    setDraft(stored);
    setHydrated(true);
  }, []);

  // Arriving at /app/settings#payout (Payouts → "Change method"): jump once the saved form is in.
  useEffect(() => {
    if (!hydrated) return;
    const hash = window.location.hash.slice(1);
    if (isSectionId(hash)) {
      setActive(hash);
      jumpedAt.current = performance.now();
      document.getElementById(hash)?.scrollIntoView({ block: 'start' });
    }
  }, [hydrated]);

  // Scroll-spy for the sub-nav, and the sticky footer's rule while it floats.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const footer = footerRef.current;
      const sentinel = sentinelRef.current;
      if (footer && sentinel) {
        setStuck(sentinel.getBoundingClientRect().top > footer.getBoundingClientRect().bottom + 1);
      }
      if (performance.now() - jumpedAt.current < 150) return; // the jump a sub-nav click just made
      // Scrolled to the end of a page that scrolls: the last section, even when it is too short to reach the top.
      const atBottom =
        window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current: SectionId = 'profile';
      for (const section of SECTIONS) {
        const el = document.getElementById(section.id);
        if (el && el.getBoundingClientRect().top <= SPY_OFFSET) current = section.id;
      }
      setActive(atBottom ? 'security' : current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Phones: keep the active sub-nav item in the horizontal scroller's view.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const item = scroller?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!scroller || !item || scroller.scrollWidth <= scroller.clientWidth) return;
    const left = item.offsetLeft;
    const right = left + item.offsetWidth;
    if (left < scroller.scrollLeft || right > scroller.scrollLeft + scroller.clientWidth) {
      scroller.scrollLeft = Math.max(left - 20, 0);
    }
  }, [active]);

  const validation = validateSettings(draft);
  const dirty = !settingsEqual(draft, saved);

  // The footer starts or stops floating with the dirty state: re-measure.
  useEffect(() => {
    const footer = footerRef.current;
    const sentinel = sentinelRef.current;
    if (footer && sentinel) setStuck(sentinel.getBoundingClientRect().top > footer.getBoundingClientRect().bottom + 1);
  }, [dirty]);
  const errorFor = (field: SettingsField) => (submitted || touched[field] ? validation.errors[field] : undefined);
  const touch = (field: SettingsField) => () => setTouched((t) => (t[field] ? t : { ...t, [field]: true }));

  const setProfile = (key: keyof CreatorSettings['profile']) => (value: string) =>
    setDraft((d) => ({ ...d, profile: { ...d.profile, [key]: value } }));
  const setPayout = <K extends keyof CreatorSettings['payout']>(key: K, value: CreatorSettings['payout'][K]) =>
    setDraft((d) => ({ ...d, payout: { ...d.payout, [key]: value } }));

  const togglePlatform = (platform: SettingsPlatform) => {
    const next = !draft.platforms[platform];
    setDraft((d) => ({ ...d, platforms: { ...d.platforms, [platform]: next } }));
    setAnnouncement(
      `${PLATFORM_NAME[platform]} marked ${next ? 'connected' : 'disconnected'} (demo: nothing is linked). Save changes to keep it.`,
    );
  };

  const onCancel = () => {
    setDraft(saved);
    setTouched({});
    setSubmitted(false);
    setAnnouncement(dirty ? 'Changes discarded.' : 'Nothing to discard.');
  };

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    if (!dirty) return;
    setSubmitted(true);
    if (!validation.ok) {
      const first = SETTINGS_FIELD_ORDER.find((f) => validation.errors[f]);
      const count = Object.keys(validation.errors).length;
      setAnnouncement(`Not saved: ${count} field${count === 1 ? '' : 's'} to fix.`);
      if (first) document.getElementById(fieldId(first))?.focus();
      return;
    }
    const ok = saveSettings(validation.normalized);
    setStorageFailed(!ok);
    if (!ok) {
      setAnnouncement('Not saved: this browser blocked local storage.');
      return;
    }
    setSaved(validation.normalized);
    setDraft(validation.normalized);
    setTouched({});
    setSubmitted(false);
    setAnnouncement('Changes saved in this browser. Demo: nothing was sent to Afflino.');
  };

  const onNav = useCallback((id: SectionId) => {
    jumpedAt.current = performance.now();
    setActive(id);
  }, []);

  const method = payoutMethodSummary(draft);
  const panHint: ReactNode = method.panDemoVerified ? (
    <DemoPanHint name={DEMO_CREATOR.panName} />
  ) : (
    'Checked against your name by the KYC provider once one is connected; none is yet.'
  );

  return (
    <>
      {storageFailed ? (
        <Banner title="Not saved.">This browser blocked local storage, so the changes could not be kept.</Banner>
      ) : null}

      <div className={styles.layout}>
        <div className={styles.navCol}>
          <nav ref={scrollerRef} className={styles.subnav} aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                data-section={s.id}
                className={cx(styles.item, active === s.id && styles.active)}
                aria-current={active === s.id ? 'location' : undefined}
                onClick={() => onNav(s.id)}
              >
                {s.label}
              </a>
            ))}
          </nav>
          <div className={styles.navBadge}>
            <DemoBadge variant="mock" className={styles.badge} />
          </div>
        </div>

        <form className={styles.content} onSubmit={onSave} noValidate aria-label="Settings">
          <h1 className="sr-only">Settings &amp; profile</h1>
          <div className={styles.phoneBadge}>
            <DemoBadge variant="mock" className={styles.badge} />
          </div>

          <section id="profile" className={cx(styles.section, styles.profile)} aria-labelledby="settings-profile-title">
            <h2 id="settings-profile-title" className="sr-only">
              Profile
            </h2>
            <div className={styles.grid}>
              <Field label="Display name" id={fieldId('displayName')} error={errorFor('displayName')}>
                <Input
                  value={draft.profile.displayName}
                  onChange={(e) => setProfile('displayName')(e.target.value)}
                  onBlur={touch('displayName')}
                  autoComplete="name"
                  maxLength={80}
                />
              </Field>
              <Field label="Handle" id={fieldId('handle')} error={errorFor('handle')}>
                <Input
                  value={draft.profile.handle}
                  onChange={(e) => setProfile('handle')(e.target.value)}
                  onBlur={touch('handle')}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={40}
                />
              </Field>
              <Field label="Language" id={fieldId('language')} error={errorFor('language')}>
                <Input
                  value={draft.profile.language}
                  onChange={(e) => setProfile('language')(e.target.value)}
                  onBlur={touch('language')}
                  maxLength={100}
                />
              </Field>
              <Field label="Niche" id={fieldId('niche')} error={errorFor('niche')}>
                <Input
                  value={draft.profile.niche}
                  onChange={(e) => setProfile('niche')(e.target.value)}
                  onBlur={touch('niche')}
                  maxLength={100}
                />
              </Field>
            </div>
          </section>

          <section id="platforms" className={styles.section} aria-labelledby="settings-platforms-title">
            <Eyebrow as="h2" id="settings-platforms-title" className={styles.sectionLabel}>
              Connected platforms
            </Eyebrow>
            <ul className={styles.rows}>
              {SETTINGS_PLATFORMS.map((platform) => {
                const connected = draft.platforms[platform];
                const name = PLATFORM_NAME[platform];
                return (
                  <li key={platform} className={styles.row}>
                    <div className={styles.rowText}>
                      <div className={styles.rowName}>{name}</div>
                      <div className={styles.rowDetail}>{platformDetail(platform, connected)}</div>
                    </div>
                    <Button
                      variant={connected ? 'ghost' : 'primary'}
                      size="sm"
                      className={styles.rowAction}
                      aria-label={`${connected ? 'Disconnect' : 'Connect'} ${name}`}
                      onClick={() => togglePlatform(platform)}
                    >
                      {connected ? 'Disconnect' : 'Connect'}
                    </Button>
                  </li>
                );
              })}
            </ul>
            <p className={styles.note}>
              Demo toggles: nothing is linked or unlinked. Connecting reads follower count and audience location only,
              once platform sign-in exists.
            </p>
          </section>

          <section id="payout" className={styles.section} aria-labelledby="settings-payout-title">
            <Eyebrow as="h2" id="settings-payout-title" className={styles.sectionLabel}>
              Payout &amp; tax
            </Eyebrow>
            <div className={styles.grid}>
              <Field
                label="PAN"
                id={fieldId('pan')}
                error={errorFor('pan')}
                hint={panHint}
                hintTone={method.panDemoVerified ? 'accent' : 'muted'}
              >
                <Input
                  value={draft.payout.pan}
                  onChange={(e) => setPayout('pan', e.target.value)}
                  onBlur={touch('pan')}
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={10}
                />
              </Field>
              <Field label="GSTIN" labelSuffix="(optional)" id={fieldId('gstin')} error={errorFor('gstin')}>
                <Input
                  value={draft.payout.gstin}
                  placeholder="Only if registered"
                  onChange={(e) => setPayout('gstin', e.target.value)}
                  onBlur={touch('gstin')}
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={15}
                />
              </Field>
              <Field label="Payout method" className={styles.span}>
                <Segmented block options={METHOD_OPTIONS} value={draft.payout.method} onChange={(m) => setPayout('method', m)} />
              </Field>
              {draft.payout.method === 'upi' ? (
                <Field label="UPI ID" id={fieldId('upiId')} error={errorFor('upiId')}>
                  <Input
                    value={draft.payout.upiId}
                    onChange={(e) => setPayout('upiId', e.target.value)}
                    onBlur={touch('upiId')}
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={80}
                  />
                </Field>
              ) : (
                <>
                  <Field label="Account holder" id={fieldId('bankHolder')} error={errorFor('bankHolder')}>
                    <Input
                      value={draft.payout.bankHolder}
                      onChange={(e) => setPayout('bankHolder', e.target.value)}
                      onBlur={touch('bankHolder')}
                      maxLength={80}
                    />
                  </Field>
                  <Field label="Account number" id={fieldId('bankAccount')} error={errorFor('bankAccount')}>
                    <Input
                      value={draft.payout.bankAccount}
                      inputMode="numeric"
                      autoComplete="off"
                      onChange={(e) => setPayout('bankAccount', e.target.value)}
                      onBlur={touch('bankAccount')}
                      maxLength={24}
                    />
                  </Field>
                  <Field label="IFSC" id={fieldId('ifsc')} error={errorFor('ifsc')}>
                    <Input
                      value={draft.payout.ifsc}
                      onChange={(e) => setPayout('ifsc', e.target.value)}
                      onBlur={touch('ifsc')}
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={11}
                    />
                  </Field>
                </>
              )}
            </div>
            <p className={styles.note}>
              TDS {TDS.ratePct}% ({TDS.section}) is deducted from every payout. Withdrawals start at{' '}
              {formatINRFromMinor(MIN_WITHDRAWAL_RUPEES * 100)}. Nothing here is verified yet: PAN, UPI ID and GSTIN
              are checked for shape only.
            </p>
          </section>

          <section id="notifications" className={styles.section} aria-labelledby="settings-notifications-title">
            <Eyebrow as="h2" id="settings-notifications-title" className={styles.sectionLabel}>
              Notifications
            </Eyebrow>
            <ul className={styles.rows}>
              {DEMO_NOTIFICATION_PREFS.map((pref) => (
                <li key={pref.id} className={styles.row}>
                  <Checkbox
                    className={styles.check}
                    checked={draft.notifications[pref.id]}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, notifications: { ...d.notifications, [pref.id]: e.target.checked } }))
                    }
                  >
                    <span className={styles.rowName}>{pref.label}</span>
                    <span className={styles.rowDetail}>{pref.detail}</span>
                  </Checkbox>
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              Email and SMS delivery arrive with sign-in. In this demo nothing is sent.
            </p>
          </section>

          <section id="security" className={cx(styles.section, styles.last)} aria-labelledby="settings-security-title">
            <Eyebrow as="h2" id="settings-security-title" className={styles.sectionLabel}>
              Security
            </Eyebrow>
            <ul className={styles.rows}>
              <li className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowName}>Sign-in</div>
                  <div className={styles.rowDetail}>
                    A development token on this device. Passwords, OTP and two-step verification arrive with the
                    identity provider.
                  </div>
                </div>
                <Link href="/login" className={styles.rowLink}>
                  Sign-in page<span aria-hidden="true">{'\u00a0'}→</span>
                </Link>
              </li>
              <li className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowName}>Sessions and devices</div>
                  <div className={styles.rowDetail}>Nothing to manage until the identity provider is in.</div>
                </div>
              </li>
            </ul>
          </section>

          <div ref={footerRef} className={cx(styles.footer, dirty && styles.floating, dirty && stuck && styles.stuck)}>
            {dirty ? <span className={styles.unsaved}>Unsaved changes</span> : null}
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!dirty}>
              Save changes
            </Button>
          </div>
          <div ref={sentinelRef} aria-hidden="true" />
        </form>
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}
