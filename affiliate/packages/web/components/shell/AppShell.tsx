'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import DemoBadge from '../DemoBadge';
import { Mark, Wordmark } from '../ui/Logo';
import { cx } from '../ui/cx';
import { activeNavIndex, type NavItem } from './nav';
import { useLocationHash } from './useLocationHash';
import styles from './AppShell.module.css';

export interface ShellAccount {
  /** "Demo Priya Nair" */
  name: string;
  /** "Creator · 1.2M followers" */
  meta: string;
  /**
   * The account is TEST demo data (no sign-in yet): the sidebar footer shows
   * <DemoBadge variant="mock" />, the phone account box's name says so, and
   * on phones the workspace switcher (which prints demo names) carries the
   * badge too.
   */
  demo?: boolean;
}

export interface AppShellProps {
  /** Sidebar items, in order. Give the section root match: 'exact'. */
  nav: ReadonlyArray<NavItem>;
  /** Phone bottom tabs (≤760px), 3–5 items. */
  tabs: ReadonlyArray<NavItem>;
  account: ShellAccount;
  /** Where the logo goes (the section root). */
  homeHref: string;
  /**
   * Where the phone top bar's account box goes. Omit it for an area with no
   * settings screen (the agency): the box is then shown, not linked.
   */
  settingsHref?: string;
  /** Accessible name of the sidebar nav, e.g. "Creator". */
  navLabel: string;
  /** Optional slot under the logo row (the agency's workspace switcher). */
  switcher?: ReactNode;
  /**
   * Exact paths whose phone layout draws no top bar (3f: Offers and Payouts
   * put their title straight under the status bar). The account box is then
   * reached from the pages that keep the bar (Home, 1e).
   */
  phoneTopbarHiddenOn?: ReadonlyArray<string>;
  children: ReactNode;
}

/**
 * The signed-in app frame for /app, /brand and /agency: 220px sidebar on
 * desktop, top bar + bottom tab bar on phones. The active item follows the
 * route (usePathname; #fragment items follow the hash).
 */
export function AppShell({
  nav,
  tabs,
  account,
  homeHref,
  settingsHref,
  navLabel,
  switcher,
  phoneTopbarHiddenOn,
  children,
}: AppShellProps) {
  const pathname = usePathname() ?? '/';
  const [hash, setHash] = useLocationHash();

  // A route change drops whatever fragment the previous page had.
  useEffect(() => {
    setHash(window.location.hash);
  }, [pathname, setHash]);

  const activeNav = activeNavIndex(nav, pathname, hash);
  const activeTab = activeNavIndex(tabs, pathname, hash);

  const accountLabel = account.demo ? `${account.name} (demo account)` : account.name;
  const topbarHidden = phoneTopbarHiddenOn?.includes(pathname) ?? false;

  const onNavigate = (href: string) => {
    const i = href.indexOf('#');
    setHash(i < 0 ? '' : href.slice(i));
  };

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>

      <aside className={styles.sidebar}>
        <Link href={homeHref} className={styles.logoRow} aria-label="afflino — home">
          <Mark size={24} />
          <Wordmark size={18} />
        </Link>
        {switcher}
        <nav className={styles.nav} aria-label={navLabel}>
          {nav.map((item, i) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(styles.item, i === activeNav && styles.active)}
              aria-current={i === activeNav ? 'page' : undefined}
              onClick={() => onNavigate(item.href)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.footer}>
          <div className={styles.accountName}>{account.name}</div>
          <div className={styles.accountMeta}>{account.meta}</div>
          {account.demo ? <DemoBadge variant="mock" className={styles.footerBadge} /> : null}
        </div>
      </aside>

      <div className={cx(styles.topbar, topbarHidden && styles.topbarHidden)}>
        <Link href={homeHref} className={styles.topbarLogo} aria-label="afflino — home">
          <Wordmark size={18} />
        </Link>
        {settingsHref ? (
          <Link href={settingsHref} className={styles.avatar} aria-label={`${accountLabel} — settings`} />
        ) : (
          <span className={styles.avatar} role="img" aria-label={accountLabel} />
        )}
      </div>
      {switcher ? (
        <div className={styles.mobileSwitcher}>
          {switcher}
          {account.demo ? (
            <div className={styles.mobileBadgeRow}>
              <DemoBadge variant="mock" className={styles.mobileBadge} />
            </div>
          ) : null}
        </div>
      ) : null}

      <main id="main" data-shell-main className={styles.main} tabIndex={-1}>
        {children}
      </main>

      <nav
        className={styles.tabbar}
        aria-label={`${navLabel} tabs`}
        style={{ '--tab-count': tabs.length } as CSSProperties}
      >
        {tabs.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            className={cx(styles.tab, i === activeTab && styles.tabActive)}
            aria-current={i === activeTab ? 'page' : undefined}
            onClick={() => onNavigate(item.href)}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
