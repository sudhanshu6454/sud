import Link from 'next/link';
import styles from './BackBar.module.css';

/**
 * Phone-only (≤760px) back row, as 1e draws it ("← Offers" · "Get link"):
 * 14px, 16px 20px over a 2px rule, the back link with a 44px hit area.
 * Desktop pages carry the same link in their header eyebrow.
 */
export function BackBar({ href, label, title }: { href: string; label: string; title?: string }) {
  return (
    <div className={styles.bar}>
      <Link href={href} className={styles.back}>
        <span aria-hidden="true">← </span>
        {label}
      </Link>
      {title ? (
        <span className={styles.title} aria-hidden="true">
          {title}
        </span>
      ) : null}
    </div>
  );
}
