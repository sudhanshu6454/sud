import { cx } from './cx';
import styles from './ProgressBar.module.css';

export type ProgressTone = 'accent' | 'ink' | 'muted';

export interface ProgressBarProps {
  /** Filled share, 0–100 (clamped). */
  value: number;
  /** accent = primary metric, ink = secondary, muted = tertiary (neutral-500). Default accent. */
  tone?: ProgressTone;
  /** 8 (default), 10 or 12 px. */
  height?: 8 | 10 | 12;
  /** Accessible name, e.g. "Meta share of earnings". */
  label: string;
  /** Spoken value; default "<value>%". */
  valueText?: string;
  className?: string;
}

export function ProgressBar({ value, tone = 'accent', height = 8, label, valueText, className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100) / 100}
      aria-valuetext={valueText ?? `${Math.round(pct)}%`}
      className={cx(styles.track, styles[`h${height}`], className)}
    >
      <div className={cx(styles.fill, styles[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
