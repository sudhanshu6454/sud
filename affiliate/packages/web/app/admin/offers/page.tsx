import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Admin offers' };

/** Placeholder — a screen builder replaces this page. */
export default function AdminOffersPage() {
  return <ScreenPlaceholder eyebrow="Admin" title="Offers" />;
}
