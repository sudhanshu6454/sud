import type { Metadata } from 'next';
import { LooksPipeline } from '@/components/admin/celebrity/LooksPipeline';

export const metadata: Metadata = { title: 'Looks' };

/**
 * The looks pipeline: live celebrity looks with the dev token (one column
 * per status); signed out, the local board of TEST looks as before.
 */
export default function AdminLooksPage() {
  return <LooksPipeline />;
}
