import type { ReactNode } from 'react';
import { Eyebrow } from '../ui/Eyebrow';
import styles from './StubPage.module.css';

export interface StubPageProps {
  /** Accent eyebrow above the title ("Legal", "Contact"). */
  eyebrow: string;
  title: string;
  /** The honest status line(s); rendered as 18px body copy. */
  children: ReactNode;
  /** At most one primary action (the empty-state rule). */
  action?: ReactNode;
}

/**
 * A public page that does not exist yet (terms, privacy, contact), set in
 * the marketing site's type: accent eyebrow, 48px title, 18px body, in the
 * 40px marketing gutters. It says what is missing and never stands in for
 * the document itself.
 *
 * `data-document-status="stub"` (STUB_MARKER) marks the page as not yet the
 * document: deploy/linode/amazon.sh `links` and `shop` refuse while /privacy
 * carries it (OA §5: the privacy notice must say what third parties,
 * Amazon included, may place on or read from visitors' browsers), so Amazon
 * cannot go live before counsel's notice is published in its place.
 */
export const STUB_MARKER = 'data-document-status="stub"';

export function StubPage({ eyebrow, title, children, action }: StubPageProps) {
  return (
    <section className={styles.stub} aria-labelledby="stub-title" data-document-status="stub">
      <Eyebrow tone="accent" tracking="wide">
        {eyebrow}
      </Eyebrow>
      <h1 id="stub-title" className={styles.title}>
        {title}
      </h1>
      <div className={styles.body}>{children}</div>
      {action ? <div className={styles.actions}>{action}</div> : null}
    </section>
  );
}
