import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './Eyebrow.module.css';

export interface EyebrowProps {
  /** muted = neutral-700 (default), accent = accent-700 ("Step 1 of 3", highlighted eyebrows), inherit = current colour (on accent fields). */
  tone?: 'muted' | 'accent' | 'inherit';
  /** normal = 0.1em (section labels, KPI labels; default), wide = 0.12em (page-header and marketing eyebrows). */
  tracking?: 'normal' | 'wide';
  as?: 'div' | 'span' | 'p' | 'h2' | 'h3' | 'h4';
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Eyebrow({ tone = 'muted', tracking = 'normal', as: Tag = 'div', id, className, children }: EyebrowProps) {
  return (
    <Tag
      id={id}
      className={cx(
        styles.eyebrow,
        tracking === 'wide' && styles.wide,
        tone === 'accent' && styles.accent,
        tone === 'inherit' && styles.inherit,
        className,
      )}
    >
      {children}
    </Tag>
  );
}
