import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Reports' };

/** Placeholder — a screen builder replaces this page. */
export default function AppReportsPage() {
  return <ScreenPlaceholder title="Reports" artboard="3d" />;
}
