'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '../ui/cx';
import { useSavedCount } from './savedEvents';
import styles from './ShopNav.module.css';

const TABS = [
  { href: '/shop', label: 'Shop the looks', match: (p: string) => p === '/shop' || p.startsWith('/looks/') },
  { href: '/saved', label: 'Saved', match: (p: string) => p === '/saved' },
] as const;

/**
 * The shop's own tab row under the marketing nav, drawn like the 3b step
 * tabs: ruled cells, the active one in accent-700 with a 4px accent bottom
 * rule. "Saved" carries the wishlist count once it is read in the browser.
 */
export function ShopNav() {
  const pathname = usePathname() ?? '';
  const savedCount = useSavedCount();

  return (
    <nav className={styles.bar} aria-label="Shop">
      {TABS.map((tab) => {
        const active = tab.match(pathname);
        const suffix = tab.href === '/saved' && savedCount !== null && savedCount > 0 ? ` · ${savedCount}` : '';
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cx(styles.tab, active && styles.active)}
            aria-current={active ? 'page' : undefined}
          >
            {/* data-label reserves the bold width, so tabs never shift between pages */}
            <span className={styles.label} data-label={`${tab.label}${suffix}`}>
              <span>
                {tab.label}
                {suffix ? (
                  <>
                    {suffix}
                    <span className="sr-only"> saved {savedCount === 1 ? 'product' : 'products'}</span>
                  </>
                ) : null}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
