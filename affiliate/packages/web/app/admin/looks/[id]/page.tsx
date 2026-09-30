import type { Metadata } from 'next';
import { LookOrReview } from './LookOrReview';

export const metadata: Metadata = { title: 'Look' };

/** One look: the outfit editor for a live celebrity look; the local match review for a TEST board look. */
export default function AdminLookPage({ params }: { params: { id: string } }) {
  return <LookOrReview id={params.id} />;
}
