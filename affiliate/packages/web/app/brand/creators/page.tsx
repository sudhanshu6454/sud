import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Brand creators' };

/** Placeholder — a screen builder replaces this page. */
export default function BrandCreatorsPage() {
  return <ScreenPlaceholder eyebrow="Brand" title="Creators" />;
}
