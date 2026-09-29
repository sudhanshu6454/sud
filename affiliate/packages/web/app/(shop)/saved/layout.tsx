import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The wishlist page is a client component (localStorage), so its title lives here.
export const metadata: Metadata = { title: 'Saved' };

export default function SavedLayout({ children }: { children: ReactNode }) {
  return children;
}
