import type { Metadata } from 'next';
import { BrandSettings } from '@/components/brand/BrandSettings';

export const metadata: Metadata = { title: 'Brand settings' };

/** Company details (legal name, GSTIN, website, category). TEST demo: saved in this browser; no brand-profile endpoint in v1. */
export default function BrandSettingsPage() {
  return <BrandSettings />;
}
