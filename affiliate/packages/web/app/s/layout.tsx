import type { ReactNode } from 'react';
import Link from 'next/link';
import { MarketingFooter } from '@/components/shell/MarketingFooter';
import { Lockup } from '@/components/ui';
import styles from './layout.module.css';

/**
 * A storefront (/s/<slug>): the link-in-bio page of an in-house page. Short
 * and fast on a phone: a slim bar (the Afflino lockup, "Spotted"), the page,
 * the footer (legal links; Amazon's Associate statement when
 * AMAZON_ASSOCIATE is on). No marketing navigation, no shop tabs.
 */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <header className={styles.bar}>
        <Link href="/shop" className={styles.brand} aria-label="Afflino: Spotted">
          <Lockup markSize={22} />
        </Link>
        <Link href="/shop" className={styles.spotted}>
          Spotted<span aria-hidden="true">{'\u00a0'}→</span>
        </Link>
      </header>
      <main id="main" className={styles.main} tabIndex={-1}>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
