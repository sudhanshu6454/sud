import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Brand overview' };

/** Placeholder — a screen builder replaces this page. */
export default function BrandPage() {
  return <ScreenPlaceholder eyebrow="Overview" title="Campaign performance" artboard="2b" />;
}
