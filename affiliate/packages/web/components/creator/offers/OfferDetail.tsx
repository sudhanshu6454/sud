'use client';

/*
 * Offer detail / get link — /app/offers/[id].
 *
 * Desktop: the link generator of 3c pre-selected with this offer (choosing
 * another offer opens that offer's page) beside the offer's terms. Phone
 * (≤760px): the 1e "Get link" composition — "← Offers" / "Get link" bar,
 * model · category tag, title and terms, Platform (Meta | YouTube | Snap),
 * Sub-ID (optional), Your link, Promo code, then a sticky footer with
 * "Copy link →" and "Share to Instagram →" (the native share sheet with the
 * link and the disclosure line; copies both where sharing is unavailable).
 * Both layouts share one draft (useLinkDraft).
 *
 * TEST demo offer (lib/demo/links.ts) → <DemoBadge variant="mock" />. The
 * link is a demo in the design's readable format; live links are minted on
 * /app/links (POST /v1/links).
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { LinkGenerator } from '@/components/creator/links/LinkGenerator';
import { useCopyFeedback } from '@/components/creator/links/useCopy';
import { useLinkDraft } from '@/components/creator/links/useLinkDraft';
import { Button, Field, Input, PageHeader, Segmented, StatusTag, Tag } from '@/components/ui';
import { PLATFORM_NAME, type Platform } from '@/lib/demo/afflino';
import { DEMO_LINK_OFFERS, type DemoLinkOffer } from '@/lib/demo/links';
import { formatPayout } from '@/lib/format';
import { CREATOR_DISCLOSURE_LINE, VALIDATION_WINDOW_DAYS } from '@/lib/site-copy';
import { ApplyDialog } from './ApplyDialog';
import { useDemoApplications } from './applications';
import styles from './OfferDetail.module.css';

/** The phone platform choice as drawn in 1e. */
const PHONE_PLATFORMS: ReadonlyArray<{ value: Platform; label: string }> = [
  { value: 'meta', label: 'Meta' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'snapchat', label: 'Snap' },
];

type CopyKey = 'link' | 'share' | 'disclosure';

