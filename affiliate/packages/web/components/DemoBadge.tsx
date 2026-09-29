import styles from './DemoBadge.module.css';

interface DemoBadgeProps {
  /** 'fallback' (API unreachable/errored) or 'mock' (no API endpoint exists). */
  variant?: 'fallback' | 'mock';
  /** Extra classes for the placement (spacing, alignment). */
  className?: string;
}

/**
 * Visible label rendered whenever a page is showing demo data instead of
 * live API data. Never hide this when `variant="fallback"` is active.
 */
export default function DemoBadge({ variant = 'fallback', className }: DemoBadgeProps) {
  const label = variant === 'fallback' ? 'Demo data — API unreachable' : 'Demo data';
  const title =
    variant === 'fallback'
      ? 'The API could not be reached, so this view is showing local TEST demo data.'
      : 'No API endpoint serves this view yet, so it shows local TEST demo data.';
  return (
    <span className={className ? `${styles.badge} ${className}` : styles.badge} role="note" title={title}>
      {label}
    </span>
  );
}

export { DemoBadge };
