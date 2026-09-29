import type { Metadata } from 'next';
import { AdminBrands } from '@/components/admin/AdminBrands';

export const metadata: Metadata = { title: 'Admin brands' };

/** Admin · Brands: plan, wallet and status per brand (not drawn; 2e style). TEST demo data (no brands endpoint in v1). */
export default function AdminBrandsPage() {
  return <AdminBrands />;
}
