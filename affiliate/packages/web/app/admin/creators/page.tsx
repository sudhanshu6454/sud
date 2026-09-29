import type { Metadata } from 'next';
import { AdminCreators } from '@/components/admin/AdminCreators';

export const metadata: Metadata = { title: 'Admin creators' };

/** Admin · Creators: reach and KYC status (not drawn; 2e style). TEST demo data (no creators or KYC endpoint in v1). */
export default function AdminCreatorsPage() {
  return <AdminCreators />;
}
