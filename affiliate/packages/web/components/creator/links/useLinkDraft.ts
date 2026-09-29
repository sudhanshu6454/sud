'use client';

/*
 * The link generator's form state (3c, 1e): offer, landing page, platform,
 * sub-ID, their validation and the demo link they compose. Lifted into a
 * hook so the offer detail page's desktop generator and its phone
 * composition (1e) share one draft.
 */

import { useCallback, useMemo, useState } from 'react';
import type { Platform } from '@/lib/demo/afflino';
import { DEMO_LINK_HANDLE, demoDraftDefaults, type DemoLinkOffer } from '@/lib/demo/links';
import { composeDemoLink, demoLinkHref, validateLandingPage } from '@/lib/links';
import { validateSubId, type ValidationResult } from '@/lib/validators';

export interface LinkDraftValues {
  offerId: string;
  landing: string;
  platform: Platform;
  subId: string;
}

export interface DraftLink {
  /** As displayed (design format, no scheme). */
  display: string;
  /** Copy / QR form (https://…). */
  href: string;
}

export interface LinkDraft {
  values: LinkDraftValues;
  offer: DemoLinkOffer;
  offers: ReadonlyArray<DemoLinkOffer>;
  setOffer: (offerId: string) => void;
  setLanding: (value: string) => void;
  /** Mark the landing page as visited (its error shows from then on). */
  touchLanding: () => void;
  setPlatform: (platform: Platform) => void;
  setSubId: (value: string) => void;
  landing: ValidationResult;
  subId: ValidationResult;
  platformAllowed: boolean;
  /** Inline errors to render now (undefined when none). */
  landingError?: string;
  subIdError?: string;
  /** The composed demo link, or null while a field is invalid. */
  link: DraftLink | null;
  /** Why there is no link (for the Generated box), '' when there is one. */
  blockedReason: string;
  /** Bumps on every edit (callers clear a shown live link on change). */
  revision: number;
}

export function useLinkDraft(
  offers: ReadonlyArray<DemoLinkOffer>,
  initial: Partial<LinkDraftValues> & { offerId: string },
): LinkDraft {
  const [values, setValues] = useState<LinkDraftValues>(() => {
    const offer = offers.find((o) => o.id === initial.offerId) ?? offers[0]!;
    const defaults = demoDraftDefaults(offer);
    return {
      offerId: offer.id,
      landing: initial.landing ?? defaults.landing,
      platform: initial.platform ?? defaults.platform,
      subId: initial.subId ?? defaults.subId,
    };
  });
  const [landingTouched, setLandingTouched] = useState(false);
  const [revision, setRevision] = useState(0);

  const offer = offers.find((o) => o.id === values.offerId) ?? offers[0]!;

  const update = useCallback((patch: Partial<LinkDraftValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setRevision((r) => r + 1);
  }, []);

  const setOffer = useCallback(
    (offerId: string) => {
      const next = offers.find((o) => o.id === offerId);
      if (!next) return;
      const defaults = demoDraftDefaults(next);
      // A new offer brings its own landing page and platform; the sub-ID (the creator's own tag) stays.
      setLandingTouched(false);
      update({ offerId: next.id, landing: defaults.landing, platform: defaults.platform });
    },
    [offers, update],
  );

  const landing = useMemo(() => validateLandingPage(values.landing, offer.allowedDomains), [values.landing, offer]);
  const subId = useMemo(() => validateSubId(values.subId), [values.subId]);
  const platformAllowed = offer.platforms.includes(values.platform);

  const link = useMemo<DraftLink | null>(() => {
    if (!landing.ok || !subId.ok || !platformAllowed) return null;
    const display = composeDemoLink({ handle: DEMO_LINK_HANDLE, offerSlug: offer.id, subId: subId.value });
    // Keep the drawn display text; the payload is on a reserved host (demoLinkHref).
    return { display, href: demoLinkHref(display) };
  }, [landing.ok, subId.ok, subId.value, platformAllowed, offer.id]);

  let blockedReason = '';
  if (!landing.ok) blockedReason = 'Fix the landing page to generate a link.';
  else if (!subId.ok) blockedReason = 'Fix the sub-ID to generate a link.';
  else if (!platformAllowed) blockedReason = 'Choose a platform this offer allows.';

  return {
    values,
    offer,
    offers,
    setOffer,
    setLanding: (value) => update({ landing: value }),
    touchLanding: () => setLandingTouched(true),
    setPlatform: (platform) => update({ platform }),
    setSubId: (value) => update({ subId: value }),
    landing,
    subId,
    platformAllowed,
    landingError: landingTouched && !landing.ok ? landing.message : undefined,
    subIdError: subId.ok ? undefined : subId.message,
    link,
    blockedReason,
    revision,
  };
}
