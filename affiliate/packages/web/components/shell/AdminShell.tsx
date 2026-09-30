'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Mark } from '../ui/Logo';
import { cx } from '../ui/cx';
import { activeNavIndex, type NavItem } from './nav';
import styles from './AdminShell.module.css';

/** The celebrity-look screens: one admin tab, with this sub-nav under the bar (Takedowns second: its 3-hour clock). */
export const CELEBRITY_TABS: ReadonlyArray<NavItem> = [
  { label: 'Looks', href: '/admin/looks' },
  { label: 'Takedowns', href: '/admin/takedowns' },
  { label: 'Celebrities', href: '/admin/celebrities' },
  { label: 'Library', href: '/admin/library' },
  { label: 'Instant links', href: '/admin/instant-links' },
  { label: 'Comment replies', href: '/admin/replies' },
  { label: 'Analytics', href: '/admin/analytics' },
];

/** Admin console tabs (2e), then the platform's live ops pages, then one tab for the celebrity-look screens. */
export const ADMIN_TABS: ReadonlyArray<NavItem> = [
  { label: 'Queue', href: '/admin', match: 'exact' },
  { label: 'Brands', href: '/admin/brands' },
  { label: 'Creators', href: '/admin/creators' },
  { label: 'Offers', href: '/admin/offers' },
  { label: 'Fraud', href: '/admin/fraud' },
  { label: 'Settlements', href: '/admin/settlements' },
  { label: 'Suspense', href: '/admin/suspense' },
  { label: 'Celebrity looks', href: '/admin/looks', also: CELEBRITY_TABS.map((t) => t.href) },
];

export interface AdminShellProps {
  tabs?: ReadonlyArray<NavItem>;
  children: ReactNode;
}

/**
 * The tab strip scrolls sideways when the tabs do not fit (phones, and
 * 761–900px): the active tab is scrolled into view on every route, and an
 * edge fades out on each side that has more tabs, so the strip never hides
 * where you are or that more exists (the scrollbar itself is hidden).
 */
export function AdminShell({ tabs = ADMIN_TABS, children }: AdminShellProps) {
  const pathname = usePathname() ?? '/admin';
  const active = activeNavIndex(tabs, pathname);
  const sub = activeNavIndex(CELEBRITY_TABS, pathname);
  const tabsRef = useRef<HTMLElement>(null);
  const [more, setMore] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });

  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const update = () => {
      const max = strip.scrollWidth - strip.clientWidth;
      setMore({ start: strip.scrollLeft > 1, end: strip.scrollLeft < max - 1 });
    };
    // Centre the active tab inside the strip (never scrolls the page itself).
    const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && strip.scrollWidth > strip.clientWidth) {
      const left = current.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
      const target = left - (strip.clientWidth - current.offsetWidth) / 2;
      strip.scrollLeft = Math.max(0, Math.min(target, strip.scrollWidth - strip.clientWidth));
    }
    update();
    strip.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      strip.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [pathname]);

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.bar}>
        <Link href="/admin" className={styles.brand}>
          <Mark size={22} />
          <span className={styles.brandName}>afflino admin</span>
        </Link>
        <nav
          ref={tabsRef}
          className={cx(styles.tabs, more.start && styles.moreStart, more.end && styles.moreEnd)}
          aria-label="Admin"
        >
          {tabs.map((tab, i) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={cx(styles.tab, i === active && styles.active)}
              aria-current={i === active ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>
      {sub >= 0 ? (
        <nav className={styles.subnav} aria-label="Celebrity looks">
          {CELEBRITY_TABS.map((tab, i) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={cx(styles.subtab, i === sub && styles.subActive)}
              aria-current={i === sub ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <main id="main" data-shell-main className={styles.main} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
