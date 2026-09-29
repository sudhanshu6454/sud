'use client';

/*
 * My links + link generator — design 3c (was /portal/links).
 *
 * Left (5fr): "New tracked link" over TEST demo offers (lib/demo/links.ts):
 * Offer, Landing page (on the offer's allowed host), Platform, Sub-ID, the
 * Generated box (a demo link in the design's readable format, marked "Demo
 * · not tracked") and Copy link / Download QR / Disclosure text. Below it,
 * the restored live path: POST /v1/links with property, programme, offer and
 * placement (LiveMintForm → mintLiveLink). A live result replaces the demo
 * link in the Generated box, marked "Live · tracked", with the same actions;
 * editing the generator returns the box to the demo preview. An unreachable
 * API yields the labelled, untracked redirect.demo.invalid link with
 * <DemoBadge variant="fallback" />.
 *
 * Right (7fr): "My links · 46", TEST demo rows (no list endpoint in v1).
 */

import { useEffect, useRef, useState } from 'react';
import { ApplyDialog } from '@/components/creator/offers/ApplyDialog';
import { useDemoApplications } from '@/components/creator/offers/applications';
import type { PanelLink } from '@/components/creator/links/GeneratedLinkPanel';
import { LinkGenerator } from '@/components/creator/links/LinkGenerator';
import { LiveMintForm, type MintedLink } from '@/components/creator/links/LiveMintForm';
import { MyLinks, type MyLinkRow } from '@/components/creator/links/MyLinks';
import { useLinkDraft } from '@/components/creator/links/useLinkDraft';
import { DEMO_LANDING_PAGE, DEMO_MY_LINKS, DEMO_MY_LINKS_TOTAL } from '@/lib/demo/afflino';
import { DEMO_GENERATOR_OFFER_ID, DEMO_LINK_HANDLE, DEMO_LINK_OFFERS, demoLinkOfferById } from '@/lib/demo/links';
import { composeDemoLink, qrFileName } from '@/lib/links';
import styles from './page.module.css';

function toPanel(result: MintedLink): PanelLink {
  return { kind: result.kind, display: result.url, href: result.url, qrFile: qrFileName(result.kind, result.token) };
}

export function LinkBuilder() {
  // The state 3c draws: Demo Style Festive, its landing page, YouTube, short-diwali-02.
  const draft = useLinkDraft(DEMO_LINK_OFFERS, {
    offerId: DEMO_GENERATOR_OFFER_ID,
    landing: DEMO_LANDING_PAGE,
    platform: 'youtube',
    subId: 'short-diwali-02',
  });
  const [minted, setMinted] = useState<MintedLink | null>(null);
  const [showMinted, setShowMinted] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const { applications, hasApplied } = useDemoApplications();

  // Editing the generator returns the Generated box to the demo preview.
  const revision = useRef(draft.revision);
  useEffect(() => {
    if (draft.revision !== revision.current) {
      revision.current = draft.revision;
      setShowMinted(false);
    }
  }, [draft.revision]);

  // An offer applied to in this browser has a link in Review (demo; no applications endpoint).
  const appliedRows: MyLinkRow[] = applications
    .filter((a) => !DEMO_MY_LINKS.some((l) => l.offerId === a.offerId))
    .flatMap((a) => {
      const offer = demoLinkOfferById(a.offerId);
      if (!offer) return [];
      return [
        {
          key: `applied-${offer.id}`,
          offer: offer.name,
          url: composeDemoLink({ handle: DEMO_LINK_HANDLE, offerSlug: offer.id }),
          subId: '',
          platform: offer.platforms[0] ?? 'meta',
          clicks: null,
          epcMinor: null,
          status: 'Review' as const,
        },
      ];
    });
  const rows: MyLinkRow[] = [
    ...appliedRows,
    ...DEMO_MY_LINKS.map((l) => ({
      key: `${l.offerId}-${l.subId}`,
      offer: l.offer,
      url: l.url,
      subId: l.subId,
      platform: l.platform,
      clicks: l.clicks,
      epcMinor: l.epcMinor,
      status: l.status,
    })),
  ];

  return (
    <>
      <h1 className="sr-only">My links</h1>
      <div className={styles.grid}>
        <div className={styles.formCol}>
          <LinkGenerator
            draft={draft}
            heading="New tracked link"
            applied={hasApplied(draft.offer.id)}
            onApply={() => setApplyOpen(true)}
            override={minted && showMinted ? toPanel(minted) : null}
            onClearOverride={() => setShowMinted(false)}
          >
            <LiveMintForm
              last={minted}
              onMinted={(result) => {
                setMinted(result);
                setShowMinted(true);
              }}
            />
          </LinkGenerator>
        </div>
        <div className={styles.listCol}>
          <MyLinks rows={rows} total={DEMO_MY_LINKS_TOTAL + appliedRows.length} />
        </div>
      </div>
      <ApplyDialog offer={draft.offer} open={applyOpen} onClose={() => setApplyOpen(false)} onOfferPage />
    </>
  );
}
