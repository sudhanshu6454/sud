'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Mark } from '../ui/Logo';
import { cx } from '../ui/cx';
import { activeNavIndex, type NavItem } from './nav';
import styles from './AdminShell.module.css';

/** Admin console tabs (2e), then the platform's live ops pages. */
export const ADMIN_TABS: ReadonlyArray<NavItem> = [
  { label: 'Queue', href: '/admin', match: 'exact' },
  { label: 'Brands', href: '/admin/brands' },
  { label: 'Creators', href: '/admin/creators' },
  { label: 'Offers', href: '/admin/offers' },
  { label: 'Fraud', href: '/admin/fraud' },
  { label: 'Settlements', href: '/admin/settlements' },
  { label: 'Suspense', href: '/admin/suspense' },
  { label: 'Looks', href: '/admin/looks' },
];

export interface AdminShellProps {
  tabs?: ReadonlyArray<NavItem>;
  children: ReactNode;
}

export function AdminShell({ tabs = ADMIN_TABS, children }: AdminShellProps) {
  const pathname = usePathname() ?? '/admin';
  const active = activeNavIndex(tabs, pathname);
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
        <nav className={styles.tabs} aria-label="Admin">
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
      <main id="main" data-shell-main className={styles.main} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
