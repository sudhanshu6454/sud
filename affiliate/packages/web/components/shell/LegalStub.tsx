import type { ReactNode } from 'react';
import { PageHeader } from '../ui/PageHeader';
import styles from './ScreenPlaceholder.module.css';

/** An honest stub for a policy page that does not exist yet. */
export function LegalStub({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <PageHeader eyebrow="Afflino" title={title} />
      <div className={styles.body}>{children}</div>
    </>
  );
}
