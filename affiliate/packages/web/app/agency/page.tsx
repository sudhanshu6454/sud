import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Agency' };

/** Placeholder — a screen builder replaces this page. */
export default function AgencyPage() {
  return <ScreenPlaceholder eyebrow="Agency" title="Agency workspace" artboard="3e" />;
}
