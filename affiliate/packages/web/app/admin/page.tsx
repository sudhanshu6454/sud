import type { Metadata } from 'next';
import { AdminQueue } from '@/components/admin/AdminQueue';

export const metadata: Metadata = { title: 'Admin queue' };

/** Admin console (2e): network KPIs and the review queue. TEST demo data (no queue endpoint in v1). */
export default function AdminPage() {
  return <AdminQueue />;
}
