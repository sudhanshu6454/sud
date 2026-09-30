import type { CelebrityLook } from '../../lib/spotted';
import { cx } from '../ui/cx';
import styles from './StillWithHotspots.module.css';

/**
 * The look's still (only when the API allowed the image), whole and in
 * grayscale, with numbered markers for the pieces the editors placed on the
 * garments: each marker is only a number linking to its piece below; no
 * label, no product image and no Amazon content ever sits on the still (the
 * brief's B5, Amazon PR 11). Without an image, nothing is drawn here.
 */
export function StillWithHotspots({ look, className }: { look: CelebrityLook; className?: string }) {
  if (!look.image) return null;
  const numbered = look.pieces.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => p.hotspot !== null);
  return (
    <figure className={cx(styles.figure, className)}>
      <div className={styles.frame}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote hosts vary per deployment */}
        <img src={look.image.url} alt={look.headline} className={cx(styles.img, 'grayscale')} loading="eager" decoding="async" />
        {numbered.map(({ p, n }) => (
          <a
            key={p.id}
            href={`#piece-${p.id}`}
            className={styles.marker}
            style={{ left: `${(p.hotspot?.x ?? 0) * 100}%`, top: `${(p.hotspot?.y ?? 0) * 100}%` }}
            aria-label={`${n}: ${p.label}`}
          >
            {n}
          </a>
        ))}
      </div>
      {look.image.credit ? <figcaption className={styles.credit}>Photo: {look.image.credit}</figcaption> : null}
    </figure>
  );
}
