import Link from 'next/link';
import type { LookSummary } from '../lib/types';
import { Cover } from './shop/Cover';
import { productCount, publishedLabel } from './shop/model';
import { Tag } from './ui/Tag';
import styles from './LookCard.module.css';

/**
 * One look as a 1d offer cell: category eyebrow and the Sponsored tag, the
 * cover (grayscale; the gradient placeholder without one), the look title
 * (22px / 800), the source page, then the product count in the payout slot
 * (24px / 800) and a "View the look →" block button. The whole cell opens the
 * look (the button's hit area covers it) with one tab stop.
 */
export default function LookCard({ look, now }: { look: LookSummary; now?: Date }) {
  const published = publishedLabel(look.publishedAt, now);
  return (
    <li className={styles.cell}>
      <div className={styles.head}>
        <span className={styles.kicker}>{look.category ?? 'Look'}</span>
        {look.sponsored ? <Tag variant="accent">Sponsored</Tag> : null}
      </div>
      <Cover look={look} alt="" className={styles.cover} />
      <h2 className={styles.title}>{look.title}</h2>
      <p className={styles.source}>
        {look.sourcePage ? (
          <>
            Spotted on <span className={styles.sourceName}>{look.sourcePage}</span>
          </>
        ) : (
          'Source page not recorded'
        )}
      </p>
      <div className={styles.countRow}>
        <div>
          <div className={styles.countLabel}>In this look</div>
          <div className={styles.countValue}>{productCount(look.itemCount)}</div>
        </div>
        {published ? <div className={styles.meta}>{published}</div> : null}
      </div>
      <Link href={`/looks/${encodeURIComponent(look.id)}`} className={styles.cta}>
        <span>
          View the look<span className="sr-only">: {look.title}</span>
          <span aria-hidden="true"> →</span>
        </span>
      </Link>
    </li>
  );
}
