import type { LookSummary } from '../../lib/types';
import { cx } from '../ui/cx';
import styles from './Cover.module.css';

export interface CoverProps {
  look: Pick<LookSummary, 'coverUrl' | 'gradientSeed'>;
  /** Alt text for the photograph; "" when the title right next to it already names it (the grid). */
  alt: string;
  /**
   * frame (default): a fixed 4:3 frame, the photo cropped to fill it (the
   * grid cells). natural: the whole photo at its own aspect, never cropped or
   * blown up (look and item pages), letterboxed on the surface fill. The
   * placeholder is always the 4:3 frame.
   */
  fit?: 'frame' | 'natural';
  loading?: 'lazy' | 'eager';
  className?: string;
}

/**
 * A look's cover. Photographs render in grayscale (handover: "Photographs,
 * if added later, render in grayscale"); no type is ever set on the image, so
 * nothing can sit on a face. Without a cover the look's seeded gradient
 * placeholder stands in, desaturated and lifted onto the surface fill so it
 * reads as a tone of the system rather than a colour.
 */
export function Cover({ look, alt, fit = 'frame', loading = 'lazy', className }: CoverProps) {
  const [from, to] = look.gradientSeed;
  if (!look.coverUrl) {
    return (
      <div className={cx(styles.cover, styles.frame, className)} aria-hidden="true">
        <span className={styles.placeholder} style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }} />
      </div>
    );
  }
  return (
    <div className={cx(styles.cover, fit === 'frame' ? styles.frame : styles.natural, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote hosts vary per deployment */}
      <img src={look.coverUrl} alt={alt} className={cx(styles.img, 'grayscale')} loading={loading} decoding="async" />
    </div>
  );
}
