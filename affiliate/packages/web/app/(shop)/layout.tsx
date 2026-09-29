import type { ReactNode } from 'react';
import { MarketingFooter } from '@/components/shell/MarketingFooter';
import { MarketingNav } from '@/components/shell/MarketingNav';
import { ShopNav } from '@/components/shop/ShopNav';
import styles from './layout.module.css';

/**
 * The fleet's consumer shop (/shop, /looks/*, /saved) in the Afflino chrome:
 * skip link, marketing nav, the shop's tab row, the page (full width, on the
 * 40px marketing gutters), then the footer. The affiliate disclosure is
 * part of each page: the standing line under the grid and the wishlist
 * (DisclosureLine), the surface panel next to the products on look and item
 * pages (Disclosure).
 */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <MarketingNav />
      <ShopNav />
      <main id="main" className={styles.main} tabIndex={-1}>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
