import Link from 'next/link';
import { siteName } from '../../lib/site';
import styles from './MarketingFooter.module.css';

/** "© 2026 Afflino · Made in India" · Terms · Privacy · Contact (1b). */
export function MarketingFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <span>
        © {year} {siteName()} · Made in India
      </span>
      <nav aria-label="Legal">
        <Link href="/terms" className={styles.link}>
          Terms
        </Link>
        {' · '}
        <Link href="/privacy" className={styles.link}>
          Privacy
        </Link>
        {' · '}
        <Link href="/contact" className={styles.link}>
          Contact
        </Link>
      </nav>
    </footer>
  );
}
