import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'New offer' };

/** Placeholder — a screen builder replaces this page. */
export default function BrandOffersNewPage() {
  return <ScreenPlaceholder eyebrow="Brand · New offer" title="New offer" artboard="3b" />;
}
