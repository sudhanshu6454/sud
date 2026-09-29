import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OfferDetail } from '@/components/creator/offers/OfferDetail';
import { demoLinkOfferById } from '@/lib/demo/links';

interface Params {
  params: { id: string };
}

export function generateMetadata({ params }: Params): Metadata {
  return { title: demoLinkOfferById(params.id)?.name ?? 'Offer' };
}

/**
 * Offer detail / get link (desktop: the 3c generator pre-selected + the
 * offer's terms; phone: 1e right). TEST demo offers; an unknown id is a 404.
 */
export default function OfferDetailPage({ params }: Params) {
  const offer = demoLinkOfferById(params.id);
  if (!offer) notFound();
  // Keyed by offer: moving to another offer starts a fresh draft.
  return <OfferDetail key={offer.id} offer={offer} />;
}
