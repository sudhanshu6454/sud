import type { ReactNode } from 'react';
import { MarketingFooter } from '@/components/shell/MarketingFooter';
import { MarketingNav } from '@/components/shell/MarketingNav';
import styles from './layout.module.css';

/** Public site chrome (1b): skip link, marketing nav, page, footer. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <MarketingNav />
      <main id="main" className={styles.main} tabIndex={-1}>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
