import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Admin brands' };

/** Placeholder — a screen builder replaces this page. */
export default function AdminBrandsPage() {
  return <ScreenPlaceholder eyebrow="Admin" title="Brands" />;
}
