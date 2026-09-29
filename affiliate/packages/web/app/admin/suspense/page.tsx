import type { Metadata } from 'next';
import { SuspenseQueue } from './SuspenseQueue';

export const metadata: Metadata = { title: 'Suspense' };

/** Live suspense ops (GET /v1/suspense, POST retry / review); demo fallback with a badge. */
export default function AdminSuspensePage() {
  return <SuspenseQueue />;
}
