import Link from 'next/link';
import type { LookSummary } from '../lib/types';
import styles from './LookCard.module.css';

export default function LookCard({ look }: { look: LookSummary }) {
  const [from, to] = look.gradientSeed;
  const count = look.itemCount;
  return (
    <Link href={`/looks/${encodeURIComponent(look.id)}`} className={styles.card} aria-label={`View look: ${look.title}`}>
      <div className={styles.media} style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
        {look.coverUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- remote hosts vary per deployment */
          <img src={look.coverUrl} alt={look.title} className={styles.cover} loading="lazy" />
        ) : null}
        {look.sponsored && <span className={styles.sponsored}>Sponsored</span>}
      </div>
      <div className={styles.body}>
        <h2 className={styles.title}>{look.title}</h2>
        <p className={styles.meta}>
          {look.sourcePage ? `${look.sourcePage} · ` : ''}
          {count} {count === 1 ? 'product' : 'products'}
        </p>
      </div>
    </Link>
  );
}
