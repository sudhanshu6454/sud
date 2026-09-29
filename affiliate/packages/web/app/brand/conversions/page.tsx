import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Conversions' };

/** Placeholder — a screen builder replaces this page. */
export default function BrandConversionsPage() {
  return <ScreenPlaceholder eyebrow="Brand" title="Conversions" />;
}
