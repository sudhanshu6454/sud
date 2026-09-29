import type { Metadata } from 'next';
import { AdminSettlements } from '@/components/admin/AdminSettlements';

export const metadata: Metadata = { title: 'Admin settlements' };

/** Admin · Settlements: weekly batches, read-only (not drawn; 2e style). TEST demo data; real batches use the API's maker-checker flow. */
export default function AdminSettlementsPage() {
  return <AdminSettlements />;
}
