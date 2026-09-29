import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Brand settings' };

/** Placeholder — a screen builder replaces this page. */
export default function BrandSettingsPage() {
  return <ScreenPlaceholder eyebrow="Brand" title="Settings" />;
}
