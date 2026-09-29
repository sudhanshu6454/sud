import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Admin queue' };

/** Placeholder — a screen builder replaces this page. */
export default function AdminPage() {
  return <ScreenPlaceholder eyebrow="Admin" title="Review queue" artboard="2e" />;
}
