import type { ReactNode } from 'react';
import { cx } from '@/components/ui';
import styles from './Onboarding.module.css';

/**
 * The visible label on a demo flow (no SMS, OAuth, KYC or payment provider
 * exists): an outline "Demo" tag and one line saying what did not happen.
 * Candidate for promotion to components/ui.
 */
export function DemoNote({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cx(styles.demoNote, className)}>
      <span className={styles.demoTag}>Demo</span>
      <span>{children}</span>
    </p>
  );
}
