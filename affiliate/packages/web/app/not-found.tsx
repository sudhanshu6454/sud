import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from './not-found.module.css';

/**
 * 404 in the Afflino look. No chrome of its own: a notFound() inside an area
 * renders this within that area's layout (shell, marketing nav), and an
 * unmatched URL renders it in the bare root layout.
 */
export default function NotFound() {
  return (
    <div>
      <PageHeader eyebrow="404" title="Page not found" />
      <div className={styles.body}>
        <EmptyState action={{ label: 'Go to the home page', href: '/' }}>
          The page you asked for does not exist or has moved.
        </EmptyState>
      </div>
    </div>
  );
}
