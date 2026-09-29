import type { Metadata } from 'next';
import { Overview } from '@/components/creator/overview/Overview';

export const metadata: Metadata = { title: 'Overview' };

/**
 * Creator Overview (1c; 1e on phones). Earnings and Next payout are live from
 * GET /v1/publisher/earnings when it answers; the rest is TEST demo data
 * with <DemoBadge /> (components/creator/overview).
 */
export default function AppPage() {
  return <Overview />;
}
