'use client';

import { useEffect } from 'react';
import { Banner, Button } from '@/components/ui';
import styles from './not-found.module.css';

/**
 * Page-level failure inside the shop: a render error, or the catalogue API
 * down for a live look id (the server-side catalogue client's lookOrMiss
 * throws CatalogueUnavailableError, so an outage is never a 404; demo ids and
 * the grid still fall back to the labelled demo data). The accent-100 top
 * banner and one action to retry.
 */
export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <Banner title="This page could not be shown.">
        The shop may be temporarily unavailable. Nothing was bought or changed. Try again in a moment.
      </Banner>
      <div className={styles.body}>
        <Button variant="primary" arrow onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
