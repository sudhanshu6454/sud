import { EmptyState, PageHeader } from '@/components/ui';
import styles from '../not-found.module.css';

/**
 * 404 inside the creator app's shell (an offer id that does not exist,
 * /app/offers/[id]). Without this file a notFound() under /app renders the
 * root not-found without the sidebar and tab bar.
 */
export default function CreatorNotFound() {
  return (
    <div>
      <PageHeader eyebrow="404" title="Page not found" />
      <div className={styles.body}>
        <EmptyState action={{ label: 'Browse offers', href: '/app/offers' }}>
          This offer does not exist or is no longer listed.
        </EmptyState>
      </div>
    </div>
  );
}
