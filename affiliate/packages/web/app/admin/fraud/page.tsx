import type { Metadata } from 'next';
import { AdminFraud } from '@/components/admin/AdminFraud';

export const metadata: Metadata = { title: 'Admin fraud' };

/** Admin · Fraud: the design's four signals and the open cases (not drawn; 2e style). TEST demo data; no detection runs yet. */
export default function AdminFraudPage() {
  return <AdminFraud />;
}
