import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Brand offers' };

/** Placeholder — a screen builder replaces this page. */
export default function BrandOffersPage() {
  return <ScreenPlaceholder eyebrow="Brand" title="Offers" />;
}
