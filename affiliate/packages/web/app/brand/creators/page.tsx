import type { Metadata } from 'next';
import { BrandCreators } from '@/components/brand/BrandCreators';

export const metadata: Metadata = { title: 'Brand creators' };

/** Approved creators and pending requests. TEST demo: no creator-approval endpoint in v1. */
export default function BrandCreatorsPage() {
  return <BrandCreators />;
}
