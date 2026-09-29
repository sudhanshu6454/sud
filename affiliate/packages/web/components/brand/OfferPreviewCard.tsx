/*
 * The creator-facing offer card, as the brand's live preview (3b right
 * column). Same parts and type as the 1d offer cell — category kicker,
 * model tag, "<brand> · <offer>" title, conversion line, payout — plus the
 * allowed platforms, which 1d prints beside the payout. The landing page is
 * never shown: creators only ever share their tracked link.
 */

import { Tag } from '@/components/ui';
import type { OfferModel } from '@/lib/demo/afflino';
import { MODEL_TAG } from './offerModel';
import styles from './OfferPreviewCard.module.css';

export interface OfferPreviewCardProps {
  category: string;
  model: OfferModel;
  /** "Demo PayUPI · Diwali UPI cashback" */
  title: string;
  /** The conversion event, shown as one sentence. */
  description: string;
  /** "₹180 / sign-up", or null while the payout is not set. */
  payout: string | null;
  /** "Meta · YT · Snap", or '' with none chosen. */
  platforms: string;
  className?: string;
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

export function OfferPreviewCard({ category, model, title, description, payout, platforms, className }: OfferPreviewCardProps) {
  const body = sentence(description);
  return (
    <article className={className ? `${styles.card} ${className}` : styles.card} aria-label="Offer preview">
      <div className={styles.head}>
        <span className={styles.kicker}>{category}</span>
        <Tag variant={MODEL_TAG[model]}>{model}</Tag>
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={body ? styles.body : `${styles.body} ${styles.placeholder}`}>
        {body || 'Describe the conversion event.'}
      </p>
      <div className={styles.payRow}>
        <div className={payout ? styles.payout : `${styles.payout} ${styles.placeholder}`}>{payout ?? 'Set a payout'}</div>
        {platforms ? <div className={styles.platforms}>{platforms}</div> : null}
      </div>
    </article>
  );
}
