'use client';

import { useEffect } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import styles from './not-found.module.css';

/**
 * Page-level failure anywhere outside the shop (which has its own
 * app/(shop)/error.tsx): a render error in the creator, brand, agency or
 * admin areas, or on the marketing pages, stays in the design system — the
 * accent-100 top banner and one action to retry — instead of Next's
 * unstyled "Application error" page. It renders in the root layout (the
 * area's shell is part of what failed).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <Banner title="This page could not be shown.">
        Something went wrong while showing it. Nothing was sent or changed. Try again, or reload the page.
      </Banner>
      <div className={styles.body}>
        <Button variant="primary" arrow onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
