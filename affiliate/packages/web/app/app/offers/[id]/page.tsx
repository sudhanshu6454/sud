import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';
import { demoOfferById } from '@/lib/demo/afflino';

interface Params {
  params: { id: string };
}

export function generateMetadata({ params }: Params): Metadata {
  return { title: demoOfferById(params.id)?.name ?? 'Offer' };
}

/** Placeholder — offer detail + get link (1e right, 3c) replaces this page. */
export default function OfferDetailPage({ params }: Params) {
  const offer = demoOfferById(params.id);
  return <ScreenPlaceholder eyebrow="Offer" title={offer?.name ?? 'Offer detail'} artboard="1e" demo={Boolean(offer)} />;
}
