'use client';

import styles from './DemoBadge.module.css';

interface DemoBadgeProps {
  /** 'fallback' (API unreachable/errored) or 'mock' (no API endpoint exists). */
  variant?: 'fallback' | 'mock';
}

/**
 * Visible label rendered whenever a page is showing demo data instead of
 * live API data. Never hide this when `variant="fallback"` is active.
 */
export default function DemoBadge({ variant = 'fallback' }: DemoBadgeProps) {
  const label =
    variant === 'fallback' ? 'demo data — API unreachable' : 'demo data — not from API';
  return (
    <span
      className={styles.badge}
      role="note"
      title="The API could not be reached, so this view is showing local demo data."
    >
      {label}
    </span>
  );
}
