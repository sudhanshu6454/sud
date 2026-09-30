import type { Metadata } from 'next';
import { TakedownsScreen } from '@/components/admin/celebrity/TakedownsScreen';

export const metadata: Metadata = { title: 'Takedowns' };

/** Takedowns: one action withdraws a celebrity or a look everywhere (410), with the timestamps and the restore. */
export default function AdminTakedownsPage() {
  return <TakedownsScreen />;
}
