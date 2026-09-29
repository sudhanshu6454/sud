import type { Metadata } from 'next';
import { OfferBrowser } from '@/components/creator/offers/OfferBrowser';
import { DEMO_LIVE_OFFER_COUNT } from '@/lib/demo/afflino';
import { DEMO_LINK_OFFERS } from '@/lib/demo/links';

export const metadata: Metadata = { title: 'Offers' };

/** Offer browser (design 1d; phone 3f). TEST demo offers: no v1 endpoint serves the Afflino offer model. */
export default function AppOffersPage() {
  return <OfferBrowser offers={DEMO_LINK_OFFERS} liveCount={DEMO_LIVE_OFFER_COUNT} />;
}
