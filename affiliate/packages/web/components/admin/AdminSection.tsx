import type { ReactNode } from 'react';
import { Eyebrow, cx } from '@/components/ui';
import styles from './AdminSection.module.css';

export interface AdminSectionProps {
  /** Section label (12px uppercase eyebrow, rendered as an h2). */
  title: ReactNode;
  /** id for the h2 (the section's aria-labelledby). */
  titleId: string;
  /** Next to the label (the DemoBadge). */
  badge?: ReactNode;
  /** Right side of the label row (filter tags). */
  aside?: ReactNode;
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A section of an admin page as 2e draws the review queue: 24px 32px 32px
 * padding, a label row (label left, filter tags right, 12px under), then the
 * content. Stacks on phones.
 */
export function AdminSection({ title, titleId, badge, aside, id, className, children }: AdminSectionProps) {
  return (
    <section id={id} className={cx(styles.section, className)} aria-labelledby={titleId}>
      <div className={styles.head}>
        <div className={styles.label}>
          <Eyebrow as="h2" id={titleId}>
            {title}
          </Eyebrow>
          {badge}
        </div>
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Small print under a table (demo sample note, policy line). */
export function AdminNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx(styles.note, className)}>{children}</p>;
}
