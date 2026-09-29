import Link from 'next/link';
import type { Look } from '../lib/mock-data';
import styles from './LookCard.module.css';

interface Props {
  look: Look;
  productCount: number;
}

export default function LookCard({ look, productCount }: Props) {
  const [from, to] = look.gradientSeed;
  return (
    <Link
      href={`/looks/${look.id}`}
      className={styles.card}
      aria-label={`View look: ${look.title}`}
    >
      <div
        className={styles.media}
        style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
        aria-hidden="true"
      >
        {look.sponsored && <span className={styles.sponsored}>Sponsored</span>}
      </div>
      <div className={styles.body}>
        <h2 className={styles.title}>{look.title}</h2>
        <p className={styles.meta}>
          {look.sourcePage} · {productCount}{' '}
          {productCount === 1 ? 'product' : 'products'}
        </p>
      </div>
    </Link>
  );
}
