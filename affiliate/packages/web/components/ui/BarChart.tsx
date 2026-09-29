import { cx } from './cx';
import styles from './BarChart.module.css';

export interface BarChartProps {
  /** One value per bar, oldest first. */
  data: ReadonlyArray<number>;
  /** Value that fills the full height. Default: the largest value. Pass 100 when data are already percentages. */
  max?: number;
  /** How many of the last bars are drawn in accent (the current period). Default 3. */
  highlightLast?: number;
  /** Chart height in px. Default 180. */
  height?: number;
  /** Axis labels under the baseline, spread edge to edge (e.g. ["1 Sep", "15 Sep", "30 Sep"]). */
  axisLabels?: ReadonlyArray<string>;
  /** Accessible summary of what the chart shows. */
  label: string;
  /** Per-bar tooltip text (native title), e.g. "12 Sep · ₹6,240". */
  barLabel?: (value: number, index: number) => string;
  className?: string;
}

export function BarChart({
  data,
  max,
  highlightLast = 3,
  height = 180,
  axisLabels,
  label,
  barLabel,
  className,
}: BarChartProps) {
  const top = max ?? Math.max(0, ...data);
  const firstCurrent = data.length - highlightLast;
  return (
    <figure className={className} aria-label={label} role="img">
      <div className={styles.chart} style={{ height }}>
        {data.map((value, i) => {
          const pct = top > 0 ? Math.max(0, Math.min(100, (value / top) * 100)) : 0;
          return (
            <div
              key={i}
              className={cx(styles.bar, i >= firstCurrent && styles.current)}
              style={{ height: `${pct}%` }}
              title={barLabel ? barLabel(value, i) : undefined}
            />
          );
        })}
      </div>
      {axisLabels && axisLabels.length > 0 ? (
        <div className={styles.axis} aria-hidden="true">
          {axisLabels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      ) : null}
    </figure>
  );
}
