import type { ReactNode } from 'react';
import DemoBadge from '../DemoBadge';
import { PageHeader } from '../ui/PageHeader';
import styles from './ScreenPlaceholder.module.css';

export interface ScreenPlaceholderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Design artboard this screen implements, e.g. "1c". */
  artboard?: string;
  /** The placeholder already shows TEST demo data (e.g. a demo offer's name): render <DemoBadge variant="mock" />. */
  demo?: boolean;
  children?: ReactNode;
}

/** Stand-in for a screen that is not built yet, so every route resolves. */
export function ScreenPlaceholder({ eyebrow, title, artboard, demo = false, children }: ScreenPlaceholderProps) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} actions={demo ? <DemoBadge variant="mock" className={styles.badge} /> : undefined} />
      <div className={styles.body}>
        <p>Screen in progress{artboard ? ` (design ${artboard})` : ''}.</p>
        {children}
      </div>
    </>
  );
}
