import type { Metadata } from 'next';
import { MatchReview } from './MatchReview';

export const metadata: Metadata = { title: 'Match review' };

/** Editorial product match review (was /console/looks/[id]): local, TEST demo looks. */
export default function AdminLookReviewPage({ params }: { params: { id: string } }) {
  return <MatchReview id={params.id} />;
}
