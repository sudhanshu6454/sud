import Link from 'next/link';
import { CELEBRITY_WEB } from '../../lib/site-copy';
import { momentLine, pieceCount, platformLabel, type SpottedCard as Card } from '../../lib/spotted';
import { cx } from '../ui/cx';
import { StillImage } from './StillImage';
import styles from './SpottedCard.module.css';

export interface SpottedCardProps {
  look: Card;
  /** h2 on a page whose sections have no heading of their own, h3 under a section heading (default). */
  headingLevel?: 'h2' | 'h3';
  /** Heading level aside, the compact variant of the trending row. */
  compact?: boolean;
  /** 1-based rank, shown in the trending row. */
  rank?: number;
  /** Leave out "Posted on <page>" (a storefront's own cards: the page you are on). */
  hideSource?: boolean;
  /** On phones, a compact cell for a two-column grid: the still, the headline and "View the look" (a storefront). */
  phoneCompact?: boolean;
  className?: string;
}

/**
 * One celebrity look in a feed, as a ruled cell: the moment (event · place ·
 * day), the still only when the API allowed it (else the placeholder; never
 * type on the image), the headline the API composed, the non-endorsement
 * line right under it (the only place a card names the celebrity: the
 * headline never does), the page it was posted on, the piece count and
 * "View the look →". The card carries no product, no price and no merchant
 * link. Without an allowed image a type-only block stands in ("Photo not
 * shown"). A phone-compact cell shows only the still, the headline and the
 * link (no name at all, so no line is needed).
 */
export function SpottedCard({ look, headingLevel = 'h3', compact = false, rank, hideSource = false, phoneCompact = false, className }: SpottedCardProps) {
  const Heading = headingLevel;
  const moment = momentLine(look.moment);
  const platform = platformLabel(look.platform);
  return (
    <li className={cx(styles.cell, compact && styles.compact, phoneCompact && styles.phoneCompact, className)}>
      <div className={styles.head}>
        {rank !== undefined ? <span className={styles.rank}>{String(rank).padStart(2, '0')}</span> : null}
        <span className={styles.kicker}>{moment || 'Spotted'}</span>
      </div>
      <StillImage url={look.imageUrl} seed={look.gradientSeed} alt="" frame="portrait" className={styles.still} />
      <Heading className={styles.title}>{look.headline}</Heading>
      <p className={styles.line} data-non-endorsement="">
        {look.nonEndorsement}
      </p>
      {!compact && !hideSource ? (
        <p className={styles.source}>
          {look.storefront ? (
            <>
              {CELEBRITY_WEB.fromPage}{' '}
              <Link href={`/s/${look.storefront.slug}`} className={styles.sourceLink}>
                {look.storefront.name}
              </Link>
            </>
          ) : platform ? (
            `${CELEBRITY_WEB.fromPage} our ${platform} page`
          ) : null}
        </p>
      ) : null}
      <div className={styles.countRow}>
        <span className={styles.count}>{pieceCount(look.pieces)}</span>
        {!look.shoppable ? <span className={styles.meta}>No products shown</span> : null}
      </div>
      <Link href={`/looks/${encodeURIComponent(look.id)}`} className={styles.cta}>
        <span>
          {CELEBRITY_WEB.viewLook}
          <span className="sr-only">: {look.headline}</span>
          <span aria-hidden="true"> →</span>
        </span>
      </Link>
    </li>
  );
}
