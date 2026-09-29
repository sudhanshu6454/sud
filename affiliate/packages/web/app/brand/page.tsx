import type { Metadata } from 'next';
import { BrandOverview } from '@/components/brand/BrandOverview';

export const metadata: Metadata = { title: 'Brand overview' };

/** Brand overview (2b; phone 3f right). TEST demo data: no v1 endpoint serves brand campaign figures. */
export default function BrandPage() {
  return <BrandOverview />;
}
