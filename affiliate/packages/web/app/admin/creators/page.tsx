import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Admin creators' };

/** Placeholder — a screen builder replaces this page. */
export default function AdminCreatorsPage() {
  return <ScreenPlaceholder eyebrow="Admin" title="Creators" />;
}
