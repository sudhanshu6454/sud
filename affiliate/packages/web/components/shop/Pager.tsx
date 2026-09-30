import Link from 'next/link';
import styles from './Pager.module.css';

/** Previous / next page links under a feed (plain links: the feed is server-rendered). */
export function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav className={styles.pager} aria-label="Pages">
      {page > 1 ? (
        <Link href={href(page - 1)} className={styles.link} rel="prev">
          <span aria-hidden="true">←{'\u00a0'}</span>Newer
        </Link>
      ) : (
        <span />
      )}
      <span className={styles.count}>
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={styles.link} rel="next">
          Older<span aria-hidden="true">{'\u00a0'}→</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