export function OfferDetail({ offer }: { offer: DemoLinkOffer }) {
  const router = useRouter();
  const draft = useLinkDraft(DEMO_LINK_OFFERS, { offerId: offer.id });
  const { hasApplied } = useDemoApplications();
  const [applyOpen, setApplyOpen] = useState(false);
  const { copied, announcement, copy, announce } = useCopyFeedback<CopyKey>();

  const applied = hasApplied(offer.id);
  const needsApply = offer.requiresApproval && !applied;
  const inReview = offer.requiresApproval && applied;
  const link = draft.link;

  async function share() {
    if (!link) return;
    const text = `${link.href}\n\n${CREATOR_DISCLOSURE_LINE}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: offer.name, text });
        announce('Shared.');
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // the creator closed the sheet
      }
    }
    await copy(text, 'share', 'Demo link and disclosure line copied (not tracked).');
  }

  const facts: ReadonlyArray<[string, React.ReactNode]> = [
    ['Payout', formatPayout(offer.payout)],
    ['Conversion', offer.description],
    ['Allowed platforms', offer.platforms.map((p) => PLATFORM_NAME[p]).join(', ')],
    ['Attribution window', `${offer.attributionDays} days`],
    ['Validation window', `${VALIDATION_WINDOW_DAYS} days before a conversion clears`],
    ['Landing pages on', offer.allowedDomains.join(', ')],
    ['Promo code', <strong key="code" className={styles.code}>{offer.promoCode}</strong>],
    [
      'Brand approval',
      offer.requiresApproval ? (applied ? 'Applied: your link is in Review' : 'Required: apply before promoting') : 'Not required',
    ],
  ];

  return (
    <>
      {/* ---------- desktop ---------- */}
      <div className={styles.desk}>
        <PageHeader
          eyebrow={
            <>
              <Link href="/app/offers" className={styles.crumb}>
                Offers
              </Link>{' '}
              · {offer.category}
            </>
          }
          title={offer.name}
          actions={<DemoBadge variant="mock" className={styles.badge} />}
        />
        <div className={styles.grid}>
          <div className={styles.genCol}>
            <LinkGenerator
              draft={draft}
              heading="Get link"
              applied={applied}
              onApply={() => setApplyOpen(true)}
              onOfferChange={(id) => {
                if (id !== offer.id) router.push(`/app/offers/${id}`);
              }}
            />
          </div>
          <section className={styles.termsCol} aria-labelledby="offer-terms">
            <h2 id="offer-terms" className={styles.termsTitle}>
              Terms
            </h2>
            <div className={styles.tagRow}>
              <Tag variant={offer.modelTag}>
                {offer.model} · {offer.category}
              </Tag>
              {inReview ? <StatusTag status="Review" /> : null}
            </div>
            <p className={styles.termsLine}>{offer.terms}</p>
            <dl className={styles.facts}>
              {facts.map(([term, value]) => (
                <div key={term} className={styles.fact}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.disclosureNote}>
              Every post needs a disclosure. “Disclosure text” copies “{CREATOR_DISCLOSURE_LINE}” (draft wording, pending
              counsel sign-off).
            </p>
          </section>
        </div>
      </div>

      {/* ---------- phone (1e) ---------- */}
      <div className={styles.phone}>
        <div className={styles.bar}>
          <Link href="/app/offers" className={styles.back}>
            <span aria-hidden="true">← </span>Offers
          </Link>
          <span className={styles.barTitle} aria-hidden="true">
            Get link
          </span>
        </div>

        <div className={styles.intro}>
          <div className={styles.introTags}>
            <Tag variant={offer.modelTag}>
              {offer.model} · {offer.category}
            </Tag>
            {inReview ? <StatusTag status="Review" /> : null}
            <DemoBadge variant="mock" className={styles.badge} />
          </div>
          <h1 className={styles.phoneTitle}>
            <span className="sr-only">Get link: </span>
            {offer.name}
          </h1>
          <p className={styles.phoneTerms}>{offer.terms}</p>
        </div>

        <div className={styles.middle}>
          {needsApply ? (
            <div className={styles.applyBox}>
              <span className={styles.applyEyebrow}>Brand approval needed</span>
              <p className={styles.applyCopy}>
                {offer.name} approves creators before their links go live. Apply, and your link is created with the
                status Review.
              </p>
            </div>
          ) : (
            <>
              <Field label="Platform">
                <Segmented
                  block
                  value={draft.values.platform}
                  onChange={draft.setPlatform}
                  options={PHONE_PLATFORMS.map((p) => ({
                    ...p,
                    disabled: !offer.platforms.includes(p.value),
                  }))}
                />
              </Field>
              <Field label="Sub-ID (optional)" error={draft.subIdError}>
                <Input
                  value={draft.values.subId}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  onChange={(e) => draft.setSubId(e.target.value)}
                />
              </Field>
              <div>
                <span id="phone-link-label" className={styles.label}>
                  Your link
                </span>
                <div className={styles.linkBox} role="group" aria-labelledby="phone-link-label">
                  {link ? (
                    <>
                      <span className="sr-only">Demo link, not tracked: </span>
                      {link.display}
                    </>
                  ) : (
                    <span className={styles.blocked}>{draft.blockedReason}</span>
                  )}
                </div>
                {inReview ? (
                  <p className={styles.note}>In review: {offer.name} approves creators before this link can earn.</p>
                ) : null}
              </div>
              <div>
                <span id="phone-promo-label" className={styles.label}>
                  Promo code
                </span>
                <div className={styles.promo} role="group" aria-labelledby="phone-promo-label">
                  {offer.promoCode}
                </div>
              </div>
              <div>
                <span id="phone-disclosure-label" className={styles.label}>
                  Disclosure text
                </span>
                <p className={styles.disclosure} id="phone-disclosure">
                  {CREATOR_DISCLOSURE_LINE}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  touch
                  className={styles.copyDisclosure}
                  aria-describedby="phone-disclosure"
                  onClick={() => copy(CREATOR_DISCLOSURE_LINE, 'disclosure', `Disclosure text copied: ${CREATOR_DISCLOSURE_LINE}`)}
                >
                  {copied === 'disclosure' ? 'Copied' : 'Copy disclosure text'}
                </Button>
              </div>
            </>
          )}
        </div>

        <div className={styles.footer}>
          {needsApply ? (
            <Button variant="primary" block arrow touch onClick={() => setApplyOpen(true)}>
              Apply to promote
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                block
                touch
                arrow={!(copied === 'link' && link)}
                disabled={!link}
                onClick={() => link && copy(link.href, 'link', 'Demo link copied. It is not tracked.')}
              >
                {copied === 'link' && link ? 'Copied' : 'Copy link'}
              </Button>
              <Button block touch arrow={!(copied === 'share' && link)} disabled={!link} onClick={share}>
                {copied === 'share' && link ? 'Copied' : 'Share to Instagram'}
              </Button>
            </>
          )}
        </div>
      </div>

      <span className="sr-only" aria-live="polite" role="status">
        {announcement}
      </span>
      <ApplyDialog offer={offer} open={applyOpen} onClose={() => setApplyOpen(false)} onOfferPage />
    </>
  );
}
