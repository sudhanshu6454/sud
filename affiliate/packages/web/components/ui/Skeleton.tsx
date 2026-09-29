import { cx } from './cx';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  /** CSS width (default 100%). */
  width?: number | string;
  /** CSS height (default 1em). */
  height?: number | string;
  inline?: boolean;
  className?: string;
}

export function Skeleton({ width = '100%', height = '1em', inline = false, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, inline && styles.inline, className)}
      style={{ width, height }}
    />
  );
}
