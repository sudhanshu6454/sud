import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Offers' };

/** Placeholder — a screen builder replaces this page. */
export default function AppOffersPage() {
  return <ScreenPlaceholder eyebrow="Offers" title="Live offers" artboard="1d" />;
}
