'use client';

/*
 * "Apply" for an offer that needs brand approval (1d). A demo flow: no
 * applications endpoint exists, so nothing reaches a brand — the dialog
 * says so. After applying, the offer's link carries the status "Review".
 */

import { useEffect, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { Button, Dialog } from '@/components/ui';
import type { DemoLinkOffer } from '@/lib/demo/links';
import { useDemoApplications } from './applications';
import styles from './ApplyDialog.module.css';

export interface ApplyDialogProps {
  offer: DemoLinkOffer | null;
  open: boolean;
  onClose: () => void;
  /** Opened from the offer's own page: the success state closes instead of linking there. */
  onOfferPage?: boolean;
}

export function ApplyDialog({ offer, open, onClose, onOfferPage = false }: ApplyDialogProps) {
  const { apply } = useDemoApplications();
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) setSent(false);
  }, [open, offer?.id]);

  if (!offer) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={sent ? 'Application sent' : `Apply to promote ${offer.name}`}
      actions={
        sent ? (
          onOfferPage ? (
            <Button variant="primary" arrow onClick={onClose}>
              Get your link
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button variant="primary" arrow href={`/app/offers/${offer.id}`}>
                Get your link
              </Button>
            </>
          )
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              arrow
              onClick={() => {
                apply(offer.id);
                setSent(true);
              }}
            >
              Send application
            </Button>
          </>
        )
      }
    >
      {sent ? (
        <p role="status" className={styles.copy}>
          Your link for {offer.name} is in Review. It can start earning once the brand approves you.
        </p>
      ) : (
        <p className={styles.copy}>
          {offer.name} approves every creator before their link goes live. When you apply, your link is created with the
          status Review.
        </p>
      )}
      <p className={styles.demo}>
        <DemoBadge variant="mock" className={styles.badge} />
        <span>
          Demo flow: nothing is sent to a brand (there is no applications endpoint yet). The application is kept in this
          browser only.
        </span>
      </p>
    </Dialog>
  );
}
