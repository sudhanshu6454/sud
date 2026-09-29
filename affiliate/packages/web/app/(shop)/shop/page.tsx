import type { Metadata } from 'next';
import { pageMetadata } from '@/lib/seo';
import LookGrid from '@/components/LookGrid';
import { listLooks } from '@/lib/catalogue';

// Rendered per request; the catalogue fetch itself is cached for 60 s
// (lib/catalogue.ts), so the grid is never a build-time snapshot.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return pageMetadata('/shop', 'Shop the looks');
}

/** Afflino's consumer shop grid: live GET /v1/looks (all pages), TEST demo looks + badge on fallback. */
export default async function ShopPage() {
  const { value: looks, demo } = await listLooks();
  return <LookGrid looks={looks} demo={demo} />;
}
