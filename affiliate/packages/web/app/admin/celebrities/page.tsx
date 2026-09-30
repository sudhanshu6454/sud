import type { Metadata } from 'next';
import { CelebritiesScreen } from '@/components/admin/celebrity/CelebritiesScreen';

export const metadata: Metadata = { title: 'Celebrities' };

/** Celebrities and their rights reviews (live with the dev token; TEST demo rows signed out). */
export default function AdminCelebritiesPage() {
  return <CelebritiesScreen />;
}
