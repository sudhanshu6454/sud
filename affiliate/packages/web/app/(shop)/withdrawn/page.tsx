import type { Metadata } from 'next';
import { WithdrawnNotice } from '@/components/shop/WithdrawnNotice';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Withdrawn', robots: { index: false, follow: false } };

/**
 * What a withdrawn page shows (a takedown): the middleware answers a
 * withdrawn /looks/<id> or /c/<slug> with HTTP 410, no-store and noindex and
 * this page's server-rendered markup (its scripts taken out), so an old
 * Facebook or Instagram link lands in the shop's own layout (bar, tabs,
 * footer) with only the notice — no name, no image, no product.
 */
export default function WithdrawnPage() {
  return <WithdrawnNotice />;
}
