import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Payouts' };

/** Placeholder — a screen builder replaces this page. */
export default function AppPayoutsPage() {
  return <ScreenPlaceholder eyebrow="Payouts" title="Payouts" artboard="2c" />;
}
