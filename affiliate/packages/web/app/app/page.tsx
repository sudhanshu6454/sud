import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Overview' };

/** Placeholder — a screen builder replaces this page. */
export default function AppPage() {
  return <ScreenPlaceholder eyebrow="Overview" title="Last 30 days" artboard="1c" />;
}
