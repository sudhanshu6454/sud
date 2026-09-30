import { CELEBRITY_WEB } from '../../lib/site-copy';
import type { SpottedCard as Card } from '../../lib/spotted';
import { SpottedCard } from './SpottedCard';
import styles from './TrendingRow.module.css';

/**
 * The trending row: public looks ranked by clicks over the last 7 IST days
 * (the API ranks them from the hourly rollups and returns no counts). One
 * row of compact cells that scrolls sideways on phones (scroll-snap); hidden
 * while there is nothing to rank.
 */
export function TrendingRow({ looks }: { looks: ReadonlyArray<Card> }) {
  if (looks.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="trending-title">
      <h2 id="trending-title" className={styles.title}>
        {CELEBRITY_WEB.trendingTitle}
      </h2>
      <div className={styles.scroller}>
        <ol className={styles.row}>
          {looks.map((l, i) => (
            <SpottedCard key={l.id} look={l} compact rank={i + 1} className={styles.cell} />
          ))}
        </ol>
      </div>
    </section>
  );
}
