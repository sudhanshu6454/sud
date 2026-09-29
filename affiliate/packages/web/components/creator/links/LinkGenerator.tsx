'use client';

/*
 * "New tracked link" — the left column of 3c, reused (pre-selected) on the
 * offer detail page. Offer (searchable select), Landing page (must be on
 * the offer's allowed host), Platform, Sub-ID (a–z 0–9 hyphen, ≤32), the
 * Generated box and its actions. The form state lives in useLinkDraft().
 *
 * The link it composes is a DEMO link in the design's readable format; a
 * live link minted by POST /v1/links can be shown in the same box instead
 * (`override`), and says so.
 */

import { useId, type ReactNode } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { PLATFORM_NAME } from '@/lib/demo/afflino';
import type { Platform } from '@/lib/demo/afflino';
import { formatPayout } from '@/lib/format';
import { qrFileName } from '@/lib/links';
import { GeneratedLinkPanel, type PanelLink } from './GeneratedLinkPanel';
import { OfferCombobox, type ComboOption } from './OfferCombobox';
import type { LinkDraft } from './useLinkDraft';
import styles from './LinkGenerator.module.css';

export interface LinkGeneratorProps {
  draft: LinkDraft;
  heading: ReactNode;
  /** Something small beside the heading (a demo badge). */
  headingAside?: ReactNode;
  /** Replace choosing an offer in place (the offer page navigates to the chosen offer instead). */
  onOfferChange?: (offerId: string) => void;
  /** A live (or offline-fallback) minted link shown in the Generated box instead of the demo link. */
  override?: PanelLink | null;
  onClearOverride?: () => void;
  /** The creator has applied to this approval-only offer (its link is in Review). */
  applied: boolean;
  onApply: () => void;
  /** Rendered after the actions (the live-minting section on /app/links). */
  children?: ReactNode;
  className?: string;
}

export function offerOptionLabel(offer: { name: string; payout: Parameters<typeof formatPayout>[0] }): string {
  return `${offer.name} · ${formatPayout(offer.payout)}`;
}

export function LinkGenerator({
  draft,
  heading,
  headingAside,
  onOfferChange,
  override,
  onClearOverride,
  applied,
  onApply,
  children,
  className,
}: LinkGeneratorProps) {
  const headingId = `lg${useId().replace(/:/g, '')}`;
  const { offer, values } = draft;
  const landingHintId = `${headingId}-landing`;

  const options: ComboOption[] = draft.offers.map((o) => ({
    id: o.id,
    label: offerOptionLabel(o),
    meta: `${o.category} · ${o.model}${o.requiresApproval ? ' · brand approval' : ''}`,
    search: `${o.name} ${o.category} ${o.model} ${formatPayout(o.payout)}`,
  }));

  const needsApply = offer.requiresApproval && !applied;

  const demoLink: PanelLink | null = draft.link
    ? {
        kind: 'demo',
        display: draft.link.display,
        href: draft.link.href,
        promoCode: offer.promoCode,
        qrFile: qrFileName(offer.id, draft.subId.value),
        review: offer.requiresApproval ? { brand: offer.name } : undefined,
      }
    : null;

  return (
    <section className={[styles.form, className].filter(Boolean).join(' ')} aria-labelledby={headingId}>
      <div className={styles.headRow}>
        <h2 id={headingId} className={styles.heading}>
          {heading}
        </h2>
        {headingAside}
      </div>

      <Field label="Offer">
        <OfferCombobox options={options} value={values.offerId} onChange={onOfferChange ?? draft.setOffer} />
      </Field>

      <Field label="Landing page" error={draft.landingError}>
        <Input
          value={values.landing}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={landingHintId}
          onChange={(e) => draft.setLanding(e.target.value)}
          onBlur={draft.touchLanding}
        />
      </Field>
      <span id={landingHintId} className="sr-only">
        Must be a page on {offer.allowedDomains.join(' or ')}.
      </span>

      <div className={styles.pair}>
        <Field label="Platform">
          <Select
            value={values.platform}
            onChange={(e) => draft.setPlatform(e.target.value as Platform)}
            options={offer.platforms.map((p) => ({ value: p, label: PLATFORM_NAME[p] }))}
          />
        </Field>
        <Field label="Sub-ID" error={draft.subIdError}>
          <Input
            value={values.subId}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            placeholder="e.g. reel-oct-01"
            onChange={(e) => draft.setSubId(e.target.value)}
          />
        </Field>
      </div>

      {needsApply ? (
        <>
          <div className={styles.applyBox}>
            <span className={styles.eyebrow}>Brand approval needed</span>
            <p className={styles.applyCopy}>
              {offer.name} approves creators before their links go live. Apply, and your link is created with the status
              Review.
            </p>
          </div>
          <div className={styles.actions}>
            <Button variant="primary" arrow className={styles.action} onClick={onApply}>
              Apply to promote
            </Button>
          </div>
        </>
      ) : (
        <GeneratedLinkPanel
          link={override ?? demoLink}
          blockedReason={draft.blockedReason}
          onShowDemo={override ? onClearOverride : undefined}
        />
      )}

      {children}
    </section>
  );
}
