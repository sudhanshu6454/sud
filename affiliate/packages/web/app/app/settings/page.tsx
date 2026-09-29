import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Settings' };

/** Placeholder — a screen builder replaces this page. */
export default function AppSettingsPage() {
  return <ScreenPlaceholder eyebrow="Settings" title="Settings & profile" artboard="2d" />;
}
