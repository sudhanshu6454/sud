import type { Metadata } from 'next';
import { Disputes } from './Disputes';

export const metadata: Metadata = { title: 'Disputes' };

/** Live disputes (GET / POST /v1/disputes; was /portal/disputes); demo fallback with a badge. */
export default function AppPayoutsDisputesPage() {
  return <Disputes />;
}
