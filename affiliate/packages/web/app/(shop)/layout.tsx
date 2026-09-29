import Link from 'next/link';
import type { ReactNode } from 'react';
import { MarketingFooter } from '@/components/shell/MarketingFooter';
import { MarketingNav } from '@/components/shell/MarketingNav';
import styles from './layout.module.css';

/**
 * The fleet's consumer shop (/shop, /looks/*, /saved): marketing nav, the
 * shop's own links, the page in the 640px mobile-first column it was built
 * for, then the affiliate disclosure line and the footer.
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <MarketingNav />
      <nav className={styles.subnav} aria-label="Shop">
        <Link href="/shop" className={styles.subLink}>
          Shop the looks
        </Link>
        <Link href="/saved" className={styles.subLink}>
          Saved
        </Link>
      </nav>
      <main id="main" className={styles.main}>
        {children}
      </main>
      <p className={styles.disclosure}>
        Affiliate disclosure: we may earn a commission when you shop via these links, at no extra cost to you.
      </p>
      <MarketingFooter />
    </div>
  );
}
