import { EmptyState, PageHeader } from '@/components/ui';
import styles from './not-found.module.css';

/**
 * 404 inside the shop chrome (a look or product id that does not resolve —
 * unknown, unpublished, or not a uuid in live mode). Without this file a
 * notFound() in the shop would render the root not-found without the shop's
 * nav and footer.
 */
export default function ShopNotFound() {
  return (
    <div>
      <PageHeader eyebrow="404" title="Not in the shop" className={styles.header} />
      <div className={styles.body}>
        <EmptyState action={{ label: 'Browse the shop', href: '/shop' }}>
          This look or product may have been unpublished, or the link is wrong.
        </EmptyState>
      </div>
    </div>
  );
}
