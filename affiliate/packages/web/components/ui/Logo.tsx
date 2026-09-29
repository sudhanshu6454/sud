import type { CSSProperties } from 'react';
import { cx } from './cx';
import styles from './Logo.module.css';

export type MarkVariant = 'accent' | 'ink' | 'glyph';

export interface MarkProps {
  /** Rendered size in px (square). Minimum 24 per the brand sheet; default 24. */
  size?: number;
  /** accent square (default), ink square (mono use), glyph = ground-coloured artwork with no square, for red fields. */
  variant?: MarkVariant;
  /** Accessible name; omit when the mark sits next to the wordmark (it is then decorative). */
  title?: string;
  className?: string;
}

/**
 * The mark on its 72-unit grid: a bar x14→40 at y36 and a chevron
 * (34,20)→(52,36)→(34,52), both 8-unit strokes, plus two 10×10 squares at
 * (14,14) and (14,48) — two source points → arrow → brand.
 */
export function Mark({ size = 24, variant = 'accent', title, className }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 72 72"
      className={cx(styles.mark, variant === 'ink' && styles.ink, className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {variant !== 'glyph' && <rect className={styles.square} width="72" height="72" />}
      <path className={styles.stroke} d="M14 36 H40" strokeWidth="8" />
      <path className={styles.stroke} d="M34 20 L52 36 L34 52" strokeWidth="8" />
      <rect className={styles.art} x="14" y="14" width="10" height="10" />
      <rect className={styles.art} x="14" y="48" width="10" height="10" />
    </svg>
  );
}

export interface WordmarkProps {
  /** Font size in px. Default 18. Letter-spacing is −0.04em, −0.03em below 24px. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/** "afflino", lowercase, Archivo 800. */
export function Wordmark({ size = 18, className, style }: WordmarkProps) {
  return (
    <span className={cx(styles.wordmark, size < 24 && styles.small, className)} style={{ fontSize: size, ...style }}>
      afflino
    </span>
  );
}

/** Mark sizes drawn in the handover → wordmark size and gap (1a, 1b, 1c, 2e). */
const LOCKUPS: Record<number, { word: number; gap: number }> = {
  22: { word: 15, gap: 10 },
  24: { word: 18, gap: 10 },
  28: { word: 20, gap: 10 },
  40: { word: 30, gap: 14 },
  72: { word: 56, gap: 20 },
};

export interface LockupProps {
  /** Mark size in px. Default 24 (the app sidebar). 28 = marketing nav, 72 = logo board. */
  markSize?: number;
  /** Wordmark size; default from the handover's lockups (24→18, 28→20, 40→30, 72→56), else 0.75 × mark. */
  wordSize?: number;
  /** Gap; default from the handover's lockups (≤28→10, 40→14, 72→20), else ≈ 0.36 × mark. */
  gap?: number;
  variant?: MarkVariant;
  /** Extra text after the wordmark in the same style, e.g. " admin" (2e). */
  suffix?: string;
  className?: string;
}

/** Mark then wordmark. The accessible name is the visible text. */
export function Lockup({ markSize = 24, wordSize, gap, variant = 'accent', suffix, className }: LockupProps) {
  const drawn = LOCKUPS[markSize];
  const word = wordSize ?? drawn?.word ?? Math.round(markSize * 0.75);
  const space = gap ?? drawn?.gap ?? Math.round(markSize * 0.36);
  return (
    <span className={cx(styles.lockup, className)} style={{ gap: space }}>
      <Mark size={markSize} variant={variant} />
      <span className={cx(styles.wordmark, word < 24 && styles.small)} style={{ fontSize: word }}>
        afflino{suffix}
      </span>
    </span>
  );
}
