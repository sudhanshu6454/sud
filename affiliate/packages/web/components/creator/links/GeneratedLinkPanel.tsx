'use client';

/*
 * 3c's "Generated" box (surface fill: eyebrow, monospace link, promo code ·
 * QR available) and its actions: Copy link (primary; "Copied" for 2s),
 * Download QR (a PNG of the link's QR code), Disclosure text (ghost; copies
 * the #ad line from lib/site-copy.ts). Returns siblings, so the parent's
 * flex gap spaces the box and the action row as drawn.
 *
 * The box says which link it shows: a demo link in the design's readable
 * format (not tracked), a live /r/{token} link minted by POST /v1/links,
 * or the untracked local link minted when the API was unreachable.
 */

import DemoBadge from '@/components/DemoBadge';
import { Button, StatusTag, Tag } from '@/components/ui';
import { cx } from '@/components/ui/cx';
import { CREATOR_DISCLOSURE_LINE } from '@/lib/site-copy';
import { downloadQrPng } from './downloadQr';
import { useCopyFeedback } from './useCopy';
import styles from './GeneratedLinkPanel.module.css';

export type PanelLink =
  | { kind: 'demo'; display: string; href: string; promoCode: string; qrFile: string; review?: { brand: string } }
  | { kind: 'live'; display: string; href: string; qrFile: string }
  | { kind: 'fallback'; display: string; href: string; qrFile: string };

export interface GeneratedLinkPanelProps {
  link: PanelLink | null;
  /** Shown in place of the link while there is none. */
  blockedReason?: string;
  /** With a live / fallback link: return to the demo preview. */
  onShowDemo?: () => void;
  /** Id for the box, e.g. to point aria-describedby at it. */
  id?: string;
}

type CopyKey = 'link' | 'disclosure';

export function GeneratedLinkPanel({ link, blockedReason, onShowDemo, id }: GeneratedLinkPanelProps) {
  const { copied, announcement, copy, announce } = useCopyFeedback<CopyKey>();

  const kindLabel =
    link?.kind === 'live' ? 'Live tracked link' : link?.kind === 'fallback' ? 'Untracked offline link' : 'Demo link, not tracked';

  return (
    <>
      <section id={id} className={styles.box} aria-label="Generated link">
        <div className={styles.head}>
          <span className={styles.eyebrow}>Generated</span>
          <span className={styles.tags}>
            {link?.kind === 'demo' && link.review ? <StatusTag status="Review" className={styles.tag} /> : null}
            {link?.kind === 'live' ? (
              <Tag variant="accent" className={styles.tag}>
                Live · tracked
              </Tag>
            ) : link?.kind === 'fallback' ? (
              <DemoBadge variant="fallback" className={cx(styles.tag, styles.badge)} />
            ) : link ? (
              <Tag variant="neutral" className={styles.tag} title="Demo link in the design's format: it is not tracked">
                Demo · not tracked
              </Tag>
            ) : null}
          </span>
        </div>

        {link ? (
          <div className={styles.url}>
            <span className="sr-only">{kindLabel}: </span>
            {link.display}
          </div>
        ) : (
          <div className={styles.blocked}>{blockedReason || 'Fill in the fields above to generate a link.'}</div>
        )}

        {link?.kind === 'demo' ? (
          <div className={styles.meta}>
            Promo code <strong className={styles.code}>{link.promoCode}</strong> · QR available
          </div>
        ) : null}
        {link?.kind === 'demo' && link.review ? (
          <p className={styles.note}>
            In review: {link.review.brand} approves creators before this link can earn.
          </p>
        ) : null}
        {link?.kind === 'live' ? (
          <div className={styles.meta}>
            Minted by the API (POST /v1/links) for the placement you chose · QR available
          </div>
        ) : null}
        {link?.kind === 'fallback' ? (
          <p className={styles.note}>
            Generated locally because the API is unreachable. It is not tracked and will not earn commission.
          </p>
        ) : null}
        {link && link.kind !== 'demo' && onShowDemo ? (
          <div>
            <Button variant="ghost" size="xs" className={styles.back} onClick={onShowDemo}>
              Back to the demo preview
            </Button>
          </div>
        ) : null}
      </section>

      <div className={styles.actions}>
        <Button
          variant="primary"
          className={styles.action}
          disabled={!link}
          onClick={() => link && copy(link.href, 'link', link.kind === 'live' ? 'Tracked link copied.' : 'Demo link copied. It is not tracked.')}
        >
          {copied === 'link' && link ? 'Copied' : 'Copy link'}
        </Button>
        <Button
          className={styles.action}
          disabled={!link}
          onClick={() => {
            if (!link) return;
            downloadQrPng(link.href, link.qrFile);
            announce(`QR code downloaded as ${link.qrFile}.`);
          }}
        >
          Download QR
        </Button>
        <Button
          variant="ghost"
          className={styles.action}
          title={`Copies: ${CREATOR_DISCLOSURE_LINE} (draft wording, pending counsel)`}
          onClick={() => copy(CREATOR_DISCLOSURE_LINE, 'disclosure', `Disclosure text copied: ${CREATOR_DISCLOSURE_LINE}`)}
        >
          {copied === 'disclosure' ? 'Copied' : 'Disclosure text'}
        </Button>
      </div>
      <span className="sr-only" aria-live="polite" role="status">
        {announcement}
      </span>
    </>
  );
}
