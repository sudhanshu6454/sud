import type { Metadata } from 'next';
import { Payouts } from '@/components/creator/payouts/Payouts';

export const metadata: Metadata = { title: 'Payouts' };

/**
 * Creator Payouts (2c; 3f on phones): balances from GET /v1/publisher/earnings
 * with the demo fallback; payout method, history, conversions and clicks are
 * TEST demo data (no v1 endpoint) — components/creator/payouts.
 */
export default function AppPayoutsPage() {
  return <Payouts />;
}
