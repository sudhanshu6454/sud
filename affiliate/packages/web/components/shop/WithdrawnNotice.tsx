import { EmptyState } from '../ui/EmptyState';
import { PageHeader } from '../ui/PageHeader';
import { CELEBRITY_WEB } from '../../lib/site-copy';
import styles from './WithdrawnNotice.module.css';

/**
 * A page that was withdrawn (a takedown): no name, no image, no product —
 * only this notice, under the page's one h1. The middleware answers such a
 * page with HTTP 410 and the /withdrawn page's markup before it renders (the
 * shop's layout, so an old Facebook or Instagram link lands in Afflino's own
 * design); this is also what shows if a page renders anyway (the API down at
 * the middleware's check, then reachable for the page). The middleware's
 * plain fallback repeats these words (middleware.ts FALLBACK_HTML).
 */
export function WithdrawnNotice() {
  return (
    <div data-withdrawn="">
      <PageHeader eyebrow="410" title={CELEBRITY_WEB.withdrawnTitle} className={styles.header} />
      <div className={styles.wrap}>
        <EmptyState action={{ label: CELEBRITY_WEB.withdrawnAction, href: '/shop' }}>{CELEBRITY_WEB.withdrawn}</EmptyState>
      </div>
    </div>
  );
}
