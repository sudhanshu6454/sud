import type { Metadata } from 'next';
import { OfferBuilder } from '@/components/brand/OfferBuilder';

export const metadata: Metadata = { title: 'New offer' };

/** Offer builder (3b). TEST demo: no brand-offer endpoint in v1; drafts and submissions stay in this browser. */
export default function BrandOffersNewPage() {
  return <OfferBuilder />;
}
