import type { Metadata } from 'next';
import { BrandOffers } from '@/components/brand/BrandOffers';

export const metadata: Metadata = { title: 'Brand offers' };

/** The brand's offers and their status flow. TEST demo: no brand-offer endpoint in v1; local drafts and submissions included. */
export default function BrandOffersPage() {
  return <BrandOffers />;
}
