import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Settlements' };

/** Placeholder — a screen builder replaces this page. */
export default function AdminSettlementsPage() {
  return <ScreenPlaceholder eyebrow="Admin" title="Settlements" />;
}
