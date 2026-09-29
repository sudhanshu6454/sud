import type { Metadata } from 'next';
import { ScreenPlaceholder } from '@/components/shell/ScreenPlaceholder';

export const metadata: Metadata = { title: 'Fraud' };

/** Placeholder — a screen builder replaces this page. */
export default function AdminFraudPage() {
  return <ScreenPlaceholder eyebrow="Admin" title="Fraud" />;
}
