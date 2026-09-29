import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from './not-found.module.css';

/**
 * 404 in the Afflino look for an unmatched URL (and for a notFound() in an
 * area without its own not-found.tsx). It renders in the bare root layout
 * only: a not-found boundary sits inside the layout of the segment that
 * owns it, so an area that wants its chrome around a 404 has its own file
 * — app/(shop)/not-found.tsx and app/app/not-found.tsx.
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
