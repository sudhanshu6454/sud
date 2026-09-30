import { EmptyState, PageHeader } from '@/components/ui';
import { CELEBRITY_WEB } from '@/lib/site-copy';
import styles from './not-found.module.css';

/**
 * A storefront that is not live (unknown, hidden, a draft, or a page that is
 * no longer approved): a 404 inside the storefront's own slim layout
 * (app/s/layout.tsx), pointing to Spotted — never the marketing home. What a
 * stale Instagram bio link lands on.
 */
export default function StorefrontNotFound() {
  return (
    <div>
      <PageHeader eyebrow="404" title={CELEBRITY_WEB.storefrontMissingTitle} className={styles.header} />
      <div className={styles.body}>
        <EmptyState action={{ label: CELEBRITY_WEB.withdrawnAction, href: '/shop' }}>{CELEBRITY_WEB.storefrontMissing}</EmptyState>
      </div>
    </div>
  );
}
