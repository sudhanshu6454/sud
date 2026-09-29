import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Billing' };

/** Placeholder — a screen builder replaces this page. */
export default function BrandBillingPage() {
  return <ScreenPlaceholder eyebrow="Brand" title="Billing" />;
}
