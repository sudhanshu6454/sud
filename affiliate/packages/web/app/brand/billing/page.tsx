import type { Metadata } from 'next';
import { BrandBilling } from '@/components/brand/BrandBilling';

export const metadata: Metadata = { title: 'Billing' };

/** Wallet, plan and billing history. TEST demo: no billing endpoint or payments provider; top-up takes no payment. */
export default function BrandBillingPage() {
  return <BrandBilling />;
}
