import type { Metadata } from 'next';
import { LibraryScreen } from '@/components/admin/celebrity/LibraryScreen';

export const metadata: Metadata = { title: 'Library import' };

/** The paparazzi library import: check (dry run), import as drafts, the results. */
export default function AdminLibraryPage() {
  return <LibraryScreen />;
}
