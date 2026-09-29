import type { Metadata } from 'next';
import { AdminOffers } from '@/components/admin/AdminOffers';

export const metadata: Metadata = { title: 'Admin offers' };

/** Admin · Offers: offers in review (reviewed like the queue) and live offers (not drawn; 2e style). TEST demo data. */
export default function AdminOffersPage() {
  return <AdminOffers />;
}
