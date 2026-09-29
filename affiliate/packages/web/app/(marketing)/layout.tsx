import type { ReactNode } from 'react';
import { MarketingFooter } from '@/components/shell/MarketingFooter';
import { MarketingNav } from '@/components/shell/MarketingNav';
import styles from './layout.module.css';

/** Public site chrome (1b): marketing nav, page, footer. */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <MarketingNav />
      <main id="main" className={styles.main}>
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
