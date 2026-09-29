import type { Metadata } from 'next';
import { Reports } from '@/components/creator/reports/Reports';

export const metadata: Metadata = { title: 'Reports' };

/** Creator Reports (3d): TEST demo data with <DemoBadge /> — no v1 reports endpoint (components/creator/reports). */
export default function AppReportsPage() {
  return <Reports />;
}
