import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The wishlist page is a client component (localStorage), so its title lives
// here. Per-browser and empty to a crawler: disallowed in robots.txt and
// noindex (lib/seo.ts ROBOTS_DISALLOW).
export const metadata: Metadata = { title: 'Saved', robots: { index: false, follow: false } };

export default function SavedLayout({ children }: { children: ReactNode }) {
  return children;
}
