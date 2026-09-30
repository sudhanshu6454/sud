import { CELEBRITY_WEB } from '../../lib/site-copy';
import { cx } from '../ui/cx';
import styles from './StillImage.module.css';

export interface StillImageProps {
  /** The still's address (/img/looks/<id>…), only when the API allowed the image; null → a type-only block. */
  url: string | null;
  seed: [string, string];
  alt: string;
  /** portrait (4:5, cropped from the top: feed cards) or natural (the whole still, never cropped or blown up). */
  frame?: 'portrait' | 'natural';
  loading?: 'lazy' | 'eager';
  /** The moment line (event · place · date) the type-only block shows when there is no image. */
  moment?: string | null;
  className?: string;
}

/**
 * A look's still in grayscale (the handover's rule for photographs), never
 * with type on it. Without an allowed image, a type-only block stands in
 * (the owner's rule: the type-only card): a surface panel of its own height
 * (at most 16:9) with the moment line and "Photo not shown" — never a blank
 * grey box the size of a photograph.
 */
export function StillImage({ url, alt, frame = 'portrait', loading = 'lazy', moment, className }: StillImageProps) {
  if (!url) {
    return (
      <div className={cx(styles.typeOnly, className)} data-no-photo="">
        {moment ? <span className={styles.typeMoment}>{moment}</span> : null}
        <span className={styles.typeNote}>{CELEBRITY_WEB.photoNotShown}</span>
      </div>
    );
  }
  return (
    <div className={cx(styles.box, frame === 'portrait' ? styles.portrait : styles.natural, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the still is served by the site itself (/img/looks/<id>) */}
      <img src={url} alt={alt} className={cx(styles.img, 'grayscale')} loading={loading} decoding="async" />
    </div>
  );
}
