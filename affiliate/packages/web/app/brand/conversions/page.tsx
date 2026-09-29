import type { Metadata } from 'next';
import { BrandConversions } from '@/components/brand/BrandConversions';

export const metadata: Metadata = { title: 'Conversions' };

/** The brand's conversions by status. TEST demo: no brand conversions endpoint in v1. */
export default function BrandConversionsPage() {
  return <BrandConversions />;
}
