import type { ReactNode } from 'react';
import { cx } from './cx';
import { Eyebrow } from './Eyebrow';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  /** 12px uppercase line above the title ("Overview", "Demo PayUPI · September"). */
  eyebrow?: ReactNode;
  /** 28px / 800 / −0.03em. */
  title: ReactNode;
  /** Right-aligned controls (segmented control, buttons, a search input). */
  actions?: ReactNode;
  /** Optional 14px line under the title. */
  description?: ReactNode;
  /** Heading level; the page title is h1 (default). */
  as?: 'h1' | 'h2';
  /** Drop the 2px rule underneath. */
  plain?: boolean;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  actions,
  description,
  as: Heading = 'h1',
  plain = false,
  className,
}: PageHeaderProps) {
  return (
    <header className={cx(styles.header, plain && styles.plain, className)}>
      <div className={styles.heading}>
        {eyebrow ? <Eyebrow tracking="wide">{eyebrow}</Eyebrow> : null}
        <Heading className={cx(styles.title, !eyebrow && styles.noEyebrow)}>{title}</Heading>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
