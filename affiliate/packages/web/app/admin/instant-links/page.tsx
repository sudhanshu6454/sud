import type { Metadata } from 'next';
import { InstantLinksScreen } from '@/components/admin/celebrity/InstantLinksScreen';

export const metadata: Metadata = { title: 'Instant links' };

/** An amazon.in link or ASIN → tracked links for the chosen in-house pages, optionally into an outfit piece. */
export default function AdminInstantLinksPage() {
  return <InstantLinksScreen />;
}
