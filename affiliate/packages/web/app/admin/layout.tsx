import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/shell/AdminShell';

/** TEST demo pages without a sign-in: kept out of search indexes (noindex, nofollow). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Network operations console (2e) plus the live ops pages (suspense, looks). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
