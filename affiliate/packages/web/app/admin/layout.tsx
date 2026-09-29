import type { ReactNode } from 'react';
import { AdminShell } from '@/components/shell/AdminShell';

/** Network operations console (2e) plus the live ops pages (suspense, looks). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
